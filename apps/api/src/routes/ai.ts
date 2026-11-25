import { aiAdvice, aiAnalyzeSales, aiDescribe, aiStatus, aiTranslate, type Runtime } from "@shop/core";
import { AiAdviceInput, AiAnalyzeInput, AiDescribeInput, AiTranslateInput } from "@shop/shared";
import type { FastifyInstance } from "fastify";
import { limitBy, requireAdmin } from "../guards";

/**
 * The admin's AI assistant. Every route is admin-only; the lock (AI_ENABLED), the key and the monthly token allowance are
 * checked in core on every call, so a locked shop gets 403 "ai_locked" here whatever the admin page shows.
 */
export function aiRoutes(app: FastifyInstance, rt: Runtime) {
  const guard = requireAdmin(rt);
  // A runaway double-click loop must not burn the month's tokens: 30 AI calls per 10 minutes is plenty for one person.
  const ai = { preHandler: [guard, limitBy(rt, "admin-ai", 30, 600)] };

  app.get("/v1/admin/ai/status", { preHandler: guard }, async () => aiStatus(rt));
  app.post("/v1/admin/ai/describe", ai, async (req) => aiDescribe(rt, req.admin!.adminId, AiDescribeInput.parse(req.body)));
  app.post("/v1/admin/ai/translate", ai, async (req) => aiTranslate(rt, req.admin!.adminId, AiTranslateInput.parse(req.body)));
  app.post("/v1/admin/ai/analyze", ai, async (req) => aiAnalyzeSales(rt, req.admin!.adminId, AiAnalyzeInput.parse(req.body)));
  app.post("/v1/admin/ai/advice", ai, async (req) => aiAdvice(rt, req.admin!.adminId, AiAdviceInput.parse(req.body)));
}
