"use client";

import { isLocalOrderStatus, LOCAL_ORDER_STATUS_INFO } from "@shop/shared";
import Link from "next/link";
import { useState } from "react";
import { adminFetch, fmtDate, fmtMoney, useAdminData } from "@/components/admin/api";
import { useT, type L } from "@/components/admin/i18n";
import { Badge, Card, Notice, Table, btn, btnPrimary, input } from "@/components/admin/ui";

interface Row {
  id: string;
  number: string;
  channel: string;
  syncStatus: string;
  msState: string | null;
  msStateType: string | null;
  localStatus: string | null;
  total: number;
  contactName: string;
  contactPhone: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Cancelled (any way): only such orders can be deleted for good. */
  cancelled: boolean;
}

const SYNC_LABEL: Record<string, L> = {
  pending_sync: { ru: "ждёт отправки", uz: "yuborilishi kutilmoqda" },
  synced: { ru: "в МойСклад", uz: "MoySklad'da" },
  failed: { ru: "ошибка", uz: "xato" },
  cancelled: { ru: "отменён", uz: "bekor qilingan" },
  local: { ru: "ведётся здесь", uz: "shu yerda yuritiladi" },
};

function StatusBadge({ o }: { o: Row }) {
  const t = useT();
  if (o.syncStatus === "local" && isLocalOrderStatus(o.localStatus)) {
    const info = LOCAL_ORDER_STATUS_INFO[o.localStatus];
    return <Badge tone={info.type === "Successful" ? "ok" : info.type === "Unsuccessful" ? "bad" : o.localStatus === "new" ? "warn" : "neutral"}>{info[t.lang]}</Badge>;
  }
  return o.msState ? <Badge tone={o.msStateType === "Successful" ? "ok" : o.msStateType === "Unsuccessful" ? "bad" : "neutral"}>{o.msState}</Badge> : <>—</>;
}

