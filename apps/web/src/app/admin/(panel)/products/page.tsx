"use client";

import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { adminFetch, currency, fmtMoney, useAdminData } from "@/components/admin/api";
import { categoryOptions } from "@/components/admin/ProductForm";
import { useT, type L } from "@/components/admin/i18n";
import { Badge, Card, Notice, btn, btnPrimary, input } from "@/components/admin/ui";

interface Row {
  id: string; slug: string; name: string; article: string; price: number; old_price: number | null; available_qty: string; uom: string | null; archived: boolean;
  source: "manual" | "moysklad"; brand: string | null; category: string | null; hidden: boolean; thumb: string | null; images_ready: number; images_pending: number;
}
interface CatRow { id: string; name: string; parent_id: string | null; uz: string | null; ru: string | null; archived: boolean; sort_order: number }

const FILTERS: [string, L][] = [
  ["all", { ru: "Все", uz: "Hammasi" }],
  ["manual", { ru: "Добавлены вручную", uz: "Qoʻlda qoʻshilgan" }],
  ["hidden", { ru: "Скрытые", uz: "Yashirilgan" }],
  ["no_image", { ru: "Без фото", uz: "Rasmsiz" }],
  ["no_price", { ru: "Без цены", uz: "Narxsiz" }],
  ["out", { ru: "Нет в наличии", uz: "Mavjud emas" }],
  ["archived", { ru: "В архиве МойСклад", uz: "MoySklad arxivida" }],
];

/** A number cell that saves itself on Enter or when it loses focus. Only for products typed in by hand. */
function InlineNumber({ value, suffix, onSave, label, money }: { value: number; suffix?: string; onSave: (v: number) => Promise<boolean>; label: string; money?: boolean }) {
  const [saved, setSaved] = useState(value);
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const commit = async () => {
    setFocused(false);
    const n = Number(text.replace(/\s/g, "").replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(n) || n < 0 || (money && !Number.isInteger(n))) return setState("error");
    if (n === saved) return setState("idle");
    setState("saving");
    if (await onSave(n)) {
      setSaved(n);
      setState("saved");
    } else setState("error");
  };
  // Sums read grouped ("125 000") except while typing.
  const shown = money && !focused && /^\d+$/.test(text) ? text.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : text;
  return (
    <span className="inline-flex items-center gap-1">
      <input
        className={`${input} tnum h-8 w-28 text-right ${state === "error" ? "border-promo" : state === "saved" ? "border-ok" : ""}`}
        inputMode={money ? "numeric" : "decimal"}
        value={shown}
        aria-label={label}
        aria-invalid={state === "error" || undefined}
        onChange={(e) => { setText(e.target.value.replace(/[^\d.,]/g, "")); setState("idle"); }}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setText(String(saved)); setState("idle"); }
        }}
      />
      <span className="w-9 text-caption text-ink-2">{state === "saving" ? "…" : state === "saved" ? "✓" : suffix}</span>
    </span>
  );
}

