import { createOrder, loadOrderView, OrderError, type Runtime } from "@shop/core";
import { eq, orders } from "@shop/db";
import { CheckoutInput } from "@shop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { optionalTma } from "../guards";

const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_\-:.]{8,100}$/);

export function orderRoutes(app: FastifyInstance, rt: Runtime) {
  app.post("/v1/orders", { preHandler: optionalTma(rt) }, async (req, reply) => {
    const key = IdempotencyKey.safeParse(req.headers["idempotency-key"]);
    if (!key.success) return reply.code(400).send({ error: "idempotency_key_required" });
    const input = CheckoutInput.parse(req.body);
    const tma = req.tma;
    try {
      const { order, created } = await createOrder(rt, input, {
        channel: tma ? "tma" : "web",
        customerId: tma?.cid ?? null,
        telegramId: tma?.tg ?? null,
        ip: req.clientIp,
        idempotencyKey: key.data,
      });
      return reply.code(created ? 201 : 200).send(order);
    } catch (err) {
      if (err instanceof OrderError) return reply.code(err.status).send({ error: err.code, details: err.details });
      throw err;
    }
  });

  // The confirmation / status link: the id is an unguessable uuid, so it works for guests without an account.
  app.get("/v1/orders/:publicId", async (req, reply) => {
    const publicId = z.uuid().safeParse((req.params as { publicId: string }).publicId);
    if (!publicId.success) return reply.code(404).send({ error: "not_found" });
    const view = await loadOrderView(rt, eq(orders.publicId, publicId.data));
    return view ?? reply.code(404).send({ error: "not_found" });
  });
}
