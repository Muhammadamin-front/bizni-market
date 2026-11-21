import { z } from "zod";
import { CircuitBreaker } from "./breaker";
import { CircuitOpenError, MoySkladAmbiguousError, MoySkladAuthError, MoySkladError } from "./errors";
import { InMemoryLimiter, type Lane, type RateLimiter } from "./limiter";
import { mapFolder, mapImages, mapProduct, mapStockRows, toMinor } from "./mappers";
import {
  AttributeMeta,
  RawCounterparty,
  RawCustomerOrder,
  RawFolder,
  RawImage,
  RawNamed,
  RawPriceType,
  RawProduct,
  RawState,
  RawWebhook,
  RawWebhookStock,
  StockReport,
  listOf,
  type RawCounterparty as Counterparty,
  type RawCustomerOrder as CustomerOrder,
} from "./schemas";
import { formatMsTime } from "./time";
import type { CreateOrderInput, MappingConfig, MsFolder, MsImageRef, MsProduct, MsStockRow } from "./types";

export interface ClientOptions {
  baseUrl: string;
  token: string;
  limiter?: RateLimiter;
  breaker?: CircuitBreaker;
  /** Units each request costs. 4 = user token from 2026-12-01 (strictest); 1 = public/approved solution token. */
  requestWeight?: number;
  /** Weight of GET report/stock/*. */
  stockReportWeight?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Test hook: replaces setTimeout-based waiting. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  /** Hosts besides the API host that image links may point at. */
  allowedImageHosts?: string[];
  onRateHeaders?: (h: RateHeaders) => void;
}

export interface RateHeaders {
  limit?: number;
  remaining?: number;
  retryAfterMs?: number;
  resetMs?: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  lane?: Lane;
  headers?: Record<string, string>;
  weight?: number;
  /** Return the raw bytes instead of parsing JSON. */
  binary?: boolean;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * Math.min(ms * 0.25, 500));

export class MoySkladClient {
  private readonly limiter: RateLimiter;
  private readonly breaker: CircuitBreaker;
  private readonly weight: number;
  private readonly stockWeight: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly base: URL;
  lastRateHeaders: RateHeaders = {};