export default function ProductsPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  // The admin renders client-side only (after the session check), so reading the URL here is safe; links like ?filter=no_image land filtered.
  const [filter, setFilter] = useState(() => (typeof window === "undefined" ? "all" : (new URLSearchParams(window.location.search).get("filter") ?? "all")));
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const path = `/products?page=${page}&filter=${filter}${category ? `&category=${category}` : ""}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`;
  const { data, loading, reload } = useAdminData<{ rows: Row[]; total: number; pageSize: number; connected: boolean }>(path);
  const { data: cats } = useAdminData<CatRow[]>("/categories");
  const catOptions = useMemo(() => categoryOptions(cats), [cats]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const [error, setError] = useState("");

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await adminFetch<{ error?: string }>(`/products/${id}`, { method: "PATCH", body });
    setError(r.ok ? "" : r.data.error === "managed_by_moysklad" ? t("Цена и остаток товара из МойСклад меняются в МойСклад.", "MoySklad tovarining narxi va qoldigʻi MoySklad'da oʻzgartiriladi.") : t("Не удалось сохранить.", "Saqlab boʻlmadi."));
    return r.ok;
  };

  const nothingYet = data && data.total === 0 && filter === "all" && !debounced && !category;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title font-bold">{t("Товары", "Tovarlar")}</h1>
        <div className="flex gap-2">
          <Link href="/admin/categories" className={btn}>{t("Категории", "Kategoriyalar")}</Link>
          <Link href="/admin/products/new" className={`${btnPrimary} gap-1`}><Plus aria-hidden className="size-4" />{t("Добавить товар", "Tovar qoʻshish")}</Link>
        </div>
      </div>
      {data?.connected ? <Notice tone="ok">{t("Товары из МойСклад меняются в МойСклад (здесь их можно только скрыть). Товары, добавленные вручную, редактируются здесь.", "MoySklad tovarlari MoySklad'da oʻzgartiriladi (bu yerda faqat yashirish mumkin). Qoʻlda qoʻshilgan tovarlar shu yerda tahrirlanadi.")}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {nothingYet ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Package aria-hidden className="size-12 text-line-strong" strokeWidth={1.25} />
            <p className="text-lead font-semibold">{t("Товаров пока нет", "Hali tovar yoʻq")}</p>
            <p className="max-w-md text-small text-ink-2">{t("Создайте пару категорий (например «Kanselyariya» и «Elektronika»), затем добавляйте товары: название, цена, остаток и фото. Они сразу появятся на сайте и в Telegram.", "Avval bir-ikkita kategoriya yarating (masalan, «Kanselyariya» va «Elektronika»), keyin tovar qoʻshing: nomi, narxi, qoldigʻi va rasmi. Ular darhol saytda va Telegram'da paydo boʻladi.")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/admin/categories" className={btn}>{t("1. Категории", "1. Kategoriyalar")}</Link>
              <Link href="/admin/products/new" className={btnPrimary}>{t("2. Добавить первый товар", "2. Birinchi tovarni qoʻshish")}</Link>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap gap-2">
            <input className={`${input} max-w-xs`} type="search" placeholder={t("Название, артикул или штрихкод", "Nomi, artikul yoki shtrixkod")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={t("Поиск товаров", "Tovar qidirish")} />
            <select className={`${input} max-w-56`} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} aria-label={t("Фильтр", "Filtr")}>
              {FILTERS.filter(([v]) => data?.connected || v !== "archived").map(([v, l]) => <option key={v} value={v}>{l[t.lang]}</option>)}
            </select>
            <select className={`${input} max-w-64`} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={t("Категория", "Kategoriya")}>
              <option value="">{t("Все категории", "Barcha kategoriyalar")}</option>
              {catOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="self-center text-small text-ink-2">{t("Найдено:", "Topildi:")} {data?.total ?? "…"}</span>
          </div>

          {loading && !data ? <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p> : null}
          {data && data.rows.length === 0 ? <p className="py-8 text-center text-ink-2">{t("Ничего не найдено.", "Hech narsa topilmadi.")}</p> : null}
          <ul className="divide-y divide-line">
            {data?.rows.map((p) => {
              const manual = p.source === "manual";
              return (
                <li key={p.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 md:grid-cols-[3.5rem_minmax(0,1fr)_auto_auto_auto]">
                  <Link href={`/admin/products/${p.id}`} className={`flex size-14 items-center justify-center overflow-hidden rounded-control border border-line ${p.thumb ? "bg-white" : "bg-sunken"}`} aria-label={`${t("Открыть", "Ochish")}: ${p.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.thumb ? <img src={p.thumb} alt="" width={56} height={56} className="size-full object-contain" loading="lazy" /> : <Package aria-hidden className="size-6 text-line-strong" strokeWidth={1.5} />}
                  </Link>
                  <div className="min-w-0">
                    <Link href={`/admin/products/${p.id}`} className="font-medium hover:text-action hover:underline">{p.name}</Link>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-2">
                      {p.article ? <span className="font-mono">{p.article}</span> : null}
                      <span>{p.category ?? t("без категории", "kategoriyasiz")}</span>
                      {p.brand ? <span>· {p.brand}</span> : null}
                      {!manual ? <Badge>{t("МойСклад", "MoySklad")}</Badge> : null}
                      {p.thumb ? null : <Badge tone="warn">{t("нет фото", "rasm yoʻq")}</Badge>}
                      {p.hidden ? <Badge tone="warn">{t("скрыт", "yashirilgan")}</Badge> : null}
                      {p.archived ? <Badge>{t("архив", "arxiv")}</Badge> : null}
                      {p.price <= 0 ? <Badge tone="warn">{t("нет цены — не виден", "narx yoʻq — koʻrinmaydi")}</Badge> : null}
                    </p>
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 md:col-span-1 md:contents">
                    <div className="flex items-center gap-1 text-small">
                      <span className="w-16 text-caption text-ink-2 md:hidden">{t("Цена", "Narx")}</span>
                      {manual ? <InlineNumber key={`p${p.price}`} money label={`${t("Цена", "Narx")}: ${p.name}`} value={p.price} suffix={currency(t.lang)} onSave={(v) => patch(p.id, { price: v })} /> : <span className="tnum">{p.price > 0 ? fmtMoney(p.price, t.lang) : "—"}</span>}
                    </div>
                    <div className="flex items-center gap-1 text-small">
                      <span className="w-16 text-caption text-ink-2 md:hidden">{t("Остаток", "Qoldiq")}</span>
                      {manual ? <InlineNumber key={`q${p.available_qty}`} label={`${t("Остаток", "Qoldiq")}: ${p.name}`} value={Number(p.available_qty)} suffix={p.uom ?? ""} onSave={(v) => patch(p.id, { availableQty: v })} /> : <span className="tnum">{Number(p.available_qty)} {p.uom ?? ""}</span>}
                    </div>
                    <label className="flex items-center gap-2 text-small" title={t("Показывать в магазине", "Doʻkonda koʻrsatish")}>
                      <input type="checkbox" className="size-4" checked={!p.hidden} disabled={p.archived} onChange={async (e) => { await patch(p.id, { hidden: !e.target.checked }); reload(); }} />
                      <span className="md:sr-only">{t("Показывать", "Koʻrsatish")}</span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-center gap-3 text-small">
            <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Назад", "Orqaga")}</button>
            <span className="tnum text-ink-2">{page} / {pages}</span>
            <button className={btn} disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("Далее", "Keyingi")}</button>
          </div>
        </Card>
      )}
    </div>
  );
}
