import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { adminSessions, adminUsers, auditLog, customers, eq, lt } from "@shop/db";
import { z } from "zod";
import type { Runtime } from "./runtime";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// ------------------------------------------------------------------------------------------------ passwords

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const COMMON = new Set(["password1234", "123456789012", "qwertyuiop12", "admin1234567", "administrator", "changeme1234", "letmein12345", "welcome12345"]);

/** Returns a problem description, or null when the password is acceptable. */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < 12) return "Parol kamida 12 belgidan iborat boʻlishi kerak.";
  if (COMMON.has(password.toLowerCase())) return "Parol juda oddiy.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "Parolda email boʻlmasligi kerak.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return "Parolda kichik va katta harf, raqam yoki belgi aralash boʻlishi kerak.";
  return null;
}

// ------------------------------------------------------------------------------------------------ TOTP (RFC 6238)

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totp(secretBase32: string, atMs = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 30_000), digits);
}

/** Accepts the current 30 s step and one step either side (clock drift). */
export function verifyTotp(secretBase32: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const step = Math.floor(atMs / 30_000);
  return [-1, 0, 1].some((d) => {
    const expected = Buffer.from(hotp(secret, step + d));
    const given = Buffer.from(code);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));
export const totpUri = (email: string, secret: string, issuer = "Bizni Market"): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

// ------------------------------------------------------------------------------------------------ admin accounts & sessions

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const SESSION_MS = 12 * 3_600_000;
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export class AuthError extends Error {
  constructor(
    readonly code: "invalid_credentials" | "locked" | "totp_required" | "weak_password",
    message?: string,
  ) {
    super(message ?? code);
  }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function createAdmin(rt: Runtime, email: string, password: string): Promise<string> {
  const problem = passwordProblem(password, email);
  if (problem) throw new AuthError("weak_password", problem);
  const [row] = await rt.db
    .insert(adminUsers)
    .values({ email: email.trim().toLowerCase(), passwordHash: await hashPassword(password) })
    .returning({ id: adminUsers.id });
  return row!.id;
}

/** Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when none exists. Never touches an existing admin. */
export async function bootstrapAdmin(rt: Runtime): Promise<"created" | "exists" | "skipped"> {
  const existing = await rt.db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
  if (existing.length) return "exists";
  if (!rt.env.ADMIN_EMAIL || !rt.env.ADMIN_PASSWORD) {
    rt.log.warn("No admin exists and ADMIN_EMAIL/ADMIN_PASSWORD are not set: /admin is locked. Run `pnpm admin:create`.");
    return "skipped";
  }
  try {
    await createAdmin(rt, rt.env.ADMIN_EMAIL, rt.env.ADMIN_PASSWORD);
  } catch (err) {
    // api and worker boot together on a fresh database and both try: the loser finds the admin already there.
    if ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") return "exists";
    throw err;
  }
  rt.log.info({ email: rt.env.ADMIN_EMAIL }, "first admin created from environment");
  return "created";
}

export async function loginAdmin(rt: Runtime, email: string, password: string, totpCode: string | undefined, meta: { ip: string; userAgent: string }): Promise<{ token: string; expiresAt: Date; adminId: string }> {
  const [user] = await rt.db.select().from(adminUsers).where(eq(adminUsers.email, email.trim().toLowerCase())).limit(1);
  // Always do one hash verification, so "no such user" and "wrong password" take the same time.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user) throw new AuthError("invalid_credentials");
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AuthError("locked");

  const fail = async () => {
    const attempts = user.failedAttempts + 1;
    await rt.db
      .update(adminUsers)
      .set({ failedAttempts: attempts >= MAX_FAILED_LOGINS ? 0 : attempts, lockedUntil: attempts >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null })
      .where(eq(adminUsers.id, user.id));
    throw new AuthError(attempts >= MAX_FAILED_LOGINS ? "locked" : "invalid_credentials");
  };

  if (!passwordOk) return fail();
  if (user.totpEnabled && user.totpSecret) {
    if (!totpCode) throw new AuthError("totp_required");
    if (!verifyTotp(user.totpSecret, totpCode)) return fail();
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await rt.db.insert(adminSessions).values({ id: sha256(token), adminId: user.id, expiresAt, ip: meta.ip, userAgent: meta.userAgent.slice(0, 200) });
  await rt.db.update(adminUsers).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  await rt.db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date())); // housekeeping
  return { token, expiresAt, adminId: user.id };
}

export interface AdminSession {
  adminId: string;
  email: string;
  totpEnabled: boolean;
}

export async function getAdminSession(rt: Runtime, token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  const [row] = await rt.db
    .select({ expiresAt: adminSessions.expiresAt, adminId: adminUsers.id, email: adminUsers.email, totpEnabled: adminUsers.totpEnabled })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(eq(adminSessions.id, sha256(token)))
    .limit(1);
  if (!row || row.expiresAt < new Date()) return null;
  return { adminId: row.adminId, email: row.email, totpEnabled: row.totpEnabled };
}

export async function logoutAdmin(rt: Runtime, token: string): Promise<void> {
  await rt.db.delete(adminSessions).where(eq(adminSessions.id, sha256(token)));
}

export async function audit(rt: Pick<Runtime, "db">, adminId: string | null, action: string, entity: string, entityId: string | null, meta: Record<string, unknown> = {}): Promise<void> {
  await rt.db.insert(auditLog).values({ adminId, action, entity, entityId, meta });
}

// ------------------------------------------------------------------------------------------------ Telegram Mini App identity

const TgUser = z.object({
  id: z.number().int(),
  first_name: z.string().default(""),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});
export type TgUser = z.infer<typeof TgUser>;

export type InitDataResult = { ok: true; user: TgUser; authDate: number } | { ok: false; reason: "missing_hash" | "bad_hash" | "expired" | "bad_user" | "no_bot_token" };

/**
 * Validates Mini App `initData` exactly as documented by Telegram:
 * secret = HMAC_SHA256(key="WebAppData", data=bot_token); hash = HMAC_SHA256(key=secret, data=data_check_string), where the data-check-string
 * is every field except `hash`, sorted by key, as `key=value` lines joined by "\n". Compared in constant time; stale data is refused.
 * (Telegram's newer `signature` field is part of the string for this HMAC method; a variant without it is also accepted because either
 * way the proof requires the bot token.)
 */
export function validateInitData(initData: string, botToken: string, maxAgeSeconds: number, now = Date.now()): InitDataResult {
  if (!botToken) return { ok: false, reason: "no_bot_token" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: "missing_hash" };

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const check = (exclude: string[]) => {
    const lines = [...params.entries()]
      .filter(([k]) => !exclude.includes(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const expected = createHmac("sha256", secret).update(lines).digest();
    const given = Buffer.from(hash, "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
  };
  if (!check(["hash"]) && !check(["hash", "signature"])) return { ok: false, reason: "bad_hash" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "expired" };
  const ageSeconds = now / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds || ageSeconds < -300) return { ok: false, reason: "expired" };

  try {
    const user = TgUser.parse(JSON.parse(params.get("user") ?? ""));
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: "bad_user" };
  }
}

export async function upsertTelegramCustomer(rt: Pick<Runtime, "db">, user: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string }): Promise<string> {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const language = user.language_code?.startsWith("ru") ? "ru" : "uz";
  const [row] = await rt.db
    .insert(customers)
    .values({ telegramId: user.id, username: user.username ?? null, name, language })
    // `language` is deliberately NOT updated: once the customer picked one in the app, Telegram's UI language must not overwrite it.
    .onConflictDoUpdate({ target: customers.telegramId, set: { username: user.username ?? null } })
    .returning({ id: customers.id });
  return row!.id;
}

// Signed bearer token for the Mini App. Not a cookie: inside web.telegram.org the app runs in a third-party iframe where cookies are unreliable.
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export interface TmaToken {
  cid: string;
  tg: number;
  exp: number;
}

export function signTmaToken(secret: string, payload: Omit<TmaToken, "exp">, ttlSeconds = 12 * 3600, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds }));
  const sig = createHmac("sha256", `tma-token:${secret}`).update(body).digest();
  return `${body}.${b64(sig)}`;
}

export function verifyTmaToken(secret: string, token: string | undefined, now = Date.now()): TmaToken | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", `tma-token:${secret}`).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TmaToken;
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}
