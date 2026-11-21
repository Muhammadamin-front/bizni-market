import { randomUUID } from "node:crypto";
import type { RedisLike } from "./limiter";

/**
 * MoySklad switches a user's API access off after >200 failing (or 429) requests in a minute and only support can
 * switch it back on. We trip at ~10% of that, and stay open for a cool-down, so a bug or an outage can never get there.
 */
export interface BreakerStore {
  /** Records one failure and returns how many happened inside the window. */
  recordFailure(windowMs: number): Promise<number>;
  getOpenUntil(): Promise<number>;
  setOpenUntil(timestampMs: number): Promise<void>;
  reset(): Promise<void>;
}

export class InMemoryBreakerStore implements BreakerStore {
  private failures: number[] = [];
  private openUntil = 0;
  async recordFailure(windowMs: number) {
    const t = Date.now();
    this.failures = this.failures.filter((f) => f > t - windowMs);
    this.failures.push(t);
    return this.failures.length;
  }
  async getOpenUntil() {
    return this.openUntil;
  }
  async setOpenUntil(ts: number) {
    this.openUntil = ts;
  }
  async reset() {
    this.failures = [];
    this.openUntil = 0;
  }
}

const FAIL_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return redis.call('ZCARD', KEYS[1])
`;

export class RedisBreakerStore implements BreakerStore {
  constructor(
    private readonly redis: RedisLike & { get(key: string): Promise<string | null>; set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>; del(...keys: string[]): Promise<unknown> },
    private readonly prefix = "ms:breaker",
  ) {}
  async recordFailure(windowMs: number) {
    return Number(await this.redis.eval(FAIL_LUA, 1, `${this.prefix}:failures`, Date.now(), windowMs, randomUUID()));
  }
  async getOpenUntil() {
    return Number((await this.redis.get(`${this.prefix}:open_until`)) ?? 0);
  }
  async setOpenUntil(ts: number) {
    const ttl = Math.max(ts - Date.now(), 1000);
    await this.redis.set(`${this.prefix}:open_until`, String(ts), "PX", ttl + 1000);
  }
  async reset() {
    await this.redis.del(`${this.prefix}:failures`, `${this.prefix}:open_until`);
  }
}

export interface BreakerOptions {
  failureThreshold: number;
  windowMs: number;
  openMs: number;
}

export const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 20, windowMs: 60_000, openMs: 5 * 60_000 };

export class CircuitBreaker {
  private readonly opts: BreakerOptions;
  constructor(
    private readonly store: BreakerStore = new InMemoryBreakerStore(),
    opts: Partial<BreakerOptions> = {},
    private readonly onOpen?: (openUntil: number, failures: number) => void,
  ) {
    this.opts = { ...DEFAULT_BREAKER, ...opts };
  }

  /** Returns the time the breaker reopens, or 0 when it is closed. */
  async openUntil(): Promise<number> {
    const until = await this.store.getOpenUntil();
    return until > Date.now() ? until : 0;
  }

  async recordFailure(): Promise<void> {
    const failures = await this.store.recordFailure(this.opts.windowMs);
    if (failures >= this.opts.failureThreshold && (await this.openUntil()) === 0) {
      await this.trip(failures);
    }
  }

  /** Immediate trip, used for 401: retrying a bad token only burns the failure budget. */
  async trip(failures = 0): Promise<void> {
    const until = Date.now() + this.opts.openMs;
    await this.store.setOpenUntil(until);
    this.onOpen?.(until, failures);
  }

  reset(): Promise<void> {
    return this.store.reset();
  }
}
