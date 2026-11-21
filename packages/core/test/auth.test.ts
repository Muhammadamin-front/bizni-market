import { createHmac } from "node:crypto";
import { adminUsers, eq } from "@shop/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuthError,
  base32Decode,
  base32Encode,
  bootstrapAdmin,
  createAdmin,
  generateTotpSecret,
  getAdminSession,
  hashPassword,
  hotp,
  loginAdmin,
  logoutAdmin,
  passwordProblem,
  signTmaToken,
  totp,
  upsertTelegramCustomer,
  validateInitData,
  verifyPassword,
  verifyTmaToken,
  verifyTotp,
} from "../src";
import { createWorld, type TestWorld } from "./helpers";

describe("passwords", () => {
  it("hashes with a salt and verifies", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await hashPassword("Correct-Horse-9")).not.toBe(h);
    expect(await verifyPassword("Correct-Horse-9", h)).toBe(true);
    expect(await verifyPassword("correct-horse-9", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("rejects weak passwords", () => {
    expect(passwordProblem("short1A!")).toMatch(/12/);
    expect(passwordProblem("password1234")).toBeTruthy();
    expect(passwordProblem("alllowercaseletters")).toBeTruthy();
    expect(passwordProblem("Str0ng-enough-pass", "x@y.z")).toBeNull();
    expect(passwordProblem("Contains-Berdi-99", "berdi@x.uz")).toMatch(/email/);
  });
});

describe("TOTP (RFC 6238)", () => {
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC test vectors", () => {
    expect(hotp(Buffer.from("12345678901234567890"), 1, 8)).toBe("94287082");
    expect(totp(rfcSecret, 59_000, 8)).toBe("94287082");
    expect(totp(rfcSecret, 1_111_111_109_000, 8)).toBe("07081804");
    expect(totp(rfcSecret, 20_000_000_000_000, 8)).toBe("65353130");
  });
  it("round-trips base32, tolerates one step of drift, and refuses the rest", () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    const now = 1_700_000_000_000;
    const code = totp(s, now);
    expect(verifyTotp(s, code, now)).toBe(true);
    expect(verifyTotp(s, code, now + 30_000)).toBe(true);
    expect(verifyTotp(s, code, now + 120_000)).toBe(false);
    expect(verifyTotp(s, "12345", now)).toBe(false);
    expect(verifyTotp(s, "abcdef", now)).toBe(false);
  });
});

const BOT = "123456:TEST-bot-token";
function makeInitData(over: { user?: object; authDate?: number; extra?: Record<string, string>; token?: string; breakHash?: boolean; withSignature?: boolean } = {}): string {
  const fields: Record<string, string> = {
    auth_date: String(over.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: "AAH-test",
    user: JSON.stringify(over.user ?? { id: 42, first_name: "Ali", last_name: "Valiyev", username: "ali", language_code: "ru" }),
    ...(over.withSignature ? { signature: "sigsigsig" } : {}),
    ...over.extra,
  };
  const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(over.token ?? BOT).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash: over.breakHash ? hash.replace(/^./, (c) => (c === "0" ? "1" : "0")) : hash }).toString();
}

describe("Telegram initData validation", () => {
  it("accepts correctly signed data and returns the user", () => {
    const r = validateInitData(makeInitData(), BOT, 3600);
    expect(r.ok && r.user).toMatchObject({ id: 42, first_name: "Ali", username: "ali", language_code: "ru" });
  });

  it("accepts the newer payload that carries a signature field", () => {
    expect(validateInitData(makeInitData({ withSignature: true }), BOT, 3600).ok).toBe(true);
  });

  it("rejects: a wrong bot token, a tampered hash, a tampered field, a missing hash", () => {
    expect(validateInitData(makeInitData({ token: "999:other" }), BOT, 3600)).toEqual({ ok: false, reason: "bad_hash" });
    expect(validateInitData(makeInitData({ breakHash: true }), BOT, 3600)).toEqual({ ok: false, reason: "bad_hash" });
    const tampered = makeInitData().replace("Ali", "Eve");
    expect(validateInitData(tampered, BOT, 3600)).toEqual({ ok: false, reason: "bad_hash" });
    expect(validateInitData("auth_date=1&user=%7B%7D", BOT, 3600)).toEqual({ ok: false, reason: "missing_hash" });
    expect(validateInitData(makeInitData(), "", 3600)).toEqual({ ok: false, reason: "no_bot_token" });
  });

  it("rejects stale and future-dated data", () => {
    const old = makeInitData({ authDate: Math.floor(Date.now() / 1000) - 7200 });
    expect(validateInitData(old, BOT, 3600)).toEqual({ ok: false, reason: "expired" });
    const future = makeInitData({ authDate: Math.floor(Date.now() / 1000) + 3600 });
    expect(validateInitData(future, BOT, 3600)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a validly signed payload whose user is malformed", () => {
    expect(validateInitData(makeInitData({ user: { first_name: "no id" } }), BOT, 3600)).toEqual({ ok: false, reason: "bad_user" });
  });
});

describe("Mini App bearer tokens", () => {
  it("round-trips, expires, and rejects tampering", () => {
    const t = signTmaToken("s3cret-s3cret-s3cret-s3cret-x", { cid: "c1", tg: 42 }, 60, 1_000_000);
    expect(verifyTmaToken("s3cret-s3cret-s3cret-s3cret-x", t, 1_000_000)).toMatchObject({ cid: "c1", tg: 42 });
    expect(verifyTmaToken("s3cret-s3cret-s3cret-s3cret-x", t, 1_000_000 + 61_000)).toBeNull();
    expect(verifyTmaToken("another-secret-another-secret-xx", t, 1_000_000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ cid: "admin", tg: 1, exp: 99_999_999_999 })).toString("base64url");
    expect(verifyTmaToken("s3cret-s3cret-s3cret-s3cret-x", `${forged}.${sig}`, 1_000_000)).toBeNull();
    expect(verifyTmaToken("s3cret-s3cret-s3cret-s3cret-x", `${body}.`, 1_000_000)).toBeNull();
    expect(verifyTmaToken("s3cret-s3cret-s3cret-s3cret-x", undefined)).toBeNull();
    expect(verifyTmaToken("s3cret-s3cret-s3cret-s3cret-x", "nonsense")).toBeNull();
  });
});

