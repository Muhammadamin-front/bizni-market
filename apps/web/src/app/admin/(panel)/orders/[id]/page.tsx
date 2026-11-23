"use client";

import Link from "next/link";
import { LOCAL_ORDER_STATUSES, LOCAL_ORDER_STATUS_INFO, type LocalOrderStatus } from "@shop/shared";
import { use, useState } from "react";
import { adminFetch, fmtDate, fmtMoney, useAdminData } from "@/components/admin/api";
import { useT } from "@/components/admin/i18n";
import { Badge, Card, Notice, Table, btn } from "@/components/admin/ui";

interface Detail {
  id: string; number: string; channel: string; status: string | null; statusCode: LocalOrderStatus | null; statusType: string | null; syncStatus: string; total: number;
  deliveryMethod: string; address: string; comment: string; contactName: string; contactPhone: string; createdAt: string;
  items: { name: string; article: string; unit: string | null; unitPrice: number; quantity: number; lineTotal: number }[];
  msOrderId: string | null; msOrderName: string | null; attempts: number; lastError: string | null; telegramId: number | null;
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const { data: o, reload } = useAdminData<Detail>(`/orders/${id}`);
  const { data: states } = useAdminData<{ id: string; name: string; stateType: string }[]>("/order-states");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!o) return <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p>;

  const act = async (fn: () => Promise<{ ok: boolean; data: unknown }>, okText: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    const err = (r.data as { message?: string; error?: string }) ?? {};
    setMessage(r.ok ? { tone: "ok", text: okText } : { tone: "bad", text: err.message ?? err.error ?? t("Ошибка", "Xato") });
    reload();
  };
  const statusWord = t("Статус", "Holat");

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Link href="/admin/orders" className="text-small text-link hover:underline">{t("← Все заказы", "← Barcha buyurtmalar")}</Link>
      <h1 className="text-title font-bold">{t(`Заказ ${o.number}`, `Buyurtma ${o.number}`)}</h1>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {o.syncStatus === "local" ? (
        <Card title={statusWord}>
          <div className="flex flex-wrap items-center gap-2">
            {LOCAL_ORDER_STATUSES.map((code) => {
              const info = LOCAL_ORDER_STATUS_INFO[code];
              const current = o.statusCode === code;
              const tone = info.type === "Successful" ? "bg-ok text-on-ink border-ok" : info.type === "Unsuccessful" ? "bg-promo text-on-ink border-promo" : "bg-ink text-on-ink border-ink";
              return (
                <button
                  key={code}
                  className={`${btn} ${current ? tone : ""}`}
                  aria-pressed={current}
                  disabled={busy}
                  onClick={() => {
                    if (current) return;
                    if (code === "cancelled" && !window.confirm(t("Отменить заказ? Товары, добавленные вручную, вернутся в остаток.", "Buyurtma bekor qilinsinmi? Qoʻlda qoʻshilgan tovarlar qoldiqqa qaytadi."))) return;
                    void act(() => adminFetch(`/orders/${o.id}/local-status`, { body: { status: code } }), `${statusWord}: ${info[t.lang]}`);
                  }}
                >
                  {info[t.lang]}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-caption text-ink-2">
            {t(
              `Заказ ведётся здесь, в админке. Клиент видит статус на странице заказа${o.telegramId ? " и получает сообщение в Telegram" : ""} на своём языке («${o.statusCode ? LOCAL_ORDER_STATUS_INFO[o.statusCode].uz : "—"}»).`,
              `Buyurtma shu yerda, admin panelda yuritiladi. Mijoz holatni buyurtma sahifasida${o.telegramId ? " va Telegram xabarida" : ""} oʻz tilida koʻradi («${o.statusCode ? LOCAL_ORDER_STATUS_INFO[o.statusCode].ru : "—"}»).`,
            )}
          </p>
        </Card>
      ) : (
        <Card title={statusWord}>
          <div className="flex flex-wrap items-center gap-3">
            {o.status ? <Badge tone={o.statusType === "Successful" ? "ok" : o.statusType === "Unsuccessful" ? "bad" : "neutral"}>{o.status}</Badge> : <span className="text-ink-2">{t("ещё не в МойСклад", "hali MoySklad'da emas")}</span>}
            <Badge tone={o.syncStatus === "synced" ? "ok" : o.syncStatus === "failed" ? "bad" : "warn"}>{o.syncStatus}</Badge>
            <span className="text-small text-ink-2">{t("попыток отправки:", "yuborishga urinishlar:")} {o.attempts}</span>
          </div>
          {o.lastError ? <p className="mt-2 text-small text-promo">{o.lastError}</p> : null}
          {o.syncStatus !== "synced" ? (
            <button className={`${btn} mt-3`} disabled={busy} onClick={() => act(() => adminFetch(`/orders/${o.id}/retry`, { body: {} }), t("Отправка поставлена в очередь", "Yuborish navbatga qoʻyildi"))}>{t("Повторить отправку в МойСклад", "MoySklad'ga qayta yuborish")}</button>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-small text-ink-2">{t("Сменить статус (запишется в МойСклад):", "Holatni oʻzgartirish (MoySklad'ga yoziladi):")}</span>
              {states?.map((s) => (
                <button key={s.id} className={btn} disabled={busy || s.name === o.status} onClick={() => act(() => adminFetch(`/orders/${o.id}/state`, { body: { stateId: s.id } }), `${statusWord}: ${s.name}`)}>{s.name}</button>
              ))}
            </div>
          )}
        </Card>
      )}
      <Card title={t("Клиент и доставка", "Mijoz va yetkazib berish")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
          <dt className="text-ink-2">{t("Клиент", "Mijoz")}</dt><dd>{o.contactName}, <a className="text-link hover:underline" href={`tel:${o.contactPhone}`}>{o.contactPhone}</a></dd>
          <dt className="text-ink-2">{t("Канал", "Kanal")}</dt><dd>{o.channel === "tma" ? `Telegram${o.telegramId ? ` (id ${o.telegramId})` : ""}` : t("Сайт (гость)", "Sayt (mehmon)")}</dd>
          <dt className="text-ink-2">{t("Получение", "Qabul qilish")}</dt><dd>{o.deliveryMethod === "pickup" ? t("Самовывоз", "Oʻzi olib ketadi") : o.address}</dd>
          <dt className="text-ink-2">{t("Комментарий", "Izoh")}</dt><dd>{o.comment || "—"}</dd>
          <dt className="text-ink-2">{t("Создан", "Yaratilgan")}</dt><dd>{fmtDate(o.createdAt)}</dd>
          {o.syncStatus !== "local" ? <><dt className="text-ink-2">{t("МойСклад", "MoySklad")}</dt><dd className="font-mono">{o.msOrderName ?? "—"} {o.msOrderId ? `(${o.msOrderId.slice(0, 8)}…)` : ""}</dd></> : null}
        </dl>
      </Card>
      <Card title={t("Состав (цены на момент заказа)", "Tarkibi (buyurtma paytidagi narxlar)")}>
        <Table head={[t("Товар", "Tovar"), t("Артикул", "Artikul"), t("Кол-во", "Soni"), t("Цена", "Narx"), t("Сумма", "Summa")]}>
          {o.items.map((i, k) => (
            <tr key={k}><td>{i.name}</td><td className="font-mono">{i.article}</td><td className="tnum">{i.quantity} {i.unit ?? ""}</td><td className="tnum whitespace-nowrap">{fmtMoney(i.unitPrice, t.lang)}</td><td className="tnum whitespace-nowrap">{fmtMoney(i.lineTotal, t.lang)}</td></tr>
          ))}
        </Table>
        <p className="mt-3 text-right text-lead font-bold">{fmtMoney(o.total, t.lang)}</p>
      </Card>
    </div>
  );
}
