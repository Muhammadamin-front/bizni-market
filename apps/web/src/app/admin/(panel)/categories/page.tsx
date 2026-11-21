"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { adminFetch, useAdminData } from "@/components/admin/api";
import { categoryOptions } from "@/components/admin/ProductForm";
import { useT, type L } from "@/components/admin/i18n";
import { Badge, Card, Field, Notice, btn, btnPrimary, input } from "@/components/admin/ui";

interface Cat {
  id: string; slug: string; name: string; source: "manual" | "moysklad"; parent_id: string | null; path_name: string; sort_order: number; archived: boolean;
  uz: string | null; ru: string | null; products: number;
}
interface Draft { nameUz: string; nameRu: string; parentId: string; sortOrder: string }

const toDraft = (c: Cat): Draft => ({ nameUz: c.uz ?? (c.source === "manual" ? c.name : ""), nameRu: c.ru ?? "", parentId: c.parent_id ?? "", sortOrder: String(c.sort_order) });
const body = (d: Draft) => ({ nameUz: d.nameUz, nameRu: d.nameRu, parentId: d.parentId || null, sortOrder: Number(d.sortOrder) || 0 });

const ERRORS: Record<string, L> = {
  bad_parent: { ru: "Нельзя вложить категорию саму в себя или в свою подкатегорию.", uz: "Kategoriyani oʻzining ichiga yoki oʻz ichki kategoriyasiga joylab boʻlmaydi." },
  name_required: { ru: "Введите название хотя бы на одном языке (от 2 букв).", uz: "Nomini kamida bitta tilda kiriting (2 harfdan koʻp)." },
  managed_by_moysklad: { ru: "Эту категорию ведёт МойСклад.", uz: "Bu kategoriya MoySklad'da yuritiladi." },
};