describe("admin accounts (database)", () => {
  let w: TestWorld;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w.stop();
  });
  beforeEach(async () => {
    await w.reset();
  });
  const meta = { ip: "1.2.3.4", userAgent: "test" };
  const PASSWORD = "Str0ng-Enough-Pass!";

  it("bootstraps the first admin from the environment, once, and refuses a weak password", async () => {
    w.rt.env.ADMIN_EMAIL = "owner@shop.uz";
    w.rt.env.ADMIN_PASSWORD = PASSWORD;
    expect(await bootstrapAdmin(w.rt)).toBe("created");
    expect(await bootstrapAdmin(w.rt)).toBe("exists");
    await expect(createAdmin(w.rt, "x@y.uz", "weak")).rejects.toBeInstanceOf(AuthError);
  });

  it("logs in, resolves the session, and logs out", async () => {
    await createAdmin(w.rt, "Owner@Shop.uz", PASSWORD);
    const { token } = await loginAdmin(w.rt, "owner@shop.uz", PASSWORD, undefined, meta);
    expect(await getAdminSession(w.rt, token)).toMatchObject({ email: "owner@shop.uz" });
    expect(await getAdminSession(w.rt, token + "x")).toBeNull();
    await logoutAdmin(w.rt, token);
    expect(await getAdminSession(w.rt, token)).toBeNull();
    // the raw token is never stored
    const stored = (await w.rt.pool.query("SELECT id FROM admin_sessions")).rows;
    expect(stored.every((r: { id: string }) => r.id !== token)).toBe(true);
  });

  it("answers wrong password and unknown user identically, then locks the account after five failures", async () => {
    await createAdmin(w.rt, "owner@shop.uz", PASSWORD);
    const unknown = await loginAdmin(w.rt, "nobody@shop.uz", "whatever-123", undefined, meta).catch((e: AuthError) => e.code);
    const wrong = await loginAdmin(w.rt, "owner@shop.uz", "wrong-password-1", undefined, meta).catch((e: AuthError) => e.code);
    expect(unknown).toBe("invalid_credentials");
    expect(wrong).toBe("invalid_credentials");
    for (let i = 0; i < 3; i++) await loginAdmin(w.rt, "owner@shop.uz", "wrong-password-1", undefined, meta).catch(() => undefined);
    expect(await loginAdmin(w.rt, "owner@shop.uz", "wrong-password-1", undefined, meta).catch((e: AuthError) => e.code)).toBe("locked");
    // even the right password is refused while locked
    expect(await loginAdmin(w.rt, "owner@shop.uz", PASSWORD, undefined, meta).catch((e: AuthError) => e.code)).toBe("locked");
    await w.rt.db.update(adminUsers).set({ lockedUntil: new Date(Date.now() - 1000) });
    expect((await loginAdmin(w.rt, "owner@shop.uz", PASSWORD, undefined, meta)).token).toBeTruthy();
  });

  it("requires a valid one-time code once TOTP is enabled", async () => {
    const id = await createAdmin(w.rt, "owner@shop.uz", PASSWORD);
    const secret = generateTotpSecret();
    await w.rt.db.update(adminUsers).set({ totpSecret: secret, totpEnabled: true }).where(eq(adminUsers.id, id));
    expect(await loginAdmin(w.rt, "owner@shop.uz", PASSWORD, undefined, meta).catch((e: AuthError) => e.code)).toBe("totp_required");
    expect(await loginAdmin(w.rt, "owner@shop.uz", PASSWORD, "000000", meta).catch((e: AuthError) => e.code)).toBe("invalid_credentials");
    expect((await loginAdmin(w.rt, "owner@shop.uz", PASSWORD, totp(secret), meta)).token).toBeTruthy();
  });

  it("creates a Telegram customer once and never overwrites the language they chose in the app", async () => {
    const id = await upsertTelegramCustomer(w.rt, { id: 5001, first_name: "Ali", username: "ali", language_code: "ru" });
    await w.rt.pool.query("UPDATE customers SET language = 'uz' WHERE id = $1", [id]);
    const again = await upsertTelegramCustomer(w.rt, { id: 5001, first_name: "Ali", username: "ali2", language_code: "ru" });
    expect(again).toBe(id);
    const row = (await w.rt.pool.query("SELECT language, username FROM customers WHERE id = $1", [id])).rows[0];
    expect(row).toMatchObject({ language: "uz", username: "ali2" });
  });
});
