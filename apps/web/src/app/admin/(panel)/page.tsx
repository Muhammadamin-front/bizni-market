"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch, fmtDate, useAdminData } from "@/components/admin/api";
import { useT, type L } from "@/components/admin/i18n";
import { Badge, Card, Notice, Stat, btn, btnPrimary } from "@/components/admin/ui";

interface Dashboard {
  connected: boolean;
  demo: boolean;
  breakerOpenUntil: number;
  lastRuns: { kind: string; status: string; started_at: string; finished_at: string | null; counts: Record<string, number>; error: string | null }[];
  catalog: Record<string, number>;
  stock: { inStock: number; outOfStock: number };
  images: Record<string, number>;
  orders: Record<string, number>;
  webhooks: { events24h: number; lastAt: string | null; configured: boolean };
  queues: Record<string, Record<string, number>>;
  telegram: { botToken: boolean; username: string | null };
  warnings: L[];
}

export default function DashboardPage() {
  const t = useT();
  const { data: d, loading, error, reload } = useAdminData<Dashboard>("/dashboard");
  const [now] = useState(() => Date.now());
  if (loading && !d) return <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p>;
  if (!d) return <Notice tone="bad">{t(`Не удалось загрузить${error ? ` (ошибка ${error})` : ""}`, `Yuklab boʻlmadi${error ? ` (xato ${error})` : ""}`)}</Notice>;
  const breaker = d.breakerOpenUntil > now;

  const c = (k: string) => d.catalog[k] ?? 0;
  const localNew = d.orders.local_new ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title font-bold">{t("Обзор", "Umumiy holat")}</h1>
        <div className="flex items-center gap-2">
          {!d.connected ? (
            <Badge>{t("Каталог ведётся вручную", "Katalog qoʻlda yuritiladi")}</Badge>
          ) : d.demo ? (
            <Badge tone="warn">{t("Демо-источник (не настоящий МойСклад)", "Demo manba (haqiqiy MoySklad emas)")}</Badge>
          ) : (
            <Badge tone="ok">{t("МойСклад подключён", "MoySklad ulangan")}</Badge>
          )}
          <button className={btn} onClick={reload}>{t("Обновить", "Yangilash")}</button>
        </div>
      </div>
      {d.warnings.map((w) => (
        <Notice key={w.ru}>{w[t.lang]}</Notice>
      ))}
      {breaker ? (
        <Notice tone="bad">
          {t(`Связь с МойСклад приостановлена защитой от блокировки до ${fmtDate(new Date(d.breakerOpenUntil))}.`, `MoySklad bilan aloqa bloklanishdan himoya sababli ${fmtDate(new Date(d.breakerOpenUntil))} gacha toʻxtatilgan.`)}{" "}
          <button className="font-semibold underline" onClick={async () => { await adminFetch("/sync/breaker-reset", { body: {} }); reload(); }}>{t("Снять паузу", "Pauzani olib tashlash")}</button>
        </Notice>
      ) : null}
      {localNew > 0 ? (
        <Notice tone="warn">
          {t("Новых заказов ждут обработки:", "Koʻrib chiqilishi kerak boʻlgan yangi buyurtmalar:")} <b>{localNew}</b>.{" "}
          <Link href="/admin/orders?sync=local" className="font-semibold underline">{t("Открыть заказы", "Buyurtmalarni ochish")}</Link>
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/products/new" className={btnPrimary}>{t("+ Добавить товар", "+ Tovar qoʻshish")}</Link>
        <Link href="/admin/products?filter=no_image" className={btn}>{t("Товары без фото", "Rasmsiz tovarlar")}{c("without_image") ? ` (${c("without_image")})` : ""}</Link>
        <Link href="/admin/categories" className={btn}>{t("Категории", "Kategoriyalar")}</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Товаров на витрине", "Saytdagi tovarlar")} value={c("visible")} />
        <Stat label={t("В наличии / нет", "Bor / yoʻq")} value={`${d.stock.inStock} / ${d.stock.outOfStock}`} />
        <Stat label={t("Без цены (не видны)", "Narxsiz (koʻrinmaydi)")} value={c("without_price")} tone={c("without_price") > 0 ? "warn" : undefined} />
        <Stat label={t("Без фото", "Rasmsiz")} value={c("without_image")} tone={c("without_image") > 0 ? "warn" : undefined} />
        <Stat label={t("Заказов за сутки", "Bir kunlik buyurtmalar")} value={d.orders.last_day ?? 0} />
        {d.connected ? (
          <>
            <Stat label={t("Ждут отправки", "Yuborilishini kutmoqda")} value={d.orders.pending ?? 0} tone={(d.orders.pending ?? 0) > 0 ? "warn" : undefined} />
            <Stat label={t("Не отправились", "Yuborilmadi")} value={d.orders.failed ?? 0} tone={(d.orders.failed ?? 0) > 0 ? "bad" : "ok"} />
            <Stat label={t("Фото: готово / ждёт", "Rasmlar: tayyor / kutmoqda")} value={`${d.images.ready ?? 0} / ${(d.images.pending ?? 0) + (d.images.failed ?? 0)}`} />
          </>
        ) : (
          <>
            <Stat label={t("Новых заказов", "Yangi buyurtmalar")} value={localNew} tone={localNew > 0 ? "warn" : undefined} />
            <Stat label={t("Скрыто вручную", "Qoʻlda yashirilgan")} value={c("hidden")} />
            <Stat label={t("Всего заказов", "Jami buyurtmalar")} value={d.orders.total ?? 0} />
          </>
        )}
      </div>

      {d.connected ? (
        <Card title={t("Последние запуски синхронизации", "Soʻnggi sinxronizatsiyalar")}>
          {d.lastRuns.length === 0 ? (
            <p className="text-small text-ink-2">{t("Синхронизаций ещё не было.", "Hali sinxronizatsiya boʻlmagan.")}</p>
          ) : (
            <ul className="divide-y divide-line text-small">
              {d.lastRuns.map((r) => (
                <li key={r.kind} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-mono">{r.kind}</span>
                  <span className="text-ink-2">{fmtDate(r.started_at)}</span>
                  <Badge tone={r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "neutral"}>{r.status}</Badge>
                  <span className="basis-full text-caption text-ink-2">{r.error ?? Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {d.connected ? (
          <Card title={t("Вебхуки МойСклад", "MoySklad vebxuklari")}>
            <p className="text-small">
              {d.webhooks.configured
                ? t(`Событий за сутки: ${d.webhooks.events24h}; последнее: ${fmtDate(d.webhooks.lastAt)}`, `Bir kundagi hodisalar: ${d.webhooks.events24h}; oxirgisi: ${fmtDate(d.webhooks.lastAt)}`)
                : t("Секрет не задан — работает только опрос по расписанию.", "Maxfiy kalit berilmagan: faqat jadval boʻyicha soʻrov ishlaydi.")}
            </p>
          </Card>
        ) : null}
        <Card title="Telegram">
          <p className="text-small">
            {d.telegram.botToken
              ? t(`Бот подключён${d.telegram.username ? `: @${d.telegram.username}` : ""}`, `Bot ulangan${d.telegram.username ? `: @${d.telegram.username}` : ""}`)
              : t("Токен бота не задан: уведомления только записываются.", "Bot tokeni berilmagan: xabarlar faqat jurnalga yoziladi.")}
          </p>
        </Card>
      </div>
    </div>
  );
}
