import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  CircuitBreaker,
  CircuitOpenError,
  InMemoryBreakerStore,
  InMemoryLimiter,
  MoySkladAmbiguousError,
  MoySkladAuthError,
  MoySkladClient,
  MoySkladError,
  type MappingConfig,
} from "@shop/moysklad";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IDS, STATES } from "../src/data";
import { buildMockServer, type MockMoySklad } from "../src/server";

/** SYNTHETIC fixtures: these tests prove the client against the documented behaviour encoded in the mock, not against a real MoySklad account. */

let app: FastifyInstance;
let mock: MockMoySklad;
let base: string;

const cfg: MappingConfig = { priceTypeId: IDS.priceRetail, oldPriceTypeId: IDS.priceOld, brandAttributeId: IDS.brandAttr, timezoneOffsetHours: 3 };
const instantSleep = (log?: number[]) => async (ms: number) => {
  log?.push(ms);
};

function makeClient(over: Partial<ConstructorParameters<typeof MoySkladClient>[0]> = {}) {
  return new MoySkladClient({
    baseUrl: `${base}/api/remap/1.2`,
    token: "demo-token",
    sleep: instantSleep(),
    ...over,
  });
}

beforeAll(async () => {
  ({ app, mock } = await buildMockServer());
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  mock.config.publicUrl = base;
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  mock.reset();
  mock.config.filterTimezoneOffsetHours = 3;
  mock.config.archivedInLists = false;
  mock.config.rateLimit = { enabled: true, capacityUnits: 45, windowMs: 3000, weight: 4, stockWeight: 5, maxConcurrent: 5 };
});

async function collect<T>(gen: AsyncGenerator<T[]>): Promise<T[]> {
  const out: T[] = [];
  for await (const rows of gen) out.push(...rows);
  return out;
}

describe("transport rules the docs require", () => {
  it("answers 415 without Accept-Encoding: gzip, and the client always sends it", async () => {
    const bare = await fetch(`${base}/api/remap/1.2/entity/productfolder`, { headers: { Authorization: "Bearer demo-token", "Accept-Encoding": "identity" } });
    expect(bare.status).toBe(415);
    const folders = await collect(makeClient().folders(3));
    expect(folders.length).toBeGreaterThan(5);
  });

  it("maps a 401 to an auth error and trips the breaker at once", async () => {
    const client = makeClient({ token: "wrong" });
    await expect(collect(client.folders(3))).rejects.toBeInstanceOf(MoySkladAuthError);
    await expect(collect(client.folders(3))).rejects.toBeInstanceOf(CircuitOpenError);
  });
});

