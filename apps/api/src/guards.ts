import { verifyTmaToken, getAdminSession, type AdminSession, type Runtime, type TmaToken } from "@shop/core";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    tma: TmaToken | null;
    admin: AdminSession | null;
    /** The visitor's address for rate limits and logs (see CLIENT_IP_HEADER). */
    clientIp: string;
  }
}

export const ADMIN_COOKIE = "admin_session";

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

/** Fixed-window limiter in Redis. Returns false when the caller is over the limit. */
export async function allow(rt: Runtime, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const k = `rl:${key}`;
  const n = await rt.redis.incr(k);
  if (n === 1) await rt.redis.expire(k, windowSeconds);
  return n <= max;
}

export function limitBy(rt: Runtime, name: string, max: number, windowSeconds: number) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await allow(rt, `${name}:${req.clientIp}`, max, windowSeconds))) {
      return reply.code(429).header("Retry-After", String(windowSeconds)).send({ error: "rate_limited" });
    }
  };
}

export function requireTma(rt: Runtime) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = verifyTmaToken(rt.env.SESSION_SECRET, bearer(req));
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    req.tma = token;
  };
}

/** Attaches the Mini App identity when a valid token is present, without requiring one (guest checkout uses the same endpoint). */
export function optionalTma(rt: Runtime) {
  return async (req: FastifyRequest) => {
    req.tma = verifyTmaToken(rt.env.SESSION_SECRET, bearer(req));
  };
}

export function requireAdmin(rt: Runtime) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const session = await getAdminSession(rt, req.cookies[ADMIN_COOKIE]);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    req.admin = session;
    // CSRF: the session cookie is SameSite=Lax; state-changing calls must also come from our own origin and carry a custom header.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const publicHost = (() => {
        try {
          return new URL(rt.env.PUBLIC_URL).host;
        } catch {
          return "";
        }
      })();
      const originHost = origin ? (() => { try { return new URL(origin).host; } catch { return ""; } })() : "";
      const originOk = !origin || originHost === host || originHost === publicHost;
      if (!originOk || req.headers["x-requested-with"] !== "shop-admin") return reply.code(403).send({ error: "csrf" });
    }
  };
}
