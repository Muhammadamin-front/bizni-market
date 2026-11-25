import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { aiUsage } from "@shop/db";
import { AiAnalyzeInput, AiDescribeInput, AiTranslateInput } from "@shop/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiAnalyzeSales, aiDescribe, aiStatus, aiTranslate, createManualProduct } from "../src";
import { createWorld, type TestWorld } from "./helpers";
import { ManualProductInput } from "@shop/shared";

/** A stand-in for Google's generateContent: answers with whatever the test queued, and records what it was sent. */
let fake: Server;
let replies: { status: number; body: unknown }[] = [];
let seen: { url: string; key: string | undefined; body: { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] } }[] = [];

const answer = (text: string, total = 120, finishReason = "STOP") => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 80, candidatesTokenCount: total - 80, totalTokenCount: total }, modelVersion: "gemini-test" },
});

let w: TestWorld;
beforeAll(async () => {
  fake = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", key: req.headers["x-goog-api-key"] as string | undefined, body: JSON.parse(raw) });
      const next = replies.shift() ?? { status: 500, body: { error: { message: "nothing queued" } } };
      res.writeHead(next.status, { "content-type": "application/json" }).end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  w = await createWorld({
    AI_ENABLED: "true",
    GEMINI_API_KEY: "test-key-123",
    GEMINI_MODEL: "gemini-flash-latest",
    GEMINI_BASE_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1beta`,
    AI_MONTHLY_TOKEN_LIMIT: "1000",
  });
});
afterAll(async () => {
  await w.stop();
  await new Promise((r) => fake.close(r));
});
beforeEach(async () => {
  await w.reset();
  replies = [];
  seen = [];
  w.rt.env.AI_ENABLED = true;
  w.rt.env.GEMINI_API_KEY = "test-key-123";
});

const usageRows = () => w.rt.db.select().from(aiUsage);

describe("AI assistant", () => {
  it("stays locked until the server unlocks it: nothing is sent to Google and nothing is counted", async () => {
    w.rt.env.AI_ENABLED = false;
    const s = await aiStatus(w.rt);
    expect(s).toMatchObject({ enabled: false, configured: true, priceUzs: 300_000, limit: 1000, used: 0, remaining: 1000 });
    expect(s.resetsOn).toMatch(/^\d{4}-\d{2}-01$/);
    await expect(aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Sichqoncha" }))).rejects.toMatchObject({ code: "ai_locked", status: 403 });
    w.rt.env.AI_ENABLED = true;
    w.rt.env.GEMINI_API_KEY = "";
    await expect(aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Sichqoncha" }))).rejects.toMatchObject({ code: "ai_not_configured", status: 503 });
    expect(seen).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it("writes a description in both languages, sends the key only in a header, and counts Gemini's tokens", async () => {
    replies.push(answer('```json\n{"uz": "Simli sichqoncha.\\n• Ofis uchun", "ru": "Проводная мышь.\\n• Для офиса"}\n```', 300));
    const out = await aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Simli sichqoncha M-01", brand: "Corex", notes: "USB, 1.5 m kabel" }));
    expect(out).toEqual({ uz: "Simli sichqoncha.\n• Ofis uchun", ru: "Проводная мышь.\n• Для офиса" });
    expect(seen[0]!.url).toBe("/v1beta/models/gemini-flash-latest:generateContent");
    expect(seen[0]!.url).not.toContain("key");
    expect(seen[0]!.key).toBe("test-key-123");
    expect(seen[0]!.body.contents[0]!.parts[0]!.text).toContain("USB, 1.5 m kabel");
    const [row] = await usageRows();
    expect(row).toMatchObject({ feature: "describe", model: "gemini-test", promptTokens: 80, outputTokens: 220, totalTokens: 300, ok: true });
    expect(await aiStatus(w.rt)).toMatchObject({ used: 300, remaining: 700, requests: 1 });
  });

  it("refuses once the month's allowance is spent, without calling Google", async () => {
    replies.push(answer('{"uz": "a", "ru": "b"}', 1200));
    await aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Daftar" }));
    expect(await aiStatus(w.rt)).toMatchObject({ used: 1200, remaining: 0 });
    await expect(aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Daftar" }))).rejects.toMatchObject({ code: "ai_limit", status: 429 });
    expect(seen).toHaveLength(1);
  });

  it("tells Gemini's own rate limit, a refused key and an unusable answer apart; spent tokens still count", async () => {
    replies.push({ status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } } });
    await expect(aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Daftar" }))).rejects.toMatchObject({ code: "ai_busy", status: 429 });
    replies.push({ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } } });
    await expect(aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Daftar" }))).rejects.toMatchObject({ code: "ai_bad_key", status: 503 });
    replies.push(answer("not json at all", 90));
    await expect(aiDescribe(w.rt, null, AiDescribeInput.parse({ name: "Daftar" }))).rejects.toMatchObject({ code: "ai_failed" });
    const rows = await usageRows();
    expect(rows.map((r) => [r.ok, r.error, r.totalTokens])).toEqual([[false, "bad_format", 90]]);
  });

  it("puts the admin's text into both languages and leaves an empty field empty", async () => {
    replies.push(answer(JSON.stringify({ name: { uz: "x", ru: "y" }, description: { uz: "Koʻk siyohli ruchka.", ru: "Ручка с синими чернилами." } })));
    const out = await aiTranslate(w.rt, null, AiTranslateInput.parse({ description: "Ручка с синими чернилами" }));
    expect(out).toEqual({ name: { uz: "", ru: "" }, description: { uz: "Koʻk siyohli ruchka.", ru: "Ручка с синими чернилами." } });
    expect(() => AiTranslateInput.parse({ name: "", description: "" })).toThrow();
  });

  it("analyses sales from aggregated numbers only and returns plain text", async () => {
    await createManualProduct(w.rt, ManualProductInput.parse({ name: "Daftar 48 varaq", price: 4500, availableQty: 2 }));
    replies.push(answer("## Umumiy holat\n**Savdo** hali kam.\n- Tovar qoʻshing\n* Rasm qoʻying"));
    const out = await aiAnalyzeSales(w.rt, null, AiAnalyzeInput.parse({ days: 30, lang: "uz" }));
    expect(out.text).toBe("Umumiy holat\nSavdo hali kam.\n• Tovar qoʻshing\n• Rasm qoʻying");
    const sent = seen[0]!.body.contents[0]!.parts[0]!.text;
    expect(sent).toContain("low_stock_products");
    expect(sent).toContain("Daftar 48 varaq");
    expect(sent).not.toMatch(/contact_phone|\+998/);
    expect(seen[0]!.body.systemInstruction.parts[0]!.text).toContain("Uzbek");
  });
});
