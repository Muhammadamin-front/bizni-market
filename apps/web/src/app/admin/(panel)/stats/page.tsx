"use client";

import { useState } from "react";
import { fmtMoney, useAdminData } from "@/components/admin/api";
import { useT } from "@/components/admin/i18n";
import { Card, Notice, Stat, Table, btn } from "@/components/admin/ui";

interface Stats {
  days: number;
  revenue: number;
  revenueAllTime: number;
  soldOrders: number;
  averageCheck: number;
  unitsSold: number;
  awaiting: { orders: number; amount: number };
  cancelled: { orders: number; amount: number };
  byChannel: { web: number; tma: number };
  daily: { day: string; revenue: number; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  stock: { units: number; value: number; outOfStock: number };
}

const PERIODS = [7, 30, 90, 365] as const;

export default function StatsPage() {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const { data: s, loading, error } = useAdminData<Stats>(`/stats?days=${days}`);
  const money = (n: number) => fmtMoney(n, t.lang);
  const max = Math.max(1, ...(s?.daily.map((d) => d.revenue) ?? [0]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title font-bold">{t("Статистика", "Statistika")}</h1>
        <div className="flex gap-1" role="group" aria-label={t("Период", "Davr")}>
          {PERIODS.map((p) => (
            <button key={p} className={`${btn} ${days === p ? "border-ink bg-ink text-white hover:bg-ink" : ""}`} aria-pressed={days === p} onClick={() => setDays(p)}>
              {p === 365 ? t("Год", "Yil") : t(`${p} дн.`, `${p} kun`)}
            </button>
          ))}
        </div>
      </div>

      {!s ? (
        loading ? <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p> : <Notice tone="bad">{t(`Не удалось загрузить${error ? ` (ошибка ${error})` : ""}`, `Yuklab boʻlmadi${error ? ` (xato ${error})` : ""}`)}</Notice>
      ) : (
        <>
          <Notice tone="ok">
            {t(
              "Деньги считаются только по подтверждённым заказам (подтверждён, доставляется, готов, выполнен). Новые и отменённые заказы в выручку не входят.",
              "Pul faqat tasdiqlangan buyurtmalar boʻyicha hisoblanadi (tasdiqlandi, yetkazilmoqda, tayyor, yakunlandi). Yangi va bekor qilingan buyurtmalar daromadga kirmaydi.",
            )}
          </Notice>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Выручка за период", "Davr daromadi")} value={money(s.revenue)} tone="ok" />
            <Stat label={t("Продано заказов", "Sotilgan buyurtmalar")} value={s.soldOrders} />
            <Stat label={t("Средний чек", "Oʻrtacha chek")} value={money(s.averageCheck)} />
            <Stat label={t("Продано единиц", "Sotilgan dona")} value={Math.round(s.unitsSold * 1000) / 1000} />
            <Stat label={t("Ждут подтверждения", "Tasdiqlash kutilmoqda")} value={`${s.awaiting.orders} · ${money(s.awaiting.amount)}`} tone={s.awaiting.orders > 0 ? "warn" : undefined} />
            <Stat label={t("Отменено за период", "Davrda bekor qilingan")} value={`${s.cancelled.orders} · ${money(s.cancelled.amount)}`} />
            <Stat label={t("Сайт / Telegram", "Sayt / Telegram")} value={`${money(s.byChannel.web)} / ${money(s.byChannel.tma)}`} />
            <Stat label={t("Выручка за всё время", "Barcha vaqt daromadi")} value={money(s.revenueAllTime)} />
          </div>

          <Card title={t("Выручка по дням", "Kunlar boʻyicha daromad")}>
            <div className="flex h-44 items-end gap-px" role="img" aria-label={t("График выручки по дням", "Kunlik daromad grafigi")}>
              {s.daily.map((d) => (
                <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${d.day}: ${money(d.revenue)} (${d.orders})`}>
                  <div className="w-full rounded-t-[2px] bg-action/80 group-hover:bg-action" style={{ height: `${d.revenue > 0 ? Math.max(2, (d.revenue / max) * 100) : 0}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-caption text-ink-2">
              <span>{s.daily[0]?.day}</span>
              <span>{t("макс.", "maks.")} {money(max === 1 ? 0 : max)}</span>
              <span>{s.daily.at(-1)?.day}</span>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t("Самые продаваемые товары", "Eng koʻp sotilgan tovarlar")}>
              {s.topProducts.length === 0 ? (
                <p className="py-4 text-center text-ink-2">{t("Пока нет подтверждённых продаж.", "Hozircha tasdiqlangan sotuvlar yoʻq.")}</p>
              ) : (
                <Table head={[t("Товар", "Tovar"), t("Кол-во", "Soni"), t("Сумма", "Summa")]}>
                  {s.topProducts.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="tnum">{Math.round(p.quantity * 1000) / 1000}</td>
                      <td className="tnum whitespace-nowrap">{money(p.revenue)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title={t("Склад (наш учёт)", "Ombor (bizning hisob)")}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-small">
                <dt className="text-ink-2">{t("Единиц на складе", "Ombordagi dona")}</dt>
                <dd className="tnum font-semibold">{Math.round(s.stock.units * 1000) / 1000}</dd>
                <dt className="text-ink-2">{t("Стоимость остатка по цене продажи", "Qoldiq qiymati (sotuv narxida)")}</dt>
                <dd className="tnum font-semibold">{money(s.stock.value)}</dd>
                <dt className="text-ink-2">{t("Товаров нет в наличии", "Tugagan tovarlar")}</dt>
                <dd className="tnum font-semibold">{s.stock.outOfStock}</dd>
              </dl>
              <p className="mt-3 text-caption text-ink-2">
                {t(
                  "Остаток уменьшается автоматически при оформлении заказа и возвращается при отмене.",
                  "Qoldiq buyurtma berilganda avtomatik kamayadi, bekor qilinsa qaytadi.",
                )}
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
