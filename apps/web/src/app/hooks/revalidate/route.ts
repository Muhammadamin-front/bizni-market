import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Called by the worker after a sync changed something, and by the API after an owner's edit, so cached catalogue pages refresh at once
 * instead of on their timer. `immediate` = the next view must already be fresh (an owner checking their edit); otherwise stale-while-revalidate.
 */
export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET ?? "";
  const given = request.headers.get("x-revalidate-secret") ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { tags?: unknown; immediate?: unknown };
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string").slice(0, 10) : ["catalog"];
  for (const tag of tags) revalidateTag(tag, body.immediate === true ? { expire: 0 } : "max");
  return NextResponse.json({ ok: true, tags });
}
