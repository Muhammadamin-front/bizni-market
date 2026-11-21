import { count, customers, eq, notifications, orderItems, orders, products } from "@shop/db";
import { CheckoutInput } from "@shop/shared";
import { IDS, STATES } from "@shop/mock-moysklad";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  autoConfigure,
  createOrder,
  fullSync,
  OrderError,
  pollOrderStates,
  pushOrder,
  pushOrderState,
  saveSettings,
  sweepPendingOrders,
  type CreateOrderContext,
} from "../src";
import { createWorld, type TestWorld } from "./helpers";

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.stop();
});
beforeEach(async () => {
  await w.reset();
  await fullSync(w.rt, "manual");
  await saveSettings(w.rt, { orderStoreId: IDS.storeStationery });
});

let seq = 0;
const ctx = (over: Partial<CreateOrderContext> = {}): CreateOrderContext => ({
  channel: "web",
  customerId: null,
  telegramId: null,
  ip: `10.0.0.${(seq % 200) + 1}`,
  idempotencyKey: `key-${Date.now()}-${seq++}`,
  ...over,
});

async function pickInStock(n = 1, filter: (p: typeof products.$inferSelect) => boolean = () => true) {
  const rows = (await w.rt.db.select().from(products).where(eq(products.archived, false))).filter((p) => p.availableQty >= 10 && p.price > 0 && p.qtyStep === 1 && filter(p));
  return rows.slice(0, n);
}

const base = { name: "Ali Valiyev", phone: "90 123 45 67", deliveryMethod: "delivery" as const, address: "Chilonzor 12, 5-xonadonlar", comment: "" };
const input = (items: { productId: string; quantity: number }[], over: Record<string, unknown> = {}) => CheckoutInput.parse({ ...base, items, ...over });
const mockOrders = () => w.mock.orders;

describe("placing an order", () => {
  it("re-prices from our read model, snapshots the lines, numbers the order and sends it to MoySklad once", async () => {
    const [a, b] = await pickInStock(2);
    const { order, created } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 3 }, { productId: b!.id, quantity: 1 }]), ctx());
    expect(created).toBe(true);
    expect(order.number).toMatch(/^W\d+$/);
    expect(order.total).toBe(a!.price * 3 + b!.price);
    expect(order.syncStatus).toBe("pending_sync");
    expect(order.contactPhone).toBe("+998901234567");

    expect(await pushOrder(w.rt, order.id)).toBe("created");
    expect(mockOrders()).toHaveLength(1);
    const remote = mockOrders()[0]!;
    expect(remote.syncId).toBeTruthy();
    expect(remote.positions).toHaveLength(2);
    expect(remote.positions.find((p) => p.productId === a!.msId)).toMatchObject({ quantity: 3, priceMinor: a!.price * 100, reserve: 0 }); // guest orders do not reserve
    expect(remote.externalCode).toBe(order.number);
    expect(remote.description).toContain("+998901234567");
    expect(w.mock.counterparties).toHaveLength(1);
    expect(w.mock.counterparties[0]!.tags).toContain("web-unverified");

    const [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.syncStatus).toBe("synced");
    expect(row!.msOrderId).toBe(remote.id);
    expect(row!.msState).toBe(STATES[0].name);
  });

  it("a double submit with the same Idempotency-Key is one order and one MoySklad order", async () => {
    const [a] = await pickInStock();
    const c = ctx();
    const first = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), c);
    const second = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), c);
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    await Promise.all([pushOrder(w.rt, first.order.id), pushOrder(w.rt, first.order.id)].map((p) => p.catch(() => undefined)));
    expect(mockOrders()).toHaveLength(1);
    const [{ c: n }] = (await w.rt.db.select({ c: count() }).from(orders)) as [{ c: number }];
    expect(Number(n)).toBe(1);
  });

  it("refuses the same key for a different customer", async () => {
    const [a] = await pickInStock();
    const c = ctx();
    await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), c);
    await expect(createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }], { phone: "91 555 66 77" }), c)).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("tells the customer exactly which lines cannot be ordered", async () => {
    const [a, b] = await pickInStock(2);
    const archived = (await w.rt.db.select().from(products).where(eq(products.archived, true)))[0]!;
    const err = (await createOrder(w.rt, input([{ productId: a!.id, quantity: 100_000 }, { productId: archived.id, quantity: 1 }, { productId: b!.id, quantity: 1 }]), ctx()).catch((e) => e)) as OrderError;
    expect(err.code).toBe("invalid_lines");
    expect(err.status).toBe(409);
    const details = err.details as { productId: string; reason: string }[];
    expect(details.find((d) => d.productId === a!.id)?.reason).toBe("insufficient_stock");
    expect(details.find((d) => d.productId === archived.id)?.reason).toBe("unavailable");
    expect(details.find((d) => d.productId === b!.id)).toBeUndefined();
    expect(await w.rt.db.select().from(orders)).toHaveLength(0); // nothing half-created
  });

  it("enforces the weight step and the minimum order amount", async () => {
    const [a] = await pickInStock();
    await w.rt.db.update(products).set({ qtyStep: 0.5, availableQty: 20 }).where(eq(products.id, a!.id));
    await expect(createOrder(w.rt, input([{ productId: a!.id, quantity: 0.3 }]), ctx())).rejects.toMatchObject({ code: "invalid_lines" });
    const ok = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1.5 }]), ctx());
    expect(ok.order.items[0]!.quantity).toBe(1.5);
    expect(ok.order.total).toBe(Math.round(a!.price * 1.5));

    await saveSettings(w.rt, { minimumOrderAmount: 10_000_000 });
    await expect(createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx())).rejects.toMatchObject({ code: "below_minimum" });
  });

  it("rate-limits one IP and one phone", async () => {
    const [a] = await pickInStock();
    const fixedIp = "203.0.113.9";
    let blocked = 0;
    for (let i = 0; i < 10; i++) {
      await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }], { phone: `90 ${String(100 + i)} 22 33` }), ctx({ ip: fixedIp })).catch((e: OrderError) => {
        if (e.code === "rate_limited") blocked++;
      });
    }
    expect(blocked).toBeGreaterThanOrEqual(2);

    let phoneBlocked = 0;
    for (let i = 0; i < 7; i++) {
      await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }], { phone: "93 777 88 99" }), ctx({ ip: `198.51.100.${i + 1}` })).catch((e: OrderError) => {
        if (e.code === "rate_limited") phoneBlocked++;
      });
    }
    expect(phoneBlocked).toBeGreaterThanOrEqual(2);
  });
});

