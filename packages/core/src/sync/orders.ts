import { eq, inArray, orders, sql } from "@shop/db";
import type { RawCustomerOrder } from "@shop/moysklad";
import { queueNotification } from "../notify";
import type { Runtime } from "../runtime";
import { getState, loadSettings, setState } from "../settings";
import { texts } from "../texts";
import { withRun, type Trigger } from "./common";

const STATES_KEY = "ms_order_states";
const WATERMARK = "orders_watermark";
const OVERLAP_MS = 5 * 60_000;
const FINAL = new Set(["Successful", "Unsuccessful"]);

export interface CachedState {
  id: string;
  name: string;
  stateType: string;
}

/** Order states change rarely; cache them for an hour so mapping a state id to a name costs no MoySklad request. */
export async function getOrderStates(rt: Runtime): Promise<CachedState[]> {
  const cached = await getState<{ at: string; states: CachedState[] }>(rt, STATES_KEY);
  if (cached && Date.now() - new Date(cached.at).getTime() < 3_600_000) return cached.states;
  if (!rt.ms) return cached?.states ?? [];
  const states = (await rt.ms.orderStates()).map((s) => ({ id: s.id, name: s.name, stateType: s.stateType ?? "Regular" }));
  await setState(rt, STATES_KEY, { at: new Date().toISOString(), states });
  return states;
}

/** Applies a MoySklad order's current state to ours; notifies the customer when it changed. */
export async function applyRemoteOrder(rt: Runtime, remote: RawCustomerOrder): Promise<boolean> {
  const stateName = remote.state?.name;
  if (!stateName) return false;
  const [ours] = await rt.db
    .select()
    .from(orders)
    .where(sql`${orders.msOrderId} = ${remote.id} OR ${orders.msSyncId}::text = ${remote.syncId ?? "00000000-0000-0000-0000-000000000000"}`)
    .limit(1);
  if (!ours || ours.msState === stateName) return false;

  await rt.db
    .update(orders)
    .set({ msOrderId: ours.msOrderId ?? remote.id, msState: stateName, msStateType: remote.state?.stateType ?? ours.msStateType, updatedAt: new Date() })
    .where(eq(orders.id, ours.id));
  await queueNotification(rt, {
    kind: "order_status",
    chatId: ours.telegramId,
    text: texts.orderStatus(ours.language === "ru" ? "ru" : "uz", ours.number, stateName),
  });
  return true;
}

/** Polling fallback for status changes made by staff in MoySklad (webhooks only lower the latency). */
export async function pollOrderStates(rt: Runtime, trigger: Trigger): Promise<void> {
  await withRun(rt, "order_states", trigger, async (counts) => {
    const open = await rt.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.syncStatus, "synced"));
    if ((open[0]?.n ?? 0) === 0) return;
    const s = await loadSettings(rt);
    const wm = await getState<string>(rt, WATERMARK);
    const since = wm ? new Date(new Date(wm).getTime() - OVERLAP_MS) : new Date(Date.now() - 24 * 3_600_000);
    let max = wm ? new Date(wm) : new Date(0);
    for await (const page of rt.ms!.ordersChangedSince(since, s.filterTimezoneOffsetHours)) {
      for (const remote of page) {
        counts.seen = (counts.seen ?? 0) + 1;
        if (await applyRemoteOrder(rt, remote)) counts.changed = (counts.changed ?? 0) + 1;
        if (remote.updated) {
          const t = new Date(remote.updated.replace(" ", "T") + "+03:00");
          if (t > max) max = t;
        }
      }
    }
    if (max.getTime() > 0) await setState(rt, WATERMARK, max.toISOString());
  });
}

export { FINAL as FINAL_STATE_TYPES, inArray };
