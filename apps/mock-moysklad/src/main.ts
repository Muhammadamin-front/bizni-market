import { buildMockServer } from "./server";

const port = Number(process.env.PORT ?? 4010);
const publicUrl = process.env.MOCK_PUBLIC_URL ?? `http://localhost:${port}`;
const { app } = await buildMockServer({
  token: process.env.MOCK_MOYSKLAD_TOKEN ?? "demo-token",
  publicUrl,
  rateLimit: { enabled: process.env.MOCK_RATE_LIMIT !== "off" } as never,
});
await app.listen({ port, host: "0.0.0.0" });
console.log(`Mock MoySklad on ${publicUrl}  (control page: ${publicUrl}/__mock)`);