  constructor(private readonly opts: ClientOptions) {
    this.limiter = opts.limiter ?? new InMemoryLimiter();
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.weight = opts.requestWeight ?? 4;
    this.stockWeight = opts.stockReportWeight ?? Math.max(this.weight, 5);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.sleep = opts.sleep ?? defaultSleep;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.base = new URL(opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`);
  }

  get circuit(): CircuitBreaker {
    return this.breaker;
  }

  // ------------------------------------------------------------------------------------------------ transport

  private url(path: string, query?: RequestOptions["query"]): URL {
    const u = new URL(path.replace(/^\//, ""), this.base);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u;
  }

  /** Low-level request. Applies the budget, the breaker, the retry policy and (for non-idempotent calls) the ambiguity rule. */
  async request<T = unknown>(path: string, options: RequestOptions = {}, parse?: (json: unknown) => T): Promise<T> {
    const method = options.method ?? "GET";
    const lane = options.lane ?? "background";
    const weight = options.weight ?? this.weight;
    const idempotent = method === "GET" || method === "DELETE";
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const openUntil = await this.breaker.openUntil();
      if (openUntil) throw new CircuitOpenError(openUntil);

      const release = await this.limiter.acquire(weight, lane, options.signal);
      let res: Response;
      try {
        res = await this.fetchImpl(this.url(path, options.query), {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.token}`,
            // Mandatory: without gzip the API answers 415 with an empty body.
            "Accept-Encoding": "gzip",
            Accept: "application/json;charset=utf-8",
            ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        release();
        await this.breaker.recordFailure();
        lastError = err;
        if (!idempotent) throw new MoySkladAmbiguousError(`${method} ${path} did not complete`, err);
        if (attempt < this.maxAttempts) await this.sleep(jitter(1000 * 2 ** (attempt - 1)));
        continue;
      }
      release();

      const headers = readRateHeaders(res.headers);
      this.lastRateHeaders = headers;
      this.opts.onRateHeaders?.(headers);

      if (res.ok) {
        if (options.binary) return Buffer.from(await res.arrayBuffer()) as unknown as T;
        const text = await res.text();
        const json: unknown = text ? JSON.parse(text) : null;
        return parse ? parse(json) : (json as T);
      }

      await this.breaker.recordFailure();

      if (res.status === 429) {
        // The request was refused before processing, so retrying is safe for every method.
        const wait = headers.retryAfterMs ?? headers.resetMs ?? 3000;
        lastError = new MoySkladError("MoySklad rate limit (429)", 429);
        if (attempt < this.maxAttempts) {
          await this.sleep(jitter(wait));
          continue;
        }
        throw lastError;
      }

      if (res.status === 401) {
        await this.breaker.trip();
        throw new MoySkladAuthError(401);
      }

      if (res.status >= 500) {
        lastError = new MoySkladError(`MoySklad ${res.status}`, res.status);
        if (!idempotent) throw new MoySkladAmbiguousError(`${method} ${path} answered ${res.status}`, lastError);
        if (attempt < this.maxAttempts) {
          await this.sleep(jitter(1000 * 2 ** (attempt - 1)));
          continue;
        }
        throw lastError;
      }

      // Other 4xx: our request is wrong; retrying cannot help and only feeds the shutdown counter.
      throw await toError(res);
    }
    throw lastError instanceof Error ? lastError : new MoySkladError("MoySklad request failed", 0);
  }

  private get<T>(path: string, query: RequestOptions["query"], schema: z.ZodType<T>, extra: Partial<RequestOptions> = {}): Promise<T> {
    return this.request(path, { ...extra, query }, (json) => schema.parse(json));
  }

  /** Walks every page of a list endpoint. `expand` only works up to 100 rows per page, so callers asking for it pass pageSize <= 100. */
  async *paginate<T>(path: string, query: Record<string, string | number | boolean | undefined>, row: z.ZodType<T>, pageSize = 1000, lane: Lane = "background"): AsyncGenerator<T[]> {
    let offset = 0;
    for (;;) {
      const page = await this.get(path, { ...query, limit: pageSize, offset }, listOf(row), { lane });
      if (page.rows.length > 0) yield page.rows;
      offset += page.rows.length;
      const size = page.meta?.size ?? offset;
      if (page.rows.length === 0 || offset >= size) return;
    }
  }

  // ------------------------------------------------------------------------------------------------ catalogue

  async *folders(offsetHours: number): AsyncGenerator<MsFolder[]> {
    for await (const rows of this.paginate("entity/productfolder", { filter: "archived=false;archived=true" }, RawFolder, 1000)) {
      yield rows.map((r) => mapFolder(r, offsetHours));
    }
  }

  /**
   * Products changed since `since` (ascending). Archived products are requested explicitly so the sync can hide them.
   * expand=images,productFolder only works with limit<=100, so that is the page size here.
   */
  async *products(cfg: MappingConfig, opts: { since?: Date; filterOffsetHours?: number } = {}): AsyncGenerator<MsProduct[]> {
    const filters = ["archived=false;archived=true"];
    if (opts.since) filters.push(`updated>=${formatMsTime(opts.since, opts.filterOffsetHours ?? cfg.timezoneOffsetHours)}`);
    for await (const rows of this.paginate(
      "entity/product",
      { filter: filters.join(";"), order: "updated,asc", expand: "productFolder,images,uom" },
      RawProduct,
      100,
    )) {
      yield rows.map((r) => mapProduct(r, cfg));
    }
  }

  async productsByIds(ids: string[], cfg: MappingConfig, lane: Lane = "background"): Promise<MsProduct[]> {
    const out: MsProduct[] = [];
    // Long filter URLs break at ~8 KB: keep to 50 ids per request.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const page = await this.get(
        "entity/product",
        { filter: `${chunk.map((id) => `id=${id}`).join(";")};archived=false;archived=true`, limit: 100, expand: "productFolder,images,uom" },
        listOf(RawProduct),
        { lane },
      );
      out.push(...page.rows.map((r) => mapProduct(r, cfg)));
    }
    return out;
  }

  /** All product ids (no expand, 1000 per page): the daily reconcile diffs these against our database. */
  async allProductIds(): Promise<string[]> {
    const ids: string[] = [];
    for await (const rows of this.paginate("entity/product", { filter: "archived=false;archived=true" }, z.object({ id: z.string() }).loose(), 1000)) {
      ids.push(...rows.map((r) => r.id));
    }
    return ids;
  }

  async productImages(productMsId: string, offsetHours: number): Promise<MsImageRef[]> {
    const page = await this.get(`entity/product/${productMsId}/images`, { limit: 100 }, listOf(RawImage));
    return mapImages(page.rows, offsetHours);
  }

  /** Downloads image bytes. Only MoySklad hosts (or the configured API host) are fetched: the link comes from remote data. */
  async downloadImage(href: string): Promise<Buffer> {
    const u = new URL(href);
    const allowed = new Set([this.base.host, "api.moysklad.ru", "miniature-prod.moysklad.ru", "online.moysklad.ru", ...(this.opts.allowedImageHosts ?? [])]);
    if (!allowed.has(u.host)) throw new MoySkladError(`Refusing to download from unexpected host ${u.host}`, 0);
    const path = u.host === this.base.host ? u.pathname + u.search : href;
    if (u.host === this.base.host) {
      return this.request<Buffer>(path.replace(this.base.pathname, ""), { binary: true, headers: { Accept: "*/*" } });
    }
    const release = await this.limiter.acquire(this.weight, "background");
    try {
      const res = await this.fetchImpl(href, { headers: { "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new MoySkladError(`Image download failed (${res.status})`, res.status);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      release();
    }
  }

  // ------------------------------------------------------------------------------------------------ stock

  /**
   * Current stock per product from the brief report. One stock type per request. A product missing from the answer has
   * zero stock. With `changedSince` (max 24 h back, never in the future) the answer is the CURRENT value for items that changed.
   */
  async stock(opts: { stockType?: string; changedSince?: Date; storeId?: string; includeZeroLines?: boolean; filterOffsetHours?: number }): Promise<MsStockRow[]> {
    const stockType = opts.stockType ?? "freeStock";
    const json = await this.get(
      "report/stock/all/current",
      {
        stockType,
        storeId: opts.storeId,
        include: opts.includeZeroLines ? "zeroLines" : undefined,
        changedSince: opts.changedSince ? formatMsTime(opts.changedSince, opts.filterOffsetHours ?? 3) : undefined,
      },
      StockReport,
      { weight: this.stockWeight },
    );
    return mapStockRows(Array.isArray(json) ? json : json.rows, stockType);
  }

  // ------------------------------------------------------------------------------------------------ account metadata (admin pickers, probe)

  async priceTypes() {
    const json = await this.request("context/companysettings/pricetype");
    return z.array(RawPriceType).parse(Array.isArray(json) ? json : (json as { rows?: unknown }).rows ?? []);
  }
  async productAttributes() {
    return (await this.get("entity/product/metadata/attributes", {}, listOf(AttributeMeta))).rows;
  }
  async organizations() {
    return (await this.get("entity/organization", { limit: 100 }, listOf(RawNamed))).rows;
  }
  async stores() {
    return (await this.get("entity/store", { limit: 100 }, listOf(RawNamed))).rows;
  }
  async salesChannels() {
    return (await this.get("entity/saleschannel", { limit: 100 }, listOf(RawNamed))).rows;
  }
  async orderStates() {
    const meta = await this.get("entity/customerorder/metadata", {}, z.object({ states: z.array(RawState).default([]) }).loose());
    return meta.states;
  }

  // ------------------------------------------------------------------------------------------------ orders (interactive lane)

  async findCounterpartyByPhone(phone: string): Promise<Counterparty[]> {
    return (await this.get("entity/counterparty", { filter: `phone=${phone}`, limit: 10 }, listOf(RawCounterparty), { lane: "interactive" })).rows;
  }

  async findCounterpartyBySyncId(syncId: string): Promise<Counterparty | null> {
    const rows = (await this.get("entity/counterparty", { filter: `syncId=${syncId}`, limit: 1 }, listOf(RawCounterparty), { lane: "interactive" })).rows;
    return rows[0] ?? null;
  }

  async createCounterparty(input: { name: string; phone: string; address: string; syncId: string; tags?: string[]; description?: string }): Promise<Counterparty> {
    return this.request(
      "entity/counterparty",
      {
        method: "POST",
        lane: "interactive",
        body: { name: input.name, phone: input.phone, actualAddress: input.address, syncId: input.syncId, tags: input.tags ?? [], description: input.description ?? "" },
      },
      (j) => RawCounterparty.parse(j),
    );
  }

  /** Looks an order up by the syncId we generated BEFORE the first call: this is what makes a retry after a lost response safe. */
  async findOrderBySyncId(syncId: string): Promise<CustomerOrder | null> {
    const rows = (await this.get("entity/customerorder", { filter: `syncId=${syncId}`, limit: 1, expand: "state" }, listOf(RawCustomerOrder), { lane: "interactive" })).rows;
    return rows[0] ?? null;
  }

  async createOrder(input: CreateOrderInput): Promise<CustomerOrder> {
    const href = (type: string, id: string) => ({ meta: { href: new URL(`entity/${type}/${id}`, this.base).toString(), type, mediaType: "application/json" } });
    const body = {
      name: input.name,
      externalCode: input.externalCode,
      syncId: input.syncId,
      description: input.description,
      shipmentAddress: input.shipmentAddress,
      organization: href("organization", input.organizationId),
      agent: href("counterparty", input.counterpartyId),
      ...(input.storeId ? { store: href("store", input.storeId) } : {}),
      ...(input.salesChannelId ? { salesChannel: href("saleschannel", input.salesChannelId) } : {}),
      ...(input.stateId ? { state: { meta: { href: new URL(`entity/customerorder/metadata/states/${input.stateId}`, this.base).toString(), type: "state", mediaType: "application/json" } } } : {}),
      positions: input.positions.map((p) => ({
        assortment: href("product", p.productMsId),
        quantity: p.quantity,
        price: toMinor(p.unitPrice),
        ...(p.reserve ? { reserve: p.reserve } : {}),
      })),
    };
    return this.request(
      "entity/customerorder",
      {
        method: "POST",
        lane: "interactive",
        body,
        headers: input.disableWebhooksByPrefix ? { "X-Lognex-WebHook-DisableByPrefix": input.disableWebhooksByPrefix } : undefined,
      },
      (j) => RawCustomerOrder.parse(j),
    );
  }

  async getOrder(msOrderId: string, lane: Lane = "background"): Promise<CustomerOrder> {
    return this.get(`entity/customerorder/${msOrderId}`, { expand: "state" }, RawCustomerOrder, { lane });
  }

  /** Orders changed since a moment: the polling fallback for status changes made by staff. */
  async *ordersChangedSince(since: Date, offsetHours: number): AsyncGenerator<CustomerOrder[]> {
    yield* this.paginate("entity/customerorder", { filter: `updated>=${formatMsTime(since, offsetHours)}`, order: "updated,asc", expand: "state" }, RawCustomerOrder, 100);
  }

  async setOrderState(msOrderId: string, stateId: string, disableWebhooksByPrefix?: string): Promise<CustomerOrder> {
    return this.request(
      `entity/customerorder/${msOrderId}`,
      {
        method: "PUT",
        lane: "interactive",
        body: { state: { meta: { href: new URL(`entity/customerorder/metadata/states/${stateId}`, this.base).toString(), type: "state", mediaType: "application/json" } } },
        headers: disableWebhooksByPrefix ? { "X-Lognex-WebHook-DisableByPrefix": disableWebhooksByPrefix } : undefined,
      },
      (j) => RawCustomerOrder.parse(j),
    );
  }

  // ------------------------------------------------------------------------------------------------ webhooks

  async webhooks() {
    return (await this.get("entity/webhook", { limit: 100 }, listOf(RawWebhook))).rows;
  }
  createWebhook(input: { url: string; action: "CREATE" | "UPDATE" | "DELETE"; entityType: string }) {
    return this.request("entity/webhook", { method: "POST", body: input }, (j) => RawWebhook.parse(j));
  }
  enableWebhook(id: string) {
    return this.request(`entity/webhook/${id}`, { method: "PUT", body: { enabled: true } }, (j) => RawWebhook.parse(j));
  }
  async stockWebhooks() {
    return (await this.get("entity/webhookstock", { limit: 100 }, listOf(RawWebhookStock))).rows;
  }
  createStockWebhook(input: { url: string; stockType: string; reportType: string }) {
    return this.request("entity/webhookstock", { method: "POST", body: input }, (j) => RawWebhookStock.parse(j));
  }
}

function readRateHeaders(h: Headers): RateHeaders {
  const num = (name: string) => {
    const v = h.get(name);
    return v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);
  };
  return {
    limit: num("X-RateLimit-Limit"),
    remaining: num("X-RateLimit-Remaining"),
    retryAfterMs: num("X-Lognex-Retry-After"),
    resetMs: num("X-Lognex-Reset"),
  };
}

async function toError(res: Response): Promise<MoySkladError> {
  let details: { code?: number; moreInfo?: string }[] = [];
  let message = `MoySklad ${res.status}`;
  try {
    const body = (await res.json()) as { errors?: { error?: string; code?: number; moreInfo?: string }[] };
    details = (body.errors ?? []).map((e) => ({ code: e.code, moreInfo: e.moreInfo }));
    if (body.errors?.[0]?.error) message = `MoySklad ${res.status}: ${body.errors[0].error}`;
  } catch {
    // empty or non-JSON body (e.g. 415)
  }
  return new MoySkladError(message, res.status, details);
}