describe("catalogue reads", () => {
  it("pages through every product incl. archived, with folders, images and uom expanded", async () => {
    const products = await collect(makeClient().products(cfg));
    expect(products.length).toBe(mock.dataset.products.length);
    const first = products[0]!;
    expect(first.imagesExpanded).toBe(true);
    expect(first.folderMsId).toBeTruthy();
    expect(first.uom).toBeTruthy();
    expect(first.brandName).toBeTruthy();
    expect(first.updated).toBeInstanceOf(Date);
    expect(products.some((p) => p.archived)).toBe(true);
  });

  it("divides money by 100 and only reports an old price that is really higher", async () => {
    const products = await collect(makeClient().products(cfg));
    const raw = mock.dataset.products.find((p) => p.id === products[0]!.msId)!;
    expect(products[0]!.price).toBe(raw.priceMinor / 100);
    const withOld = products.find((p) => p.oldPrice !== null)!;
    expect(withOld.oldPrice!).toBeGreaterThan(withOld.price!);
    // price type chosen explicitly: the wholesale price is lower and must not leak in as the retail price
    const wholesale = await collect(makeClient().products({ ...cfg, priceTypeId: IDS.priceWholesale, oldPriceTypeId: "" }));
    expect(wholesale[0]!.price).toBeLessThan(products[0]!.price!);
  });

  it("ignores expand above limit=100 (documented), which is why the client pages at 100", async () => {
    const raw = await fetch(`${base}/api/remap/1.2/entity/product?limit=200&expand=images`, { headers: { Authorization: "Bearer demo-token", "Accept-Encoding": "gzip" } });
    const body = (await raw.json()) as { rows: { images: { rows?: unknown } }[] };
    expect(body.rows[0]!.images.rows).toBeUndefined();
  });

  it("hides archived products unless asked, and the client always asks", async () => {
    const plain = await fetch(`${base}/api/remap/1.2/entity/product?limit=1000`, { headers: { Authorization: "Bearer demo-token", "Accept-Encoding": "gzip" } });
    const total = ((await plain.json()) as { meta: { size: number } }).meta.size;
    expect(total).toBeLessThan(mock.dataset.products.length);
    mock.config.archivedInLists = true;
    const all = await fetch(`${base}/api/remap/1.2/entity/product?limit=1000`, { headers: { Authorization: "Bearer demo-token", "Accept-Encoding": "gzip" } });
    expect(((await all.json()) as { meta: { size: number } }).meta.size).toBe(mock.dataset.products.length);
  });

  it("returns only products changed since the watermark; stock changes do not touch `updated`", async () => {
    const target = mock.dataset.products[3]!;
    const since = new Date(Date.now() - 60_000);
    mock.touchProduct(target.id, { priceUzs: 77_700 });
    const changed = await collect(makeClient().products(cfg, { since }));
    expect(changed.map((p) => p.msId)).toEqual([target.id]);
    expect(changed[0]!.price).toBe(77_700);

    const other = mock.dataset.products[9]!;
    mock.touchProduct(other.id, { stock: 4 });
    expect((await collect(makeClient().products(cfg, { since }))).map((p) => p.msId)).toEqual([target.id]);
  });

  it("shows why the input timezone must be a setting: a UTC server misreads an MSK watermark", async () => {
    const target = mock.dataset.products[5]!;
    mock.touchProduct(target.id, { priceUzs: 12_300 });
    const since = new Date(Date.now() - 60_000);
    mock.config.filterTimezoneOffsetHours = 0; // the server reads our input as UTC
    const skewed = await collect(makeClient().products(cfg, { since, filterOffsetHours: 3 }));
    expect(skewed).toHaveLength(0); // 3 h in the future: silently misses the change
    const fixed = await collect(makeClient().products(cfg, { since, filterOffsetHours: 0 }));
    expect(fixed.map((p) => p.msId)).toContain(target.id);
  });

  it("fetches products by id in chunks and lists all ids for the reconcile", async () => {
    const ids = mock.dataset.products.slice(0, 7).map((p) => p.id);
    const got = await makeClient().productsByIds(ids, cfg);
    expect(got.map((p) => p.msId).sort()).toEqual([...ids].sort());
    expect((await makeClient().allProductIds()).length).toBe(mock.dataset.products.filter((p) => !p.archived).length + mock.dataset.products.filter((p) => p.archived).length);
  });

  it("downloads an image from the API host and refuses any other host", async () => {
    const client = makeClient();
    const [p] = await collect(client.products(cfg)).then((r) => r.filter((x) => x.images.length > 0));
    const bytes = await client.downloadImage(p!.images[0]!.downloadHref);
    expect(bytes.toString("utf8")).toContain("<svg");
    await expect(client.downloadImage("https://evil.example.com/x.png")).rejects.toThrow(/unexpected host/);
  });
});

describe("stock report", () => {
  it("omits zero rows by default (missing = 0) and includes them on request", async () => {
    const client = makeClient();
    const rows = await client.stock({ stockType: "freeStock" });
    const zero = mock.dataset.products.find((p) => !p.archived && mock.stockOf(p).free === 0)!;
    expect(rows.find((r) => r.msId === zero.id)).toBeUndefined();
    const withZeros = await client.stock({ stockType: "freeStock", includeZeroLines: true });
    expect(withZeros.find((r) => r.msId === zero.id)?.quantity).toBe(0);
  });

  it("freeStock subtracts reserve, so a reserved order lowers what the storefront may sell", async () => {
    const p = mock.dataset.products.find((x) => !x.archived && mock.stockOf(x).free > 10)!;
    const before = (await makeClient().stock({ stockType: "freeStock" })).find((r) => r.msId === p.id)!.quantity;
    const client = makeClient();
    const cp = await client.createCounterparty({ name: "T", phone: "+998901112233", address: "", syncId: "11111111-1111-4111-8111-111111111111" });
    await client.createOrder({ organizationId: IDS.organization, counterpartyId: cp.id, name: "R1", externalCode: "1", syncId: "22222222-2222-4222-8222-222222222222", description: "", shipmentAddress: "", positions: [{ productMsId: p.id, unitPrice: 1000, quantity: 3, reserve: 3 }] });
    const after = (await client.stock({ stockType: "freeStock" })).find((r) => r.msId === p.id)!.quantity;
    expect(after).toBe(before - 3);
  });

  it("changedSince returns current values for changed items only, and rejects the future and >24 h", async () => {
    const client = makeClient();
    const p = mock.dataset.products[2]!;
    mock.touchProduct(p.id, { stock: 55 });
    const rows = await client.stock({ stockType: "stock", changedSince: new Date(Date.now() - 5 * 60_000) });
    expect(rows.map((r) => r.msId)).toEqual([p.id]);
    expect(rows[0]!.quantity).toBe(55);
    await expect(client.stock({ changedSince: new Date(Date.now() + 3_600_000) })).rejects.toBeInstanceOf(MoySkladError);
    await expect(client.stock({ changedSince: new Date(Date.now() - 25 * 3_600_000) })).rejects.toBeInstanceOf(MoySkladError);
  });
});