export default function OrdersPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const [sync, setSync] = useState(() => (typeof window === "undefined" ? "all" : (new URLSearchParams(window.location.search).get("sync") ?? "all")));
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data, loading, reload } = useAdminData<{ rows: Row[]; total: number; pageSize: number; cancelledTotal: number }>(`/orders?page=${page}&sync=${sync}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  // Confirm = the order counts as sold (money in the statistics); cancel = the stock of manual products comes back.
  const setStatus = async (o: Row, status: "confirmed" | "cancelled") => {
    if (status === "cancelled" && !window.confirm(t(`Отменить заказ ${o.number}? Остаток вернётся на склад.`, `${o.number} buyurtma bekor qilinsinmi? Qoldiq omborga qaytadi.`))) return;
    setBusyId(o.id);
    setError(null);
    const r = await adminFetch(`/orders/${o.id}/local-status`, { body: { status } });
    setBusyId(null);
    if (!r.ok) setError((r.data as { message?: string; error?: string })?.message ?? t("Ошибка", "Xato"));
    reload();
  };
  // Deleting for good: only cancelled orders (their stock already came back), and the API checks that again.
  const remove = async (o: Row) => {
    if (!window.confirm(t(`Удалить отменённый заказ ${o.number} навсегда? Вернуть его будет нельзя.`, `Bekor qilingan ${o.number} buyurtma butunlay oʻchirilsinmi? Uni qaytarib boʻlmaydi.`))) return;
    setBusyId(o.id);
    setError(null);
    setNotice(null);
    const r = await adminFetch(`/orders/${o.id}`, { method: "DELETE" });
    setBusyId(null);
    if (r.ok) setNotice(t(`Заказ ${o.number} удалён.`, `${o.number} buyurtma oʻchirildi.`));
    else setError(r.status === 409 ? t("Удалить можно только отменённый заказ.", "Faqat bekor qilingan buyurtmani oʻchirish mumkin.") : t("Не удалось удалить.", "Oʻchirib boʻlmadi."));
    reload();
  };
  const removeAllCancelled = async () => {
    const word = t("УДАЛИТЬ", "OʻCHIRISH");
    const typed = window.prompt(
      t(
        `Будут удалены ВСЕ отменённые заказы (${data?.cancelledTotal ?? 0}). Остальные заказы останутся. Вернуть нельзя.\n\nЧтобы подтвердить, напишите: ${word}`,
        `BARCHA bekor qilingan buyurtmalar (${data?.cancelledTotal ?? 0} ta) oʻchiriladi. Boshqa buyurtmalar qoladi. Qaytarib boʻlmaydi.\n\nTasdiqlash uchun yozing: ${word}`,
      ),
    );
    if (typed === null) return;
    if (typed.trim().toUpperCase().replace(/[ʻ'`’]/g, "") !== word.replace(/[ʻ'`’]/g, "")) {
      setNotice(null);
      setError(t("Не подтверждено: заказы не удалены.", "Tasdiqlanmadi: buyurtmalar oʻchirilmadi."));
      return;
    }
    setError(null);
    setNotice(null);
    setBusyId("all");
    const r = await adminFetch<{ deleted?: number }>("/orders/delete-cancelled", { body: { confirm: "DELETE" } });
    setBusyId(null);
    if (r.ok) setNotice(t(`Удалено отменённых заказов: ${r.data.deleted ?? 0}`, `Oʻchirildi: ${r.data.deleted ?? 0} ta bekor qilingan buyurtma`));
    else setError(t("Не удалось удалить.", "Oʻchirib boʻlmadi."));
    setPage(1);
    reload();
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-bold">{t("Заказы", "Buyurtmalar")}</h1>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={`${input} max-w-xs`} placeholder={t("Номер, имя или телефон", "Raqam, ism yoki telefon")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={t("Поиск заказов", "Buyurtma qidirish")} />
          <select className={`${input} max-w-56`} value={sync} onChange={(e) => { setSync(e.target.value); setPage(1); }} aria-label={t("Статус отправки", "Yuborish holati")}>
            <option value="all">{t("Все", "Hammasi")}</option>
            <option value="local">{t("Ведутся здесь", "Shu yerda yuritiladi")}</option>
            <option value="pending_sync">{t("Ждут отправки", "Yuborilishi kutilmoqda")}</option>
            <option value="synced">{t("В МойСклад", "MoySklad'da")}</option>
            <option value="failed">{t("С ошибкой", "Xato bilan")}</option>
            <option value="cancelled">{t("Отменённые", "Bekor qilinganlar")}</option>
          </select>
          {data && data.cancelledTotal > 0 ? (
            <button className={`${btn} ml-auto border-promo text-promo`} disabled={busyId !== null} onClick={() => void removeAllCancelled()}>
              {t(`Удалить все отменённые (${data.cancelledTotal})`, `Bekor qilinganlarni oʻchirish (${data.cancelledTotal})`)}
            </button>
          ) : null}
        </div>
        {loading && !data ? <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p> : (
          <Table head={["№", t("Дата", "Sana"), t("Клиент", "Mijoz"), t("Сумма", "Summa"), t("Канал", "Kanal"), t("Статус", "Holat"), t("Где ведётся", "Qayerda yuritiladi"), t("Действие", "Amal")]}>
            {data?.rows.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/admin/orders/${o.id}`} className="font-semibold text-link hover:underline">{o.number}</Link></td>
                <td className="whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                <td>{o.contactName}<br /><span className="text-ink-2">{o.contactPhone}</span></td>
                <td className="tnum whitespace-nowrap">{fmtMoney(o.total, t.lang)}</td>
                <td>{o.channel === "tma" ? "Telegram" : t("Сайт", "Sayt")}</td>
                <td><StatusBadge o={o} /></td>
                <td><Badge tone={o.syncStatus === "synced" || o.syncStatus === "local" ? "neutral" : o.syncStatus === "failed" ? "bad" : "warn"}>{SYNC_LABEL[o.syncStatus]?.[t.lang] ?? o.syncStatus}</Badge>{o.lastError ? <p className="mt-1 max-w-xs text-caption text-promo">{o.lastError}</p> : null}</td>
                <td className="whitespace-nowrap">
                  {o.syncStatus === "local" && (o.localStatus === "new" || o.localStatus === "confirmed" || o.localStatus === "delivering" || o.localStatus === "ready") ? (
                    <span className="flex gap-1">
                      {o.localStatus === "new" ? <button className={btnPrimary} disabled={busyId === o.id} onClick={() => void setStatus(o, "confirmed")}>{t("Подтвердить", "Tasdiqlash")}</button> : null}
                      <button className={btn} disabled={busyId === o.id} onClick={() => void setStatus(o, "cancelled")}>{t("Отменить", "Bekor qilish")}</button>
                    </span>
                  ) : o.cancelled ? (
                    <button className={`${btn} text-promo`} disabled={busyId !== null} onClick={() => void remove(o)} aria-label={`${t("Удалить навсегда", "Butunlay oʻchirish")}: ${o.number}`}>
                      {t("Удалить", "Oʻchirish")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {data && data.rows.length === 0 ? <p className="py-6 text-center text-ink-2">{t("Заказов нет.", "Buyurtmalar yoʻq.")}</p> : null}
        <div className="mt-3 flex items-center justify-center gap-3 text-small">
          <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Назад", "Orqaga")}</button>
          <span className="tnum text-ink-2">{page} / {pages}</span>
          <button className={btn} disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("Далее", "Keyingi")}</button>
        </div>
      </Card>
    </div>
  );
}
