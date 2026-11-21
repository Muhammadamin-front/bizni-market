import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { generateDataset, IDS, STATES, uuidFrom, type Dataset, type MockFolder, type MockProduct } from "./data";
import { artSvg } from "./art";

/*
 * A synthetic MoySklad. It encodes the facts verified from the vendor docs (docs/moysklad-api-notes.md), NOT assumptions
 * about any particular account: 415 without gzip, `expand` ignored above limit=100, MSK timestamps, money in hundredths,
 * missing stock rows meaning zero, changedSince limits, 429 with Retry-After, syncId filters, webhooks, a 45-unit/3 s basket.
 * Two behaviours the docs leave open are SWITCHES, not baked in: the timezone used for filter input and whether archived
 * products are listed by default. Contract tests built on this are "synthetic fixtures", not real recordings.
 */

export interface MockConfig {
  token: string;
  /** Public base URL of this mock, used in downloadHref and meta hrefs. */
  publicUrl: string;
  /** How filter/changedSince input is interpreted. 3 = Moscow time (matches the output), 0 = UTC. */
  filterTimezoneOffsetHours: number;
  /** When false (the assumed default) archived products only appear if the filter asks for them. */
  archivedInLists: boolean;
  rateLimit: { enabled: boolean; capacityUnits: number; windowMs: number; weight: number; stockWeight: number; maxConcurrent: number };
  requireGzip: boolean;
  /** Adds this many ms to every response. */
  latencyMs: number;
}

export interface Fault {
  /** Substring of the request path; empty matches everything. */
  match?: string;
  method?: string;
  status?: number;
  /** Abort the connection instead of answering (simulates a lost response; the request is still processed when `afterProcessing`). */
  drop?: boolean;
  /** Process the request normally, then cut the connection before the answer is sent (a lost response). */
  dropAfter?: boolean;
  delayMs?: number;
  remaining: number;
}

interface Counterparty {
  id: string;
  name: string;
  phone: string;
  actualAddress: string;
  syncId?: string;
  tags: string[];
  description: string;
}

interface OrderPosition {
  productId: string;
  quantity: number;
  priceMinor: number;
  reserve: number;
}

interface Order {
  id: string;
  name: string;
  externalCode: string;
  syncId?: string;
  description: string;
  shipmentAddress: string;
  organizationId: string;
  agentId: string;
  storeId?: string;
  salesChannelId?: string;
  stateId: string;
  positions: OrderPosition[];
  created: Date;
  updated: Date;
}

interface Webhook {
  id: string;
  url: string;
  action: string;
  entityType: string;
  enabled: boolean;
}
interface StockWebhook {
  id: string;
  url: string;
  stockType: string;
  reportType: string;
  enabled: boolean;
}

export const DEFAULT_CONFIG: MockConfig = {
  token: "demo-token",
  publicUrl: "http://localhost:4010",
  filterTimezoneOffsetHours: 3,
  archivedInLists: false,
  rateLimit: { enabled: true, capacityUnits: 45, windowMs: 3000, weight: 4, stockWeight: 5, maxConcurrent: 5 },
  requireGzip: true,
  latencyMs: 0,
};

