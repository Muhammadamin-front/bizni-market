import { sql } from "@shop/db";
import type { Runtime } from "./runtime";

/**
 * "Sold" means the owner confirmed the order: a local order past "new" (confirmed, delivering, ready, done) or a MoySklad order in a
 * successful state. New and cancelled orders bring no money. The money is the order total at the time of ordering.
 */
const SOLD = sql`((o.sync_status = 'local' AND o.local_status IN ('confirmed','delivering','ready','done')) OR (o.sync_status <> 'local' AND o.ms_state_type = 'Successful'))`;
const CANCELLED = sql`((o.sync_status = 'local' AND o.local_status = 'cancelled') OR o.sync_status = 'cancelled' OR (o.sync_status <> 'local' AND o.ms_state_type = 'Unsuccessful'))`;
const AWAITING = sql`(o.sync_status = 'local' AND o.local_status = 'new')`;
/** Days are counted in the shop's own time zone, not UTC. */
const TZ = "Asia/Tashkent";

export interface SalesStats {
  days: number;
  /** Money from confirmed orders in the period / over all time. */
  revenue: number;
  revenueAllTime: number;
  soldOrders: number;
  averageCheck: number;
  unitsSold: number;
  awaiting: { orders: number; amount: number };
  cancelled: { orders: number; amount: number };
  byChannel: { web: number; tma: number };
  /** One row per day of the period, oldest first, empty days included. */
  daily: { day: string; revenue: number; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  /** Stock left on the shelves (our own count), valued at the selling price. */
  stock: { units: number; value: number; outOfStock: number };
}

export async function salesStats(rt: Pick<Runtime, "db">, daysInput: number): Promise<SalesStats> {
  const days = Math.min(365, Math.max(1, Math.floor(daysInput) || 30));
  const since = sql`((now() AT TIME ZONE ${TZ})::date - ${days - 1}::int)`;
  const inPeriod = sql`((o.created_at AT TIME ZONE ${TZ})::date >= ${since})`;

  const [sum] = (
    await rt.db.execute(sql`SELECT
      COALESCE(sum(o.total) FILTER (WHERE ${SOLD} AND ${inPeriod}), 0)::float8 AS revenue,
      COALESCE(sum(o.total) FILTER (WHERE ${SOLD}), 0)::float8 AS revenue_all,
      count(*) FILTER (WHERE ${SOLD} AND ${inPeriod})::int AS sold_orders,
      COALESCE(sum(o.total) FILTER (WHERE ${SOLD} AND ${inPeriod} AND o.channel = 'web'), 0)::float8 AS web,
      COALESCE(sum(o.total) FILTER (WHERE ${SOLD} AND ${inPeriod} AND o.channel = 'tma'), 0)::float8 AS tma,
      count(*) FILTER (WHERE ${AWAITING})::int AS awaiting_orders,
      COALESCE(sum(o.total) FILTER (WHERE ${AWAITING}), 0)::float8 AS awaiting_amount,
      count(*) FILTER (WHERE ${CANCELLED} AND ${inPeriod})::int AS cancelled_orders,
      COALESCE(sum(o.total) FILTER (WHERE ${CANCELLED} AND ${inPeriod}), 0)::float8 AS cancelled_amount
      FROM orders o`)
  ).rows as Record<string, number>[];

  const dailyRows = (
    await rt.db.execute(sql`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(s.revenue, 0)::float8 AS revenue, COALESCE(s.orders, 0)::int AS orders
      FROM generate_series(${since}::date, (now() AT TIME ZONE ${TZ})::date, interval '1 day') AS d(day)
      LEFT JOIN (SELECT (o.created_at AT TIME ZONE ${TZ})::date AS day, sum(o.total) AS revenue, count(*) AS orders FROM orders o WHERE ${SOLD} GROUP BY 1) s ON s.day = d.day::date
      ORDER BY d.day`)
  ).rows as { day: string; revenue: number; orders: number }[];

  const top = (
    await rt.db.execute(sql`SELECT i.name, sum(i.quantity)::float8 AS quantity, sum(i.line_total)::float8 AS revenue
      FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE ${SOLD} AND ${inPeriod} GROUP BY i.name ORDER BY revenue DESC LIMIT 10`)
  ).rows as { name: string; quantity: number; revenue: number }[];

  const units = (
    await rt.db.execute(sql`SELECT COALESCE(sum(i.quantity), 0)::float8 AS units FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${SOLD} AND ${inPeriod}`)
  ).rows as { units: number }[];

  const [stock] = (
    await rt.db.execute(sql`SELECT COALESCE(sum(p.available_qty) FILTER (WHERE p.available_qty > 0), 0)::float8 AS units,
        COALESCE(sum(p.available_qty * p.price) FILTER (WHERE p.available_qty > 0 AND p.price > 0), 0)::float8 AS value,
        count(*) FILTER (WHERE p.available_qty <= 0)::int AS out_of_stock
      FROM products p WHERE p.archived = false`)
  ).rows as { units: number; value: number; out_of_stock: number }[];

  const revenue = sum?.revenue ?? 0;
  const soldOrders = sum?.sold_orders ?? 0;
  return {
    days,
    revenue,
    revenueAllTime: sum?.revenue_all ?? 0,
    soldOrders,
    averageCheck: soldOrders > 0 ? Math.round(revenue / soldOrders) : 0,
    unitsSold: units[0]?.units ?? 0,
    awaiting: { orders: sum?.awaiting_orders ?? 0, amount: sum?.awaiting_amount ?? 0 },
    cancelled: { orders: sum?.cancelled_orders ?? 0, amount: sum?.cancelled_amount ?? 0 },
    byChannel: { web: sum?.web ?? 0, tma: sum?.tma ?? 0 },
    daily: dailyRows,
    topProducts: top,
    stock: { units: stock?.units ?? 0, value: stock?.value ?? 0, outOfStock: stock?.out_of_stock ?? 0 },
  };
}
