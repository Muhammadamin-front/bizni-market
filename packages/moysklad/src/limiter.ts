import { randomUUID } from "node:crypto";

/**
 * One global request budget shared by every process that talks to MoySklad.
 * Budget math (docs/moysklad-api-notes.md §2): a basket of 45 units per 3 s; a user-token request weighs 4 from
 * 2026-12-01 (= 11 requests per 3 s). We size for that strictest tier from day one.
 *
 * Two lanes: "interactive" (checkout) may use the whole basket; "background" (sync) must leave `backgroundReserve`
 * units free so a customer's order is never queued behind a catalogue sync.
 */
export type Lane = "interactive" | "background";

export interface LimiterOptions {
  capacityUnits: number;
  windowMs: number;
  backgroundReserveUnits: number;
  maxConcurrent: number;
}

export const DEFAULT_LIMITER: LimiterOptions = {
  capacityUnits: 45,
  windowMs: 3000,
  backgroundReserveUnits: 12,
  maxConcurrent: 5,
};

export interface RateLimiter {
  /** Resolves when the request may be sent; the returned function MUST be called when it finishes. */
  acquire(weight: number, lane: Lane, signal?: AbortSignal): Promise<() => void>;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export class InMemoryLimiter implements RateLimiter {
  private events: number[] = []; // one timestamp per consumed unit
  private inFlight = 0;
  private readonly opts: LimiterOptions;

  constructor(
    opts: Partial<LimiterOptions> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.opts = { ...DEFAULT_LIMITER, ...opts };
  }

  async acquire(weight: number, lane: Lane, signal?: AbortSignal): Promise<() => void> {
    const budget = this.opts.capacityUnits - (lane === "background" ? this.opts.backgroundReserveUnits : 0);
    for (;;) {
      const t = this.now();
      this.events = this.events.filter((e) => e > t - this.opts.windowMs);
      if (this.inFlight < this.opts.maxConcurrent && this.events.length + weight <= budget) {
        for (let i = 0; i < weight; i++) this.events.push(t);
        this.inFlight++;
        let released = false;
        return () => {
          if (!released) {
            released = true;
            this.inFlight--;
          }
        };
      }
      const oldest = this.events[0];
      const waitForWindow = oldest === undefined ? 25 : Math.max(oldest + this.opts.windowMs - t, 5);
      await sleep(this.inFlight >= this.opts.maxConcurrent ? 25 : waitForWindow, signal);
    }
  }
}

/** The subset of an ioredis client the limiter needs. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// KEYS[1]=window zset, KEYS[2]=in-flight counter. ARGV: now, windowMs, budget, weight, maxConcurrent, member prefix.
// Returns 0 when granted, otherwise the number of ms to wait.
const ACQUIRE_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local budget = tonumber(ARGV[3])
local weight = tonumber(ARGV[4])
local maxc = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local inflight = tonumber(redis.call('GET', KEYS[2]) or '0')
if inflight >= maxc then return 25 end
local used = redis.call('ZCARD', KEYS[1])
if used + weight > budget then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local wait = 25
  if oldest[2] then wait = math.max(tonumber(oldest[2]) + window - now, 5) end
  return wait
end
for i = 1, weight do
  redis.call('ZADD', KEYS[1], now, ARGV[6] .. ':' .. i)
end
redis.call('PEXPIRE', KEYS[1], window * 2)
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], 60000)
return 0
`;

const RELEASE_LUA = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v > 0 then redis.call('DECR', KEYS[1]) end
return v
`;

/** Same algorithm as InMemoryLimiter, but the window and the in-flight counter live in Redis so api and worker share one budget. */
export class RedisLimiter implements RateLimiter {
  private readonly opts: LimiterOptions;

  constructor(
    private readonly redis: RedisLike,
    opts: Partial<LimiterOptions> = {},
    private readonly keyPrefix = "ms:limiter",
  ) {
    this.opts = { ...DEFAULT_LIMITER, ...opts };
  }

  async acquire(weight: number, lane: Lane, signal?: AbortSignal): Promise<() => void> {
    const budget = this.opts.capacityUnits - (lane === "background" ? this.opts.backgroundReserveUnits : 0);
    const windowKey = `${this.keyPrefix}:window`;
    const flightKey = `${this.keyPrefix}:inflight`;
    for (;;) {
      // Random, not pid-based: containers routinely share a pid, and a duplicate member would be silently de-duplicated by ZADD,
      // which under-counts the budget exactly when two processes act in the same millisecond.
      const member = randomUUID();
      const wait = Number(
        await this.redis.eval(ACQUIRE_LUA, 2, windowKey, flightKey, Date.now(), this.opts.windowMs, budget, weight, this.opts.maxConcurrent, member),
      );
      if (wait === 0) {
        let released = false;
        return () => {
          if (released) return;
          released = true;
          void this.redis.eval(RELEASE_LUA, 1, flightKey).catch(() => undefined);
        };
      }
      await sleep(wait, signal);
    }
  }
}