const API = "/api/remap/1.2";
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function fmtMsk(d: Date): string {
  const s = new Date(d.getTime() + 3 * 3_600_000);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}.${pad(s.getUTCMilliseconds(), 3)}`;
}

function parseInput(value: string, offsetHours: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, m[7] ? +m[7].padEnd(3, "0") : 0) - offsetHours * 3_600_000);
}

type Cond = { field: string; op: string; value: string };
function parseFilter(raw: string | undefined): Cond[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((part) => /^([A-Za-z.]+)(>=|<=|!=|=|>|<|~)(.*)$/.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ field: m[1]!, op: m[2]!, value: m[3]! }));
}

export class MockMoySklad {
  config: MockConfig;
  dataset: Dataset;
  counterparties: Counterparty[] = [];
  orders: Order[] = [];
  webhooks: Webhook[] = [];
  stockWebhooks: StockWebhook[] = [];
  faults: Fault[] = [];
  stockUpdated = new Map<string, Date>();
  stats = { requests: 0, rateLimited: 0, errors: 0, byPath: {} as Record<string, number> };
  private window: number[] = [];
  private inFlight = 0;
  private stockTimer: NodeJS.Timeout | null = null;
  now: () => number = Date.now;

  constructor(config: Partial<MockConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...config.rateLimit } };
    this.dataset = generateDataset(new Date());
    for (const p of this.dataset.products) this.stockUpdated.set(p.id, new Date(this.now() - 3_600_000));
  }

  reset() {
    this.dataset = generateDataset(new Date());
    this.counterparties = [];
    this.orders = [];
    this.faults = [];
    this.window = [];
    this.stats = { requests: 0, rateLimited: 0, errors: 0, byPath: {} };
    for (const p of this.dataset.products) this.stockUpdated.set(p.id, new Date(this.now() - 3_600_000));
  }

  href(path: string) {
    return `${this.config.publicUrl}${API}/${path}`;
  }

  folderOf(p: MockProduct): MockFolder {
    return this.dataset.folders.find((f) => f.id === p.folderId)!;
  }

  reserveOf(productId: string): number {
    const final = new Set(STATES.filter((s) => s.stateType !== "Regular").map((s) => s.id));
    return this.orders
      .filter((o) => !final.has(o.stateId as never))
      .flatMap((o) => o.positions)
      .filter((pos) => pos.productId === productId)
      .reduce((sum, pos) => sum + pos.reserve, 0);
  }

  stockOf(p: MockProduct, storeId?: string): { stock: number; reserve: number; free: number } {
    const stock = storeId ? (p.stock[storeId] ?? 0) : Object.values(p.stock).reduce((a, b) => a + b, 0);
    const reserve = this.reserveOf(p.id);
    return { stock, reserve, free: stock - reserve };
  }

  // ------------------------------------------------------------------------------------------ mutations (demo + tests)

  touchProduct(id: string, patch: { priceUzs?: number; oldPriceUzs?: number | null; stock?: number; archived?: boolean; name?: string }) {
    const p = this.dataset.products.find((x) => x.id === id);
    if (!p) return null;
    if (patch.priceUzs !== undefined) p.priceMinor = patch.priceUzs * 100;
    if (patch.oldPriceUzs !== undefined) p.oldPriceMinor = patch.oldPriceUzs === null ? null : patch.oldPriceUzs * 100;
    if (patch.archived !== undefined) p.archived = patch.archived;
    if (patch.name !== undefined) p.name = patch.name;
    const touchedStock = patch.stock !== undefined;
    if (touchedStock) {
      const store = Object.keys(p.stock)[0] ?? IDS.storeStationery;
      p.stock[store] = patch.stock!;
      this.stockUpdated.set(p.id, new Date(this.now()));
    }
    // Stock is not a product field in MoySklad: changing stock does not bump the product's `updated`.
    if (patch.priceUzs !== undefined || patch.oldPriceUzs !== undefined || patch.archived !== undefined || patch.name !== undefined) {
      p.updated = new Date(this.now());
      this.fire("product", "UPDATE", this.href(`entity/product/${p.id}`), "product");
    }
    if (touchedStock) this.fireStock();
    return p;
  }

  setOrderState(orderId: string, stateName: string, silent = false) {
    const o = this.orders.find((x) => x.id === orderId);
    const state = STATES.find((s) => s.name === stateName || s.id === stateName);
    if (!o || !state) return null;
    o.stateId = state.id;
    o.updated = new Date(this.now());
    if (!silent) this.fire("customerorder", "UPDATE", this.href(`entity/customerorder/${o.id}`), "customerorder");
    return o;
  }

  // ------------------------------------------------------------------------------------------ webhooks

  fire(entityType: string, action: string, href: string, type: string, disablePrefix?: string) {
    for (const w of this.webhooks) {
      if (!w.enabled || w.entityType !== entityType || w.action !== action) continue;
      if (disablePrefix && w.url.startsWith(disablePrefix)) continue;
      const url = `${w.url}${w.url.includes("?") ? "&" : "?"}requestId=${randomUUID()}`;
      const body = { auditContext: { meta: { type: "audit", href: this.href("audit/x") }, uid: "demo@demo", moment: fmtMsk(new Date(this.now())) }, events: [{ meta: { type, href }, action, accountId: IDS.account }] };
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) }).catch(() => undefined);
    }
  }

  fireStock() {
    if (this.stockTimer) return;
    this.stockTimer = setTimeout(() => {
      this.stockTimer = null;
      for (const w of this.stockWebhooks) {
        if (!w.enabled) continue;
        const since = fmtMsk(new Date(this.now() - 60_000)).slice(0, 19);
        const body = { accountId: IDS.account, stockType: w.stockType, reportType: w.reportType, reportUrl: this.href(`report/stock/${w.reportType}/current?changedSince=${encodeURIComponent(since)}`) };
        const url = `${w.url}${w.url.includes("?") ? "&" : "?"}requestId=${randomUUID()}`;
        void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) }).catch(() => undefined);
      }
    }, 1000);
    this.stockTimer.unref?.();
  }

  // ------------------------------------------------------------------------------------------ rendering

  renderFolder(f: MockFolder) {
    return {
      meta: { href: this.href(`entity/productfolder/${f.id}`), type: "productfolder", mediaType: "application/json" },
      id: f.id,
      name: f.name,
      pathName: f.pathName,
      archived: false,
      updated: fmtMsk(f.updated),
      ...(f.parentId ? { productFolder: { meta: { href: this.href(`entity/productfolder/${f.parentId}`), type: "productfolder" } } } : {}),
    };
  }

  renderImage(p: MockProduct, imageId: string) {
    return {
      meta: { href: this.href(`entity/product/${p.id}/images/${imageId}`), type: "image", mediaType: "application/json", downloadHref: this.href(`download/${imageId}`) },
      title: `${p.code}.svg`,
      filename: `${p.code}.svg`,
      size: 2048,
      updated: fmtMsk(p.updated),
    };
  }

  renderProduct(p: MockProduct, expand: string[]) {
    const folder = this.folderOf(p);
    const path = folder.pathName ? `${folder.pathName}/${folder.name}` : folder.name;
    const prices = [
      { value: p.priceMinor, priceType: { meta: { href: this.href(`context/companysettings/pricetype/${IDS.priceRetail}`), type: "pricetype" }, id: IDS.priceRetail, name: "Chakana narx" } },
      { value: Math.round(p.priceMinor * 0.85), priceType: { meta: { href: this.href(`context/companysettings/pricetype/${IDS.priceWholesale}`), type: "pricetype" }, id: IDS.priceWholesale, name: "Ulgurji narx" } },
      ...(p.oldPriceMinor ? [{ value: p.oldPriceMinor, priceType: { meta: { href: this.href(`context/companysettings/pricetype/${IDS.priceOld}`), type: "pricetype" }, id: IDS.priceOld, name: "Eski narx" } }] : []),
    ];
    const uomMeta = { href: this.href(`entity/uom/${uuidFrom(`uom:${p.uom}`)}`), type: "uom" };
    return {
      meta: { href: this.href(`entity/product/${p.id}`), type: "product", mediaType: "application/json" },
      id: p.id,
      name: p.name,
      code: p.code,
      externalCode: p.externalCode,
      article: p.article,
      description: p.description,
      archived: p.archived,
      updated: fmtMsk(p.updated),
      pathName: path,
      productFolder: expand.includes("productFolder")
        ? { meta: { href: this.href(`entity/productfolder/${folder.id}`), type: "productfolder" }, id: folder.id, name: folder.name, pathName: folder.pathName }
        : { meta: { href: this.href(`entity/productfolder/${folder.id}`), type: "productfolder" } },
      uom: expand.includes("uom") ? { meta: uomMeta, name: p.uom } : { meta: uomMeta },
      images: expand.includes("images")
        ? { meta: { href: this.href(`entity/product/${p.id}/images`), size: p.imageIds.length, limit: 1000, offset: 0 }, rows: p.imageIds.map((i) => this.renderImage(p, i)) }
        : { meta: { href: this.href(`entity/product/${p.id}/images`), size: p.imageIds.length } },
      salePrices: prices,
      barcodes: p.barcodes.map((b) => ({ ean13: b })),
      packs: p.packQty ? [{ id: uuidFrom(`pack:${p.id}`), quantity: p.packQty, uom: { meta: uomMeta, name: "qadoq" } }] : [],
      attributes: [{ meta: { href: this.href(`entity/product/metadata/attributes/${IDS.brandAttr}`), type: "attributemetadata" }, id: IDS.brandAttr, name: "Brend", type: "string", value: p.brand }],
      variantsCount: 0,
    };
  }

  renderOrder(o: Order, expand: string[]) {
    const state = STATES.find((s) => s.id === o.stateId)!;
    return {
      meta: { href: this.href(`entity/customerorder/${o.id}`), type: "customerorder", mediaType: "application/json" },
      id: o.id,
      name: o.name,
      externalCode: o.externalCode,
      ...(o.syncId ? { syncId: o.syncId } : {}),
      description: o.description,
      shipmentAddress: o.shipmentAddress,
      moment: fmtMsk(o.created),
      updated: fmtMsk(o.updated),
      sum: o.positions.reduce((s, p) => s + p.priceMinor * p.quantity, 0),
      state: expand.includes("state")
        ? { meta: { href: this.href(`entity/customerorder/metadata/states/${state.id}`), type: "state" }, id: state.id, name: state.name, stateType: state.stateType }
        : { meta: { href: this.href(`entity/customerorder/metadata/states/${state.id}`), type: "state" } },
    };
  }

  renderCounterparty(c: Counterparty) {
    return { meta: { href: this.href(`entity/counterparty/${c.id}`), type: "counterparty" }, id: c.id, name: c.name, phone: c.phone, actualAddress: c.actualAddress, tags: c.tags, ...(c.syncId ? { syncId: c.syncId } : {}) };
  }

  // ------------------------------------------------------------------------------------------ request guards

  /** Returns a reply-producing function when the request must be rejected, otherwise null. */
  guard(req: FastifyRequest): { status: number; body?: unknown; headers?: Record<string, string>; drop?: boolean; dropAfter?: boolean; delayMs?: number } | null {
    const url = req.url;
    this.stats.requests++;
    const key = url.split("?")[0]!.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
    this.stats.byPath[key] = (this.stats.byPath[key] ?? 0) + 1;

    const auth = req.headers.authorization;
    if (auth !== `Bearer ${this.config.token}`) return { status: 401, body: { errors: [{ error: "Ошибка аутентификации: неверный токен", code: 1056, moreInfo: "https://dev.moysklad.ru/doc/api/remap/1.2/#mc-auth" }] } };

    if (this.config.requireGzip && !String(req.headers["accept-encoding"] ?? "").includes("gzip")) return { status: 415 };

    const rl = this.config.rateLimit;
    if (rl.enabled) {
      const t = this.now();
      this.window = this.window.filter((e) => e > t - rl.windowMs);
      const isStock = url.includes("/report/stock/");
      const weight = isStock ? rl.stockWeight : rl.weight;
      const reset = this.window[0] ? this.window[0] + rl.windowMs - t : rl.windowMs;
      if (this.inFlight >= rl.maxConcurrent) {
        this.stats.rateLimited++;
        return { status: 429, body: { errors: [{ error: "Превышено количество одновременных запросов", code: 1073 }] }, headers: { "X-Lognex-Retry-After": "1000" } };
      }
      if (this.window.length + weight > rl.capacityUnits) {
        this.stats.rateLimited++;
        return {
          status: 429,
          body: { errors: [{ error: "Превышено ограничение на частоту запросов", code: 1049 }] },
          headers: { "X-RateLimit-Limit": String(rl.capacityUnits), "X-RateLimit-Remaining": "0", "X-Lognex-Retry-TimeInterval": String(rl.windowMs), "X-Lognex-Reset": String(reset), "X-Lognex-Retry-After": String(reset) },
        };
      }
      for (let i = 0; i < weight; i++) this.window.push(t);
    }

    const fault = this.faults.find((f) => f.remaining > 0 && (!f.match || url.includes(f.match)) && (!f.method || f.method === req.method));
    if (fault) {
      fault.remaining--;
      return { status: fault.status ?? 200, drop: fault.drop, dropAfter: fault.dropAfter, delayMs: fault.delayMs, body: fault.status && fault.status >= 400 ? { errors: [{ error: `injected ${fault.status}`, code: 9999 }] } : undefined, headers: fault.status === 429 ? { "X-Lognex-Retry-After": "1000" } : undefined };
    }
    return null;
  }

  remaining(): number {
    const rl = this.config.rateLimit;
    const t = this.now();
    return Math.max(rl.capacityUnits - this.window.filter((e) => e > t - rl.windowMs).length, 0);
  }
  enter() {
    this.inFlight++;
  }
  leave() {
    this.inFlight--;
  }
}

function err(reply: FastifyReply, status: number, error: string, code = 3000) {
  return reply.code(status).send({ errors: [{ error, code }] });
}

export async function buildMockServer(config: Partial<MockConfig> = {}): Promise<{ app: FastifyInstance; mock: MockMoySklad }> {
  const mock = new MockMoySklad(config);
  const app = Fastify({ logger: false });

  const entered = new WeakSet<object>();
  const dropAfter = new WeakSet<object>();
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/__mock") || req.url === "/health") return;
    if (req.url.startsWith(`${API}/download/`)) return; // image links are fetched with the same token in real life, but keep demo previews simple
    const verdict = mock.guard(req);
    if (mock.config.latencyMs) await new Promise((r) => setTimeout(r, mock.config.latencyMs));
    if (verdict?.delayMs) await new Promise((r) => setTimeout(r, verdict.delayMs));
    if (verdict?.drop) {
      reply.raw.destroy();
      return reply;
    }
    if (verdict && verdict.status !== 200) {
      mock.stats.errors++;
      for (const [k, v] of Object.entries(verdict.headers ?? {})) reply.header(k, v);
      return reply.code(verdict.status).send(verdict.body ?? "");
    }
    if (verdict?.dropAfter) dropAfter.add(req);
    mock.enter();
    entered.add(req);
    reply.header("X-RateLimit-Limit", String(mock.config.rateLimit.capacityUnits));
    reply.header("X-RateLimit-Remaining", String(mock.remaining()));
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (dropAfter.has(req)) {
      reply.raw.destroy();
    }
    return payload;
  });
  app.addHook("onResponse", async (req) => {
    if (entered.has(req)) mock.leave();
  });

  app.get("/health", async () => ({ ok: true, products: mock.dataset.products.length }));

  type Q = Record<string, string | undefined>;
  const page = <T>(rows: T[], q: Q, expandLimitCap = false) => {
    const limit = Math.min(Math.max(Number(q.limit ?? 1000), 1), 1000);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    void expandLimitCap;
    return { meta: { size: rows.length, limit, offset }, rows: rows.slice(offset, offset + limit) };
  };

  // ---------------------------------------------------------------------------------------- product folders
  app.get(`${API}/entity/productfolder`, async (req) => {
    const q = req.query as Q;
    return page(mock.dataset.folders.map((f) => mock.renderFolder(f)), q);
  });

  // ---------------------------------------------------------------------------------------- products
  app.get(`${API}/entity/product`, async (req, reply) => {
    const q = req.query as Q;
    const conds = parseFilter(q.filter);
    const offsetHours = mock.config.filterTimezoneOffsetHours;
    let rows = [...mock.dataset.products];

    const archivedConds = conds.filter((c) => c.field === "archived");
    const wantsArchived = archivedConds.some((c) => c.value === "true");
    const wantsActive = archivedConds.some((c) => c.value === "false");
    if (archivedConds.length === 0) rows = mock.config.archivedInLists ? rows : rows.filter((p) => !p.archived);
    else rows = rows.filter((p) => (p.archived ? wantsArchived : wantsActive));

    const ids = conds.filter((c) => c.field === "id" && c.op === "=").map((c) => c.value);
    if (ids.length) rows = rows.filter((p) => ids.includes(p.id));
    for (const c of conds.filter((x) => x.field === "updated")) {
      const at = parseInput(c.value, offsetHours);
      if (!at) return err(reply, 400, `Неверный формат даты: ${c.value}`, 1020);
      rows = rows.filter((p) => (c.op === ">=" ? p.updated >= at : c.op === ">" ? p.updated > at : c.op === "<=" ? p.updated <= at : p.updated < at));
    }
    if (q.order?.startsWith("updated")) {
      const dir = q.order.endsWith("desc") ? -1 : 1;
      rows.sort((a, b) => (a.updated.getTime() - b.updated.getTime()) * dir);
    }

    const limit = Math.min(Math.max(Number(q.limit ?? 1000), 1), 1000);
    // Documented behaviour: expand is silently ignored when limit > 100.
    const expand = limit <= 100 ? (q.expand ?? "").split(",").filter(Boolean) : [];
    const p = page(rows, q);
    return { meta: p.meta, rows: p.rows.map((r) => mock.renderProduct(r, expand)) };
  });

  app.get(`${API}/entity/product/metadata/attributes`, async () => ({
    meta: { size: 1 },
    rows: [{ id: IDS.brandAttr, name: "Brend", type: "string", meta: { href: mock.href(`entity/product/metadata/attributes/${IDS.brandAttr}`) } }],
  }));

  app.get(`${API}/entity/product/:id/images`, async (req, reply) => {
    const p = mock.dataset.products.find((x) => x.id === (req.params as { id: string }).id);
    if (!p) return err(reply, 404, "Не найдено", 1021);
    return { meta: { size: p.imageIds.length }, rows: p.imageIds.map((i) => mock.renderImage(p, i)) };
  });

  app.get(`${API}/download/:imageId`, async (req, reply) => {
    const imageId = (req.params as { imageId: string }).imageId;
    const p = mock.dataset.products.find((x) => x.imageIds.includes(imageId));
    if (!p) return err(reply, 404, "Не найдено", 1021);
    return reply.header("Content-Type", "image/svg+xml").header("Cache-Control", "public, max-age=3600").send(artSvg(p.art, p.hue));
  });

  // ---------------------------------------------------------------------------------------- reports
  app.get(`${API}/report/stock/all/current`, async (req, reply) => {
    const q = req.query as Q;
    const stockType = q.stockType ?? "stock";
    if (!["stock", "freeStock", "quantity", "reserve", "inTransit"].includes(stockType)) return err(reply, 400, `Неверный stockType: ${stockType}`, 3000);
    let changedSince: Date | null = null;
    if (q.changedSince) {
      changedSince = parseInput(q.changedSince, mock.config.filterTimezoneOffsetHours);
      if (!changedSince) return err(reply, 400, "Неверный формат changedSince", 1020);
      if (changedSince.getTime() > mock.now() + 1000) return err(reply, 400, "Параметр changedSince не может быть в будущем", 3011);
      if (changedSince.getTime() < mock.now() - 24 * 3_600_000) return err(reply, 400, "Параметр changedSince не может быть старше 24 часов", 3012);
    }
    const includeZero = (q.include ?? "").includes("zeroLines") || changedSince !== null;
    const ids = q.assortmentId?.split(",");
    const rows = [];
    for (const p of mock.dataset.products) {
      if (ids && !ids.includes(p.id)) continue;
      const s = mock.stockOf(p, q.storeId);
      const value = stockType === "stock" ? s.stock : stockType === "freeStock" || stockType === "quantity" ? s.free : stockType === "reserve" ? s.reserve : 0;
      if (changedSince) {
        const changed = mock.stockUpdated.get(p.id)!;
        if (changed < changedSince && !(p.archived && p.updated >= changedSince)) continue;
        rows.push({ assortmentId: p.id, [stockType]: p.archived ? 0 : value });
        continue;
      }
      if (p.archived) continue;
      if (value === 0 && !includeZero) continue; // zero rows are omitted by default: a missing row means zero
      rows.push({ assortmentId: p.id, [stockType]: value });
    }
    return rows;
  });

  // ---------------------------------------------------------------------------------------- account metadata
  app.get(`${API}/context/companysettings/pricetype`, async () => [
    { meta: { href: mock.href(`context/companysettings/pricetype/${IDS.priceRetail}`) }, id: IDS.priceRetail, name: "Chakana narx", externalCode: "retail" },
    { meta: { href: mock.href(`context/companysettings/pricetype/${IDS.priceWholesale}`) }, id: IDS.priceWholesale, name: "Ulgurji narx", externalCode: "wholesale" },
    { meta: { href: mock.href(`context/companysettings/pricetype/${IDS.priceOld}`) }, id: IDS.priceOld, name: "Eski narx", externalCode: "old" },
  ]);
  app.get(`${API}/entity/organization`, async () => ({ meta: { size: 1 }, rows: [{ id: IDS.organization, name: "Demo MChJ", meta: { href: mock.href(`entity/organization/${IDS.organization}`) } }] }));
  app.get(`${API}/entity/store`, async () => ({
    meta: { size: 2 },
    rows: [
      { id: IDS.storeStationery, name: "Kanselyariya ombori", meta: { href: mock.href(`entity/store/${IDS.storeStationery}`) } },
      { id: IDS.storeGrocery, name: "Oziq-ovqat ombori", meta: { href: mock.href(`entity/store/${IDS.storeGrocery}`) } },
    ],
  }));
  app.get(`${API}/entity/saleschannel`, async () => ({
    meta: { size: 2 },
    rows: [
      { id: IDS.channelWeb, name: "Veb-sayt", meta: { href: mock.href(`entity/saleschannel/${IDS.channelWeb}`) } },
      { id: IDS.channelTma, name: "Telegram", meta: { href: mock.href(`entity/saleschannel/${IDS.channelTma}`) } },
    ],
  }));
  app.get(`${API}/entity/customerorder/metadata`, async () => ({
    states: STATES.map((s) => ({ ...s, meta: { href: mock.href(`entity/customerorder/metadata/states/${s.id}`), type: "state" } })),
  }));

  // ---------------------------------------------------------------------------------------- counterparties
  app.get(`${API}/entity/counterparty`, async (req) => {
    const q = req.query as Q;
    let rows = mock.counterparties;
    for (const c of parseFilter(q.filter)) {
      if (c.field === "phone") rows = rows.filter((x) => x.phone === c.value);
      if (c.field === "syncId") rows = rows.filter((x) => x.syncId === c.value);
    }
    const p = page(rows, q);
    return { meta: p.meta, rows: p.rows.map((c) => mock.renderCounterparty(c)) };
  });
  app.post(`${API}/entity/counterparty`, async (req, reply) => {
    const b = req.body as Partial<Counterparty> | undefined;
    if (!b?.name) return err(reply, 400, "Не указано наименование контрагента", 3000);
    if (b.syncId && mock.counterparties.some((c) => c.syncId === b.syncId)) return err(reply, 412, "syncId уже используется", 3006);
    const c: Counterparty = { id: randomUUID(), name: b.name, phone: b.phone ?? "", actualAddress: b.actualAddress ?? "", syncId: b.syncId, tags: b.tags ?? [], description: b.description ?? "" };
    mock.counterparties.push(c);
    return mock.renderCounterparty(c);
  });

  // ---------------------------------------------------------------------------------------- customer orders
  const idOf = (ref: unknown): string => {
    const href = (ref as { meta?: { href?: string } } | undefined)?.meta?.href ?? "";
    return href.split("?")[0]!.split("/").pop() ?? "";
  };

  app.get(`${API}/entity/customerorder`, async (req) => {
    const q = req.query as Q;
    const expand = (q.expand ?? "").split(",");
    let rows = [...mock.orders];
    for (const c of parseFilter(q.filter)) {
      if (c.field === "syncId") rows = rows.filter((o) => o.syncId === c.value);
      if (c.field === "updated") {
        const at = parseInput(c.value, mock.config.filterTimezoneOffsetHours);
        if (at) rows = rows.filter((o) => o.updated >= at);
      }
    }
    rows.sort((a, b) => a.updated.getTime() - b.updated.getTime());
    const p = page(rows, q);
    return { meta: p.meta, rows: p.rows.map((o) => mock.renderOrder(o, expand)) };
  });
  app.get(`${API}/entity/customerorder/:id`, async (req, reply) => {
    const o = mock.orders.find((x) => x.id === (req.params as { id: string }).id);
    if (!o) return err(reply, 404, "Не найдено", 1021);
    return mock.renderOrder(o, ((req.query as Q).expand ?? "").split(","));
  });
  app.post(`${API}/entity/customerorder`, async (req, reply) => {
    const b = req.body as Record<string, unknown> | undefined;
    if (!b || !idOf(b.organization)) return err(reply, 400, "Не указана организация", 3000);
    if (!idOf(b.agent)) return err(reply, 400, "Не указан контрагент", 3000);
    const syncId = typeof b.syncId === "string" ? b.syncId : undefined;
    if (syncId && mock.orders.some((o) => o.syncId === syncId)) return err(reply, 412, "syncId уже используется", 3006);
    const positions = ((b.positions as unknown[]) ?? []).map((raw) => {
      const pos = raw as { assortment?: unknown; quantity?: number; price?: number; reserve?: number };
      return { productId: idOf(pos.assortment), quantity: pos.quantity ?? 0, priceMinor: pos.price ?? 0, reserve: pos.reserve ?? 0 };
    });
    if (positions.some((pos) => !mock.dataset.products.some((p) => p.id === pos.productId))) return err(reply, 400, "Товар не найден", 3000);
    const now = new Date(mock.now());
    const o: Order = {
      id: randomUUID(),
      name: typeof b.name === "string" && b.name ? b.name : String(mock.orders.length + 1).padStart(5, "0"),
      externalCode: typeof b.externalCode === "string" ? b.externalCode : "",
      syncId,
      description: typeof b.description === "string" ? b.description : "",
      shipmentAddress: typeof b.shipmentAddress === "string" ? b.shipmentAddress : "",
      organizationId: idOf(b.organization),
      agentId: idOf(b.agent),
      storeId: b.store ? idOf(b.store) : undefined,
      salesChannelId: b.salesChannel ? idOf(b.salesChannel) : undefined,
      stateId: b.state ? idOf(b.state) : STATES[0].id,
      positions,
      created: now,
      updated: now,
    };
    mock.orders.push(o);
    mock.fire("customerorder", "CREATE", mock.href(`entity/customerorder/${o.id}`), "customerorder", String(req.headers["x-lognex-webhook-disablebyprefix"] ?? "") || undefined);
    return mock.renderOrder(o, []);
  });
  app.put(`${API}/entity/customerorder/:id`, async (req, reply) => {
    const o = mock.orders.find((x) => x.id === (req.params as { id: string }).id);
    if (!o) return err(reply, 404, "Не найдено", 1021);
    const b = req.body as { state?: unknown } | undefined;
    if (b?.state) {
      const stateId = idOf(b.state);
      if (!STATES.some((s) => s.id === stateId)) return err(reply, 400, "Статус не найден", 3000);
      o.stateId = stateId;
      o.updated = new Date(mock.now());
      mock.fire("customerorder", "UPDATE", mock.href(`entity/customerorder/${o.id}`), "customerorder", String(req.headers["x-lognex-webhook-disablebyprefix"] ?? "") || undefined);
    }
    return mock.renderOrder(o, []);
  });

  // ---------------------------------------------------------------------------------------- webhooks
  app.get(`${API}/entity/webhook`, async () => ({ meta: { size: mock.webhooks.length }, rows: mock.webhooks }));
  app.post(`${API}/entity/webhook`, async (req, reply) => {
    const b = req.body as Partial<Webhook> | undefined;
    if (!b?.url || !b.entityType || !b.action) return err(reply, 400, "url, entityType и action обязательны", 3000);
    if (b.url.length > 255) return err(reply, 400, "URL длиннее 255 символов", 3000);
    const w: Webhook = { id: randomUUID(), url: b.url, action: b.action, entityType: b.entityType, enabled: true };
    mock.webhooks.push(w);
    return w;
  });
  app.put(`${API}/entity/webhook/:id`, async (req, reply) => {
    const w = mock.webhooks.find((x) => x.id === (req.params as { id: string }).id);
    if (!w) return err(reply, 404, "Не найдено", 1021);
    Object.assign(w, (req.body as object) ?? {});
    return w;
  });
  app.get(`${API}/entity/webhookstock`, async () => ({ meta: { size: mock.stockWebhooks.length }, rows: mock.stockWebhooks }));
  app.post(`${API}/entity/webhookstock`, async (req, reply) => {
    const b = req.body as Partial<StockWebhook> | undefined;
    if (!b?.url) return err(reply, 400, "url обязателен", 3000);
    const w: StockWebhook = { id: randomUUID(), url: b.url, stockType: b.stockType ?? "stock", reportType: b.reportType ?? "all", enabled: true };
    mock.stockWebhooks.push(w);
    return w;
  });

  // ---------------------------------------------------------------------------------------- mock control plane (demo + tests)
  app.get("/__mock/state", async () => ({
    config: mock.config,
    products: mock.dataset.products.length,
    archived: mock.dataset.products.filter((p) => p.archived).length,
    orders: mock.orders.map((o) => ({ id: o.id, name: o.name, externalCode: o.externalCode, syncId: o.syncId, state: STATES.find((s) => s.id === o.stateId)?.name, positions: o.positions.length, description: o.description, shipmentAddress: o.shipmentAddress })),
    counterparties: mock.counterparties.length,
    webhooks: mock.webhooks,
    stockWebhooks: mock.stockWebhooks,
    faults: mock.faults,
    stats: mock.stats,
    states: STATES.map((s) => s.name),
  }));
  app.patch("/__mock/config", async (req) => {
    const b = (req.body ?? {}) as Partial<MockConfig>;
    mock.config = { ...mock.config, ...b, rateLimit: { ...mock.config.rateLimit, ...(b.rateLimit ?? {}) } };
    return mock.config;
  });
  app.post("/__mock/faults", async (req) => {
    mock.faults.push(...(([] as Fault[]).concat((req.body ?? []) as Fault | Fault[])));
    return { faults: mock.faults };
  });
  app.post("/__mock/reset", async () => {
    mock.reset();
    return { ok: true };
  });
  app.post("/__mock/product/:id", async (req, reply) => {
    const p = mock.touchProduct((req.params as { id: string }).id, (req.body ?? {}) as never);
    return p ? { ok: true, id: p.id } : reply.code(404).send({ error: "not found" });
  });
  app.post("/__mock/order/:id/state", async (req, reply) => {
    const o = mock.setOrderState((req.params as { id: string }).id, String((req.body as { state?: string } | undefined)?.state ?? ""));
    return o ? { ok: true } : reply.code(404).send({ error: "not found" });
  });
  app.get("/__mock/products", async (req) => {
    const q = String((req.query as Q).q ?? "").toLowerCase();
    return mock.dataset.products
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((p) => ({ id: p.id, name: p.name, price: p.priceMinor / 100, stock: mock.stockOf(p).free, archived: p.archived }));
  });
  app.get("/__mock", async (_req, reply) => reply.type("text/html").send(CONTROL_PAGE));

  return { app, mock };
}

const CONTROL_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock MoySklad</title>
<style>body{font:15px system-ui;max-width:860px;margin:24px auto;padding:0 16px;color:#1b1b1f}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e8e3da;padding:6px 8px;text-align:left}input,select,button{font:inherit;padding:6px 8px}button{cursor:pointer}.note{background:#fff7e0;border:1px solid #ecd9a0;padding:10px 12px;border-radius:8px}</style>
<h1>Mock MoySklad (demo)</h1>
<p class="note">Bu haqiqiy MoySklad emas: sinov uchun sintetik ma'lumot. Bu yerda narx/qoldiqni o'zgartirsangiz, sayt bir necha daqiqada (yoki webhook bilan darhol) yangilanadi.</p>
<h2>Tovarni o'zgartirish</h2>
<input id="q" placeholder="Tovar nomi"> <button onclick="find()">Qidirish</button>
<table id="products"></table>
<h2>Buyurtmalar</h2><table id="orders"></table>
<script>
const j=(u,o)=>fetch(u,o).then(r=>r.json());
async function find(){const r=await j('/__mock/products?q='+encodeURIComponent(q.value));products.innerHTML='<tr><th>Nomi</th><th>Narx</th><th>Qoldiq</th><th></th></tr>'+r.map(p=>'<tr><td>'+p.name+(p.archived?' (arxiv)':'')+'</td><td><input size=8 value="'+p.price+'" onchange="patch(\\''+p.id+'\\',{priceUzs:+this.value})"></td><td><input size=6 value="'+p.stock+'" onchange="patch(\\''+p.id+'\\',{stock:+this.value})"></td><td><button onclick="patch(\\''+p.id+'\\',{archived:'+!p.archived+'})">'+(p.archived?'Arxivdan':'Arxivga')+'</button></td></tr>').join('')}
function patch(id,b){fetch('/__mock/product/'+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})}
async function load(){const s=await j('/__mock/state');orders.innerHTML='<tr><th>№</th><th>Izoh</th><th>Holat</th></tr>'+s.orders.map(o=>'<tr><td>'+o.name+'</td><td>'+o.description.slice(0,60)+'</td><td><select onchange="setState(\\''+o.id+'\\',this.value)">'+s.states.map(x=>'<option'+(x===o.state?' selected':'')+'>'+x+'</option>').join('')+'</select></td></tr>').join('')||'<tr><td>Hozircha buyurtma yo\\'q</td></tr>'}
function setState(id,state){fetch('/__mock/order/'+id+'/state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state})})}
find();load();setInterval(load,4000);
</script>`;