describe("rate limits, retries and the circuit breaker", () => {
  it("never earns a 429 when the shared limiter is used (strictest tier: 11 requests / 3 s)", async () => {
    const client = makeClient({ limiter: new InMemoryLimiter() });
    const started = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => client.priceTypes()));
    expect(mock.stats.rateLimited).toBe(0);
    // 20 requests * 4 units = 80 units against 45 units / 3 s: the limiter must have spread them out.
    expect(Date.now() - started).toBeGreaterThan(2000);
  }, 20_000);

  it("control: without the limiter the mock really does answer 429 (so the test above proves something)", async () => {
    mock.config.rateLimit.maxConcurrent = 50;
    const client = makeClient({
      limiter: new InMemoryLimiter({ capacityUnits: 10_000, backgroundReserveUnits: 0, maxConcurrent: 50 }),
      breaker: new CircuitBreaker(new InMemoryBreakerStore(), { failureThreshold: 10_000 }),
      maxAttempts: 30,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 250))),
    });
    await Promise.all(Array.from({ length: 20 }, () => client.priceTypes()));
    expect(mock.stats.rateLimited).toBeGreaterThan(0);
  }, 30_000);

  it("keeps background work from starving interactive requests", async () => {
    const limiter = new InMemoryLimiter();
    const client = makeClient({ limiter });
    const background = Array.from({ length: 12 }, () => client.request("context/companysettings/pricetype", { lane: "background" }));
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await client.request("context/companysettings/pricetype", { lane: "interactive" });
    expect(Date.now() - t0).toBeLessThan(1500);
    await Promise.all(background);
    expect(mock.stats.rateLimited).toBe(0);
  }, 20_000);

  it("waits the advertised Retry-After on 429 and then succeeds", async () => {
    const waits: number[] = [];
    mock.faults.push({ match: "pricetype", status: 429, remaining: 2 });
    const types = await makeClient({ sleep: instantSleep(waits) }).priceTypes();
    expect(types.length).toBe(3);
    expect(waits).toHaveLength(2);
    expect(waits.every((w) => w >= 1000)).toBe(true);
  });

  it("retries a GET after a 5xx", async () => {
    mock.faults.push({ match: "pricetype", status: 503, remaining: 2 });
    expect((await makeClient().priceTypes()).length).toBe(3);
  });

  it("never retries a POST after a 5xx: it reports ambiguity instead", async () => {
    mock.faults.push({ match: "customerorder", method: "POST", status: 502, remaining: 1 });
    const client = makeClient();
    await expect(client.createOrder({ organizationId: IDS.organization, counterpartyId: "x", name: "A", externalCode: "1", syncId: "33333333-3333-4333-8333-333333333333", description: "", shipmentAddress: "", positions: [] })).rejects.toBeInstanceOf(MoySkladAmbiguousError);
    expect(mock.orders).toHaveLength(0);
  });

  it("recovers from a lost response without creating a duplicate order (syncId lookup)", async () => {
    const client = makeClient();
    const cp = await client.createCounterparty({ name: "T", phone: "+998901112233", address: "", syncId: "44444444-4444-4444-8444-444444444444" });
    const syncId = "55555555-5555-4555-8555-555555555555";
    const p = mock.dataset.products[0]!;
    const input = { organizationId: IDS.organization, counterpartyId: cp.id, name: "A1", externalCode: "1", syncId, description: "", shipmentAddress: "", positions: [{ productMsId: p.id, unitPrice: 1000, quantity: 1 }] };
    mock.faults.push({ match: "customerorder", method: "POST", dropAfter: true, remaining: 1 });
    await expect(client.createOrder(input)).rejects.toBeInstanceOf(MoySkladAmbiguousError);
    expect(mock.orders).toHaveLength(1); // it WAS created
    const found = await client.findOrderBySyncId(syncId);
    expect(found?.id).toBe(mock.orders[0]!.id);
    // and a naive second create is refused because syncId is write-once
    await expect(client.createOrder(input)).rejects.toMatchObject({ status: 412 });
    expect(mock.orders).toHaveLength(1);
  });

  it("opens the breaker after repeated failures and then sends nothing at all", async () => {
    mock.faults.push({ status: 500, remaining: 1000 });
    const breaker = new CircuitBreaker(new InMemoryBreakerStore(), { failureThreshold: 5, windowMs: 60_000, openMs: 300_000 });
    const client = makeClient({ breaker, maxAttempts: 1 });
    for (let i = 0; i < 5; i++) await expect(client.priceTypes()).rejects.toBeInstanceOf(MoySkladError);
    const before = mock.stats.requests;
    await expect(client.priceTypes()).rejects.toBeInstanceOf(CircuitOpenError);
    expect(mock.stats.requests).toBe(before);
  });
});

