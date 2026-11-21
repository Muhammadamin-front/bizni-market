import { asc, eq, orderItems, orders } from "@shop/db";
import { isLocalOrderStatus, LOCAL_ORDER_STATUS_INFO, type OrderView } from "@shop/shared";
import type { Runtime } from "../runtime";

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;

export function toOrderView(order: OrderRow, items: ItemRow[]): OrderView {
  const code = order.syncStatus === "local" && isLocalOrderStatus(order.localStatus) ? order.localStatus : null;
  const info = code ? LOCAL_ORDER_STATUS_INFO[code] : null;
  return {
    id: order.id,
    publicId: order.publicId,
    number: order.number,
    channel: order.channel === "tma" ? "tma" : "web",
    status: info ? info[order.language === "ru" ? "ru" : "uz"] : order.msState,
    statusCode: code,
    statusType: info ? info.type : ((order.msStateType as OrderView["statusType"]) ?? null),
    syncStatus: order.syncStatus as OrderView["syncStatus"],
    total: order.total,
    deliveryMethod: order.deliveryMethod === "pickup" ? "pickup" : "delivery",
    address: order.address,
    comment: order.comment,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    createdAt: order.createdAt.toISOString(),
    items: items.map((i) => ({ name: i.name, article: i.article, unit: i.unit, unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.lineTotal })),
  };
}

export async function loadOrderView(rt: Pick<Runtime, "db">, where: ReturnType<typeof eq>): Promise<OrderView | null> {
  const [order] = await rt.db.select().from(orders).where(where).limit(1);
  if (!order) return null;
  const items = await rt.db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.name));
  return toOrderView(order, items);
}