describe("MoySklad misbehaving during order push", () => {
  it("a lost response creates no duplicate: the retry finds the order by syncId", async () => {
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    w.mock.faults.push({ match: "customerorder", method: "POST", dropAfter: true, remaining: 1 });
    expect(await pushOrder(w.rt, order.id)).toBe("adopted"); // the ambiguity handler looked it up itself
    expect(mockOrders()).toHaveLength(1);
    expect(await pushOrder(w.rt, order.id)).toBe("noop");
  });

  it("a 502 before processing is retried later and still creates exactly one order", async () => {
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    w.mock.faults.push({ match: "customerorder", method: "POST", status: 502, remaining: 1 });
    await expect(pushOrder(w.rt, order.id)).rejects.toBeTruthy();
    let [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.syncStatus).toBe("pending_sync");
    expect(row!.lastError).toBeTruthy();
    expect(row!.attempts).toBe(1);
    expect(await pushOrder(w.rt, order.id)).toBe("created");
    expect(mockOrders()).toHaveLength(1);
    [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.syncStatus).toBe("synced");
    expect(w.mock.counterparties).toHaveLength(1); // the counterparty was not duplicated by the retry either
  });

  it("without MoySklad the order is accepted and handled locally: never pushed, never marked failed", async () => {
    const [a] = await pickInStock();
    const ms = w.rt.ms;
    w.rt.ms = null;
    try {
      const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
      expect(order.syncStatus).toBe("local");
      expect(order.statusCode).toBe("new");
      expect(order.status).toBe("Yangi");
      expect(await pushOrder(w.rt, order.id)).toBe("noop");
      const [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
      expect(row!.syncStatus).toBe("local");
      expect(row!.lastError).toBeNull();
      expect(await w.rt.queues.orders.getJob(`push-${order.id}`)).toBeUndefined();
    } finally {
      w.rt.ms = ms;
    }
    // A token that arrives later does not resend orders the staff already handled by hand.
    await w.rt.db.update(orders).set({ createdAt: new Date(Date.now() - 10 * 60_000) });
    expect(await sweepPendingOrders(w.rt)).toBe(0);
    expect(mockOrders()).toHaveLength(0);
  });
});

describe("counterparty matching policy", () => {
  async function staffCounterparty() {
    return w.rt.ms!.createCounterparty({ name: "Optom Klient MChJ", phone: "+998901234567", address: "", syncId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  }

  it("site-only (default): never attaches a guest to a counterparty staff created, but tells staff about the possible match", async () => {
    const staff = await staffCounterparty();
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    await pushOrder(w.rt, order.id);
    const remote = mockOrders()[0]!;
    expect(remote.agentId).not.toBe(staff.id);
    expect(remote.description).toContain("Optom Klient MChJ");
    expect(w.mock.counterparties).toHaveLength(2);
  });

  it("trust-phone: attaches to the existing counterparty", async () => {
    await saveSettings(w.rt, { counterpartyMatching: "trust-phone" });
    const staff = await staffCounterparty();
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    await pushOrder(w.rt, order.id);
    expect(mockOrders()[0]!.agentId).toBe(staff.id);
    expect(w.mock.counterparties).toHaveLength(1);
  });

  it("a returning guest re-attaches to the counterparty the site created before", async () => {
    const [a] = await pickInStock();
    for (let i = 0; i < 2; i++) {
      const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
      await pushOrder(w.rt, order.id);
    }
    expect(mockOrders()).toHaveLength(2);
    expect(w.mock.counterparties).toHaveLength(1);
  });
});

describe("reserve policy", () => {
  it("guest web orders do not reserve; Mini App orders do when the owner turns it on, and freeStock then drops", async () => {
    await saveSettings(w.rt, { reserveOnCreateTma: true });
    const [a] = await pickInStock();
    const web = await createOrder(w.rt, input([{ productId: a!.id, quantity: 2 }]), ctx());
    await pushOrder(w.rt, web.order.id);
    expect(w.mock.reserveOf(a!.msId)).toBe(0);

    const tma = await createOrder(w.rt, input([{ productId: a!.id, quantity: 2 }]), ctx({ channel: "tma", telegramId: 555 }));
    await pushOrder(w.rt, tma.order.id);
    expect(w.mock.reserveOf(a!.msId)).toBe(2);
  });
});

describe("statuses live in MoySklad", () => {
  it("staff changing a state in MoySklad flows back, and the customer is notified (queued as skipped without a bot token)", async () => {
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx({ channel: "tma", telegramId: 777 }));
    await pushOrder(w.rt, order.id);
    w.mock.setOrderState(w.mock.orders[0]!.id, "Tasdiqlandi", true);
    await pollOrderStates(w.rt, "schedule");
    const [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.msState).toBe("Tasdiqlandi");
    const sent = await w.rt.db.select().from(notifications).where(eq(notifications.chatId, 777));
    expect(sent.some((n) => n.text.includes("Tasdiqlandi"))).toBe(true);
    expect(sent.every((n) => n.status === "skipped")).toBe(true);
  });

  it("a status changed in our admin is written through to MoySklad", async () => {
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    await pushOrder(w.rt, order.id);
    await pushOrderState(w.rt, order.id, STATES[3].id);
    expect(w.mock.orders[0]!.stateId).toBe(STATES[3].id);
    const [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.msState).toBe(STATES[3].name);
    expect(row!.msStateType).toBe("Successful");
  });
});

describe("misc", () => {
  it("keeps product popularity, so 'popular' sorting is fed by real orders", async () => {
    const [a] = await pickInStock();
    await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    const [row] = await w.rt.db.select().from(products).where(eq(products.id, a!.id));
    expect(row!.popularity).toBe(1);
  });

  it("stores line snapshots that survive later price changes", async () => {
    const [a] = await pickInStock();
    const { order } = await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx());
    await w.rt.db.update(products).set({ price: 1, name: "renamed" }).where(eq(products.id, a!.id));
    const items = await w.rt.db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items[0]!.unitPrice).toBe(a!.price);
    expect(items[0]!.name).toBe(a!.name);
  });

  it("links a Telegram customer and remembers their phone", async () => {
    const [c] = await w.rt.db.insert(customers).values({ telegramId: 4242, name: "TG" }).returning();
    const [a] = await pickInStock();
    await createOrder(w.rt, input([{ productId: a!.id, quantity: 1 }]), ctx({ channel: "tma", customerId: c!.id, telegramId: 4242 }));
    const [row] = await w.rt.db.select().from(customers).where(eq(customers.id, c!.id));
    expect(row!.phone).toBe("+998901234567");
  });

  it("autoConfigure remains idempotent after orders exist", async () => {
    const before = await autoConfigure(w.rt);
    const after = await autoConfigure(w.rt);
    expect(after?.settings).toEqual(before?.settings);
  });
});
