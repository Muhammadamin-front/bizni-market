import { eq, integrationSettings, syncState } from "@shop/db";
import { DEFAULT_SETTINGS, IntegrationSettingsSchema, type IntegrationSettings } from "@shop/shared";
import type { Runtime } from "./runtime";

const KEY = "integration";

export async function loadSettings(rt: Pick<Runtime, "db">): Promise<IntegrationSettings> {
  const [row] = await rt.db.select().from(integrationSettings).where(eq(integrationSettings.key, KEY)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  const parsed = IntegrationSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(rt: Pick<Runtime, "db">, patch: Partial<IntegrationSettings>): Promise<IntegrationSettings> {
  const current = await loadSettings(rt);
  const next = IntegrationSettingsSchema.parse({ ...current, ...patch });
  await rt.db
    .insert(integrationSettings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: integrationSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

export async function getState<T>(rt: Pick<Runtime, "db">, key: string): Promise<T | null> {
  const [row] = await rt.db.select().from(syncState).where(eq(syncState.key, key)).limit(1);
  return (row?.value as T | undefined) ?? null;
}

export async function setState(rt: Pick<Runtime, "db">, key: string, value: unknown): Promise<void> {
  await rt.db
    .insert(syncState)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
}

export interface SettingsReport {
  settings: IntegrationSettings;
  /** What the account offers, for the admin pickers. */
  options: {
    priceTypes: { id: string; name: string }[];
    stores: { id: string; name: string }[];
    organizations: { id: string; name: string }[];
    salesChannels: { id: string; name: string }[];
    states: { id: string; name: string; stateType?: string }[];
    attributes: { id: string; name: string; type?: string }[];
  };
  warnings: string[];
}

export async function loadAccountOptions(rt: Runtime): Promise<SettingsReport["options"] | null> {
  if (!rt.ms) return null;
  const [priceTypes, stores, organizations, salesChannels, states, attributes] = await Promise.all([
    rt.ms.priceTypes(),
    rt.ms.stores(),
    rt.ms.organizations(),
    rt.ms.salesChannels(),
    rt.ms.orderStates(),
    rt.ms.productAttributes(),
  ]);
  const named = (r: { id: string; name?: string }) => ({ id: r.id, name: r.name ?? r.id });
  return {
    priceTypes: priceTypes.map(named),
    stores: stores.map(named),
    organizations: organizations.map(named),
    salesChannels: salesChannels.map(named),
    states: states.map((s) => ({ id: s.id, name: s.name, stateType: s.stateType })),
    attributes: attributes.map((a) => ({ id: a.id, name: a.name, type: a.type })),
  };
}

const RETAIL = /chakana|roznich|розниц|retail/i;
const BRAND = /brend|brand|бренд|marka|марка/i;
const OLD_PRICE = /eski|old|старая|прежн|akciya|aksiya|promo|до скидки/i;

/**
 * Fills ONLY empty settings, and only when the choice is unambiguous (exactly one option, or one clearly named match).
 * Anything ambiguous stays empty and is reported as a warning for the owner to pick in the admin.
 */
export async function autoConfigure(rt: Runtime): Promise<SettingsReport | null> {
  const options = await loadAccountOptions(rt);
  if (!options) return null;
  const s = await loadSettings(rt);
  const patch: Partial<IntegrationSettings> = {};
  const warnings: string[] = [];

  const one = <T extends { id: string }>(list: T[]) => (list.length === 1 ? list[0]!.id : "");

  if (!s.priceTypeId) {
    const pick = one(options.priceTypes) || (options.priceTypes.filter((p) => RETAIL.test(p.name)).length === 1 ? options.priceTypes.find((p) => RETAIL.test(p.name))!.id : "");
    if (pick) patch.priceTypeId = pick;
    else warnings.push("Narx turi tanlanmagan: bir nechta narx turi bor. Admin → Sozlamalar da chakana narxni tanlang.");
  }
  const chosenRetail = patch.priceTypeId ?? s.priceTypeId;
  if (!s.oldPriceTypeId) {
    // Optional: a price type named like "old price" lets the site show a genuine strike-through price. Silence if there is none.
    const match = options.priceTypes.filter((p) => OLD_PRICE.test(p.name) && p.id !== chosenRetail);
    if (match.length === 1) patch.oldPriceTypeId = match[0]!.id;
  }
  if (!s.brandAttributeId) {
    const match = options.attributes.filter((a) => BRAND.test(a.name));
    if (match.length === 1) patch.brandAttributeId = match[0]!.id;
    else warnings.push("Brend maydoni topilmadi: brend yetkazuvchidan olinadi yoki koʻrsatilmaydi. Admin → Sozlamalar da tanlang.");
  }
  if (!s.organizationId) {
    const pick = one(options.organizations);
    if (pick) patch.organizationId = pick;
    else warnings.push("Buyurtmalar uchun tashkilot tanlanmagan.");
  }
  if (!s.orderStoreId) {
    const pick = one(options.stores);
    if (pick) patch.orderStoreId = pick;
  }
  if (!s.initialStateId && options.states[0]) patch.initialStateId = options.states[0].id;

  const settings = Object.keys(patch).length ? await saveSettings(rt, patch) : s;
  return { settings, options, warnings };
}