export default function CategoriesPage() {
  const t = useT();
  const { data, reload } = useAdminData<Cat[]>("/categories");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [form, setForm] = useState<Draft>({ nameUz: "", nameRu: "", parentId: "", sortOrder: "0" });
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const options = useMemo(() => categoryOptions(data), [data]);
  const ordered = useMemo(() => {
    const byId = new Map((data ?? []).map((c) => [c.id, c]));
    return options.map((o) => ({ cat: byId.get(o.id)!, depth: o.label.match(/   /g)?.length ?? 0 })).filter((x) => x.cat);
  }, [data, options]);

  const fail = (r: { data: { error?: string } }) => setMsg({ tone: "bad", text: ERRORS[r.data.error ?? ""]?.[t.lang] ?? t("Не удалось сохранить.", "Saqlab boʻlmadi.") });

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title font-bold">{t("Категории", "Kategoriyalar")}</h1>
        <Link href="/admin/products" className={btn}>{t("← Товары", "← Tovarlar")}</Link>
      </div>
      <p className="text-small text-ink-2">{t("Название пишется на двух языках: покупатель видит его на своём языке сайта и Telegram. Категории без товаров в магазине не показываются. «Порядок» — чем меньше число, тем выше.", "Nomi ikki tilda yoziladi: xaridor uni sayt va Telegram'da oʻz tilida koʻradi. Tovari yoʻq kategoriyalar doʻkonda koʻrinmaydi. «Tartib»: raqam qancha kichik boʻlsa, shuncha yuqorida turadi.")}</p>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card title={t("Новая категория", "Yangi kategoriya")}>
        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_6rem_auto] md:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await adminFetch<{ error?: string }>("/categories", { body: body(form) });
            if (!r.ok) return fail(r);
            setMsg({ tone: "ok", text: t(`Категория «${form.nameUz || form.nameRu}» создана.`, `«${form.nameUz || form.nameRu}» kategoriyasi yaratildi.`) });
            setForm({ nameUz: "", nameRu: "", parentId: form.parentId, sortOrder: "0" });
            reload();
          }}
        >
          <Field label={t("Название (узбекский)", "Nomi (oʻzbekcha)")}><input className={input} value={form.nameUz} onChange={(e) => setForm({ ...form, nameUz: e.target.value })} maxLength={120} /></Field>
          <Field label={t("Название (русский)", "Nomi (ruscha)")}><input className={input} value={form.nameRu} onChange={(e) => setForm({ ...form, nameRu: e.target.value })} maxLength={120} /></Field>
          <Field label={t("Внутри категории", "Qaysi kategoriya ichida")}>
            <select className={input} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">{t("— основная —", "— asosiy —")}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <Field label={t("Порядок", "Tartib")}><input className={`${input} tnum`} inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/[^\d-]/g, "") })} /></Field>
          <button type="submit" className={`${btnPrimary} h-9`}>{t("Создать", "Yaratish")}</button>
        </form>
      </Card>

      <Card title={t("Все категории", "Barcha kategoriyalar")}>
        {data && data.length === 0 ? <p className="py-6 text-center text-ink-2">{t("Пока нет ни одной категории.", "Hali birorta kategoriya yoʻq.")}</p> : null}
        <ul className="divide-y divide-line">
          {ordered.map(({ cat: c, depth }) => {
            const d = drafts[c.id] ?? toDraft(c);
            const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [c.id]: { ...d, ...patch } });
            const manual = c.source === "manual";
            const changed = JSON.stringify(d) !== JSON.stringify(toDraft(c));
            return (
              <li key={c.id} className="flex flex-col gap-2 py-3" style={{ paddingLeft: `${Math.min(depth, 4) * 1.25}rem` }}>
                <div className="flex flex-wrap items-center gap-2 text-small">
                  {depth ? <span className="text-ink-2">└</span> : null}
                  <span className="font-semibold">{c.uz || c.ru || c.name}</span>
                  <span className="text-ink-2">· {t("товаров", "tovarlar")}: {c.products}</span>
                  {!manual ? <Badge>MoySklad: {c.name}</Badge> : null}
                </div>
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_5rem_auto]">
                  <input className={input} value={d.nameUz} onChange={(e) => set({ nameUz: e.target.value })} placeholder={manual ? t("Название (узбекский)", "Nomi (oʻzbekcha)") : t(`uz (по умолчанию: ${c.name})`, `uz (standart: ${c.name})`)} aria-label={`${t("Название", "Nomi")} uz: ${c.name}`} maxLength={120} />
                  <input className={input} value={d.nameRu} onChange={(e) => set({ nameRu: e.target.value })} placeholder={manual ? t("Название (русский)", "Nomi (ruscha)") : t(`ru (по умолчанию: ${c.name})`, `ru (standart: ${c.name})`)} aria-label={`${t("Название", "Nomi")} ru: ${c.name}`} maxLength={120} />
                  {manual ? (
                    <select className={input} value={d.parentId} onChange={(e) => set({ parentId: e.target.value })} aria-label={`${t("Родитель", "Ota kategoriya")}: ${c.name}`}>
                      <option value="">{t("— основная —", "— asosiy —")}</option>
                      {options.filter((o) => o.id !== c.id).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  ) : (
                    <span className="self-center text-caption text-ink-2">{t("Место в дереве — из МойСклад", "Daraxtdagi oʻrni MoySklad'dan olinadi")}</span>
                  )}
                  <input className={`${input} tnum`} inputMode="numeric" value={d.sortOrder} onChange={(e) => set({ sortOrder: e.target.value.replace(/[^\d-]/g, "") })} aria-label={`${t("Порядок", "Tartib")}: ${c.name}`} />
                  <div className="flex gap-2">
                    <button
                      className={changed ? btnPrimary : btn}
                      disabled={!changed}
                      onClick={async () => {
                        const r = await adminFetch<{ error?: string }>(`/categories/${c.id}`, { method: "PUT", body: body(d) });
                        if (!r.ok) return fail(r);
                        const next = { ...drafts };
                        delete next[c.id];
                        setDrafts(next);
                        setMsg({ tone: "ok", text: t("Сохранено.", "Saqlandi.") });
                        reload();
                      }}
                    >
                      {t("Сохранить", "Saqlash")}
                    </button>
                    {manual ? (
                      <button
                        className={`${btn} text-promo`}
                        onClick={async () => {
                          const name = c.uz || c.ru || c.name;
                          const warn = c.products ? t(`\n${c.products} товар(ов) останутся, но без категории.`, `\n${c.products} ta tovar qoladi, lekin kategoriyasiz.`) : "";
                          if (!window.confirm(t(`Удалить категорию «${name}»?${warn}\nПодкатегории поднимутся на уровень выше.`, `«${name}» kategoriyasi oʻchirilsinmi?${warn}\nIchki kategoriyalar bir pogʻona yuqoriga koʻtariladi.`))) return;
                          const r = await adminFetch<{ error?: string }>(`/categories/${c.id}`, { method: "DELETE" });
                          if (!r.ok) return fail(r);
                          setMsg({ tone: "ok", text: t("Категория удалена.", "Kategoriya oʻchirildi.") });
                          reload();
                        }}
                      >
                        {t("Удалить", "Oʻchirish")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
