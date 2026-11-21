import { createDb, type Db, type Pool } from "@shop/db";
import { CircuitBreaker, MoySkladClient, RedisBreakerStore, RedisLimiter } from "@shop/moysklad";
import { Redis } from "ioredis";
import { isDemoSource, type Env } from "./env";
import { createLogger, type Logger } from "./logger";
import { createQueues, type Queues } from "./queues";

/** Everything a process needs to do work. Built once per process (api, worker, scripts). */
export interface Runtime {
  env: Env;
  db: Db;
  pool: Pool;
  redis: Redis;
  /** Null while MOYSKLAD_TOKEN is empty: the system runs, but sync/order push report "not connected". */
  ms: MoySkladClient | null;
  queues: Queues;
  log: Logger;
  demo: boolean;
  close(): Promise<void>;
}

export function redisOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    // Required by BullMQ for blocking connections; harmless for the rest.
    maxRetriesPerRequest: null as null,
  };
}

export interface RuntimeHooks {
  onBreakerOpen?(until: number, failures: number): void;
}

export function createRuntime(env: Env, name = "shop", hooks: RuntimeHooks = {}): Runtime {
  const log = createLogger(env.LOG_LEVEL, name);
  const { db, pool } = createDb(env.DATABASE_URL);
  const redis = new Redis(redisOptions(env.REDIS_URL));
  redis.on("error", (err) => log.warn({ err: err.message }, "redis error"));

  const ms = env.MOYSKLAD_TOKEN
    ? new MoySkladClient({
        baseUrl: env.MOYSKLAD_BASE_URL,
        token: env.MOYSKLAD_TOKEN,
        requestWeight: env.MOYSKLAD_REQUEST_WEIGHT,
        limiter: new RedisLimiter(redis),
        breaker: new CircuitBreaker(new RedisBreakerStore(redis as never), {}, (until, failures) => {
          log.error({ until: new Date(until).toISOString(), failures }, "MoySklad circuit breaker OPEN: background MoySklad calls are paused");
          hooks.onBreakerOpen?.(until, failures);
        }),
        onRateHeaders: undefined,
      })
    : null;

  const queues = createQueues(env.REDIS_URL);

  return {
    env,
    db,
    pool,
    redis,
    ms,
    queues,
    log,
    demo: isDemoSource(env),
    async close() {
      await queues.close();
      redis.disconnect();
      await pool.end();
    },
  };
}
