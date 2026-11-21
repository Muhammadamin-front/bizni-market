"use client";

import { useState } from "react";
import { adminFetch, fmtDate, useAdminData } from "@/components/admin/api";
import { useT, type L } from "@/components/admin/i18n";
import { Badge, Card, Notice, Table, btn } from "@/components/admin/ui";

interface Run { id: string; kind: string; status: string; trigger: string; startedAt: string; finishedAt: string | null; counts: Record<string, number>; error: string | null }

const RUNS: [string, L, L][] = [
  ["full", { ru: "Полная синхронизация", uz: "Toʻliq sinxronizatsiya" }, { ru: "Папки, все товары, остатки, фото, вебхуки", uz: "Papkalar, barcha tovarlar, qoldiqlar, rasmlar, vebxuklar" }],
  ["products", { ru: "Товары", uz: "Tovarlar" }, { ru: "Изменения с последней синхронизации", uz: "Oxirgi sinxronizatsiyadan beri oʻzgarganlar" }],
  ["stock", { ru: "Остатки", uz: "Qoldiqlar" }, { ru: "Изменившиеся остатки", uz: "Oʻzgargan qoldiqlar" }],
  ["folders", { ru: "Категории", uz: "Kategoriyalar" }, { ru: "Дерево групп товаров", uz: "Tovar guruhlari daraxti" }],
  ["images", { ru: "Фото", uz: "Rasmlar" }, { ru: "Скачать недостающие фото", uz: "Yetishmayotgan rasmlarni yuklab olish" }],
  ["reconcile", { ru: "Сверка удалённых", uz: "Oʻchirilganlarni tekshirish" }, { ru: "Скрыть товары, удалённые в МойСклад", uz: "MoySklad'da oʻchirilgan tovarlarni yashirish" }],
  ["webhook-health", { ru: "Проверка вебхуков", uz: "Vebxuklarni tekshirish" }, { ru: "Создать/включить вебхуки МойСклад", uz: "MoySklad vebxuklarini yaratish/yoqish" }],
  ["order-states", { ru: "Статусы заказов", uz: "Buyurtma holatlari" }, { ru: "Подтянуть статусы из МойСклад", uz: "Holatlarni MoySklad'dan olish" }],
];

export default function SyncPage() {
  const t = useT();
  const { data, reload } = useAdminData<{ runs: Run[]; breakerOpenUntil: number }>("/sync");
  const [now] = useState(() => Date.now());
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-bold">{t("Синхронизация с МойСклад", "MoySklad bilan sinxronizatsiya")}</h1>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data && data.breakerOpenUntil > now ? <Notice tone="bad">{t(`Пауза до ${fmtDate(new Date(data.breakerOpenUntil))} (защита от блокировки API).`, `${fmtDate(new Date(data.breakerOpenUntil))} gacha pauza (API bloklanishidan himoya).`)}</Notice> : null}
      <Card title={t("Запустить вручную", "Qoʻlda ishga tushirish")}>
        <ul className="grid gap-2 md:grid-cols-2">
          {RUNS.map(([kind, label, hint]) => (
            <li key={kind} className="flex items-center justify-between gap-3 rounded-control border border-line p-3">
              <span><span className="block text-small font-semibold">{label[t.lang]}</span><span className="text-caption text-ink-2">{hint[t.lang]}</span></span>
              <button className={btn} onClick={async () => {
                const r = await adminFetch<{ error?: string }>("/sync/run", { body: { kind } });
                setMsg(r.ok ? { tone: "ok", text: `${t("Поставлено в очередь", "Navbatga qoʻyildi")}: ${label[t.lang]}` } : { tone: "bad", text: r.data.error === "not_connected" ? t("МойСклад не подключён (нет токена).", "MoySklad ulanmagan (token yoʻq).") : t("Ошибка", "Xato") });
                setTimeout(reload, 1500);
              }}>{t("Запустить", "Ishga tushirish")}</button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("Журнал запусков", "Ishga tushirishlar jurnali")} actions={<button className={btn} onClick={reload}>{t("Обновить", "Yangilash")}</button>}>
        <Table head={[t("Запуск", "Jarayon"), t("Тип", "Turi"), t("Начало", "Boshlanishi"), t("Статус", "Holat"), t("Результат", "Natija")]}>
          {data?.runs.map((r) => (
            <tr key={r.id}>
              <td className="font-mono">{r.kind}</td>
              <td>{r.trigger}</td>
              <td className="whitespace-nowrap">{fmtDate(r.startedAt)}</td>
              <td><Badge tone={r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "neutral"}>{r.status}</Badge></td>
              <td className="text-caption">{r.error ? <span className="text-promo">{r.error}</span> : Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join(", ")}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