describe("orders and counterparties", () => {
  it("finds counterparties by exact normalised phone", async () => {
    const client = makeClient();
    await client.createCounterparty({ name: "Ali", phone: "+998901234567", address: "", syncId: "66666666-6666-4666-8666-666666666666", tags: ["web-unverified"] });
    expect(await client.findCounterpartyByPhone("+998901234567")).toHaveLength(1);
    expect(await client.findCounterpartyByPhone("998901234567")).toHaveLength(0);
  });

  it("reads and changes order states", async () => {
    const client = makeClient();
    const cp = await client.createCounterparty({ name: "Ali", phone: "+998901234567", address: "", syncId: "77777777-7777-4777-8777-777777777777" });
    const created = await client.createOrder({ organizationId: IDS.organization, counterpartyId: cp.id, name: "W1", externalCode: "1001", syncId: "88888888-8888-4888-8888-888888888888", description: "d", shipmentAddress: "a", positions: [{ productMsId: mock.dataset.products[0]!.id, unitPrice: 5000, quantity: 2 }] });
    expect((await client.getOrder(created.id)).state?.name).toBe(STATES[0].name);
    await client.setOrderState(created.id, STATES[3].id);
    const changed: string[] = [];
    for await (const rows of client.ordersChangedSince(new Date(Date.now() - 60_000), 3)) changed.push(...rows.map((r) => `${r.name}:${r.state?.name}`));
    expect(changed).toEqual([`W1:${STATES[3].name}`]);
  });
});

describe("webhooks", () => {
  let receiver: Server;
  let received: { url: string; body: { events?: { action: string; meta: { href: string } }[] } }[] = [];
  let receiverUrl = "";
  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        received.push({ url: req.url ?? "", body: data ? JSON.parse(data) : {} });
        res.statusCode = 200;
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/webhooks/ms/secret`;
  });
  afterAll(() => new Promise<void>((r) => receiver.close(() => r())));
  beforeEach(() => {
    received = [];
    mock.webhooks = [];
  });

  it("delivers product updates with a requestId, and our own order writes do not echo back", async () => {
    const client = makeClient();
    await client.createWebhook({ url: receiverUrl, action: "UPDATE", entityType: "product" });
    await client.createWebhook({ url: receiverUrl, action: "CREATE", entityType: "customerorder" });
    mock.touchProduct(mock.dataset.products[1]!.id, { priceUzs: 4_200 });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(1);
    expect(received[0]!.url).toMatch(/requestId=[0-9a-f-]{36}/);
    expect(received[0]!.body.events?.[0]?.action).toBe("UPDATE");

    const cp = await client.createCounterparty({ name: "T", phone: "+998901112233", address: "", syncId: "99999999-9999-4999-8999-999999999999" });
    await client.createOrder({ organizationId: IDS.organization, counterpartyId: cp.id, name: "E1", externalCode: "1", syncId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", description: "", shipmentAddress: "", positions: [], disableWebhooksByPrefix: new URL(receiverUrl).origin });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(1); // still only the product event
  });
});
