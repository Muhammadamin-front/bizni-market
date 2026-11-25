import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { AiError, AuthError, CatalogEditError, ImageError, OrderError, type Runtime } from "@shop/core";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { ZodError } from "zod";
import { adminRoutes } from "./routes/admin";
import { aiRoutes } from "./routes/ai";
import { customerRoutes } from "./routes/customer";
import { hookRoutes } from "./routes/hooks";
import { orderRoutes } from "./routes/orders";
import { publicRoutes } from "./routes/public";

export async function buildApp(rt: Runtime): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: rt.log as unknown as FastifyBaseLogger,
    trustProxy: rt.env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });
  app.decorateRequest("tma", null);
  app.decorateRequest("admin", null);
  app.decorateRequest("clientIp", "");
  // Behind Cloudflare Tunnel every request reaches us from 127.0.0.1 and X-Forwarded-For starts with whatever the client sent;
  // the edge's own header is the one address a visitor cannot choose. A malformed value falls back to the proxy address.
  const ipHeader = rt.env.CLIENT_IP_HEADER.trim().toLowerCase();
  app.addHook("onRequest", async (req) => {
    const raw = ipHeader ? req.headers[ipHeader] : undefined;
    const v = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim() ?? "";
    req.clientIp = v && isIP(v) ? v : req.ip;
  });
  await app.register(cookie);

  // Raw image bytes for banner and product photo uploads. Each route sets its own, smaller or equal, limit.
  app.addContentTypeParser(/^image\//, { parseAs: "buffer", bodyLimit: 15 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    // Private surfaces are never cached by a browser or a proxy.
    if (req.url.startsWith("/v1/admin") || req.url.startsWith("/v1/me") || req.url.startsWith("/v1/cart") || req.url.startsWith("/v1/favorites") || req.url.startsWith("/v1/orders") || req.url.startsWith("/v1/auth")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  app.setErrorHandler((error: unknown, req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })) });
    }
    if (err instanceof OrderError) return reply.code(err.status).send({ error: err.code, details: err.details });
    if (err instanceof AuthError) return reply.code(401).send({ error: err.code, message: err.message });
    if (err instanceof CatalogEditError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof AiError) return reply.code(err.status).send({ error: err.code });
    if (err instanceof ImageError) return reply.code(err.code === "too_large" ? 413 : 422).send({ error: `image_${err.code}`, message: err.message });
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err: err.message, stack: err.stack }, "unhandled error");
      return reply.code(500).send({ error: "internal" });
    }
    return reply.code(status).send({ error: err.code ?? "bad_request", message: err.message });
  });

  // Our own copies of MoySklad images. Keys are content hashes, so they never change: cache forever.
  mkdirSync(rt.env.MEDIA_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: path.resolve(rt.env.MEDIA_DIR),
    prefix: "/media/",
    decorateReply: false,
    maxAge: "365d",
    immutable: true,
    dotfiles: "deny",
    index: false,
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_req, reply) => {
    try {
      await Promise.all([rt.pool.query("SELECT 1"), rt.redis.ping()]);
      return { ok: true };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  publicRoutes(app, rt);
  customerRoutes(app, rt);
  orderRoutes(app, rt);
  hookRoutes(app, rt);
  adminRoutes(app, rt);
  aiRoutes(app, rt);
  return app;
}
