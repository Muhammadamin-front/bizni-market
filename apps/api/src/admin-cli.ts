import { createAdmin, createRuntime, loadEnv, passwordProblem } from "@shop/core";
import { adminUsers, eq, runMigrations } from "@shop/db";
import { hashPassword } from "@shop/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `pnpm admin:create <email> <password>` creates an admin, or resets the password of an existing one. */
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: admin-create <email> <password>");
  process.exit(2);
}
const problem = passwordProblem(password, email);
if (problem) {
  console.error(problem);
  process.exit(2);
}
const env = loadEnv();
const rt = createRuntime(env, "admin-cli");
const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = [path.resolve(here, "../drizzle"), path.resolve(here, "../../../packages/db/drizzle")].find((p) => existsSync(path.join(p, "meta/_journal.json")));
if (migrations) await runMigrations(rt.pool, migrations);
const [existing] = await rt.db.select().from(adminUsers).where(eq(adminUsers.email, email.toLowerCase())).limit(1);
if (existing) {
  await rt.db.update(adminUsers).set({ passwordHash: await hashPassword(password), failedAttempts: 0, lockedUntil: null }).where(eq(adminUsers.id, existing.id));
  console.log(`password updated for ${email}`);
} else {
  await createAdmin(rt, email, password);
  console.log(`admin created: ${email}`);
}
await rt.close();
