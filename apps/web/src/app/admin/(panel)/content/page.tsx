"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch, useAdminData } from "@/components/admin/api";
import { uploadImageTo } from "@/components/admin/images";
import { useT, type L } from "@/components/admin/i18n";
import { Card, Field, Notice, Table, btn, btnPrimary, input } from "@/components/admin/ui";

interface Block { key: string; uz: string; ru: string }
interface Banner { id: string; locale: string | null; title: string; subtitle: string; imageKey: string | null; linkUrl: string; position: number; active: boolean }

const BLOCKS: [string, L][] = [
  ["footer.phone", { ru: "Телефон", uz: "Telefon" }],
  ["footer.address", { ru: "Адрес", uz: "Manzil" }],
  ["footer.hours", { ru: "Часы работы", uz: "Ish vaqti" }],
  ["footer.email", { ru: "Почта", uz: "Email" }],
  ["page.about", { ru: "Страница «О нас»", uz: "«Biz haqimizda» sahifasi" }],
  ["page.delivery", { ru: "Страница «Доставка»", uz: "«Yetkazib berish» sahifasi" }],
  ["page.offer", { ru: "Публичная оферта", uz: "Ommaviy oferta" }],
  ["page.privacy", { ru: "Политика конфиденциальности", uz: "Maxfiylik siyosati" }],
];

export default function ContentPage() {
  const t = useT();
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-title font-bold">{t("Контент витрины", "Sayt matnlari")}</h1>
      <Notice tone="ok">{t("Контакты, страницы и баннеры. Пустые блоки на сайте не показываются: ничего не придумывается.", "Kontaktlar, sahifalar va bannerlar. Boʻsh bloklar saytda koʻrsatilmaydi: hech narsa oʻylab topilmaydi.")}</Notice>
      <Blocks />
      <Banners />
      <Categories />
    </div>
  );
}

function Blocks() {
  const t = useT();
  const { data, reload } = useAdminData<Block[]>("/content");
  const [draft, setDraft] = useState<Record<string, { uz: string; ru: string }>>({});
  const [saved, setSaved] = useState("");
  const get = (k: string) => draft[k] ?? { uz: data?.find((b) => b.key === k)?.uz ?? "", ru: data?.find((b) => b.key === k)?.ru ?? "" };
  return (
    <Card title={t("Контакты и страницы", "Kontaktlar va sahifalar")}>
      {saved ? <Notice tone="ok">{t("Сохранено:", "Saqlandi:")} {BLOCKS.find(([k]) => k === saved)?.[1][t.lang]}</Notice> : null}
      <div className="mt-2 flex flex-col gap-5">
        {BLOCKS.map(([key, label]) => {
          const long = key.startsWith("page.");
          const v = get(key);
          return (
            <div key={key} className="grid gap-2 md:grid-cols-2">
              <p className="text-small font-semibold md:col-span-2">{label[t.lang]} <span className="font-mono text-caption text-ink-2">{key}</span></p>
              {(["uz", "ru"] as const).map((l) => (
                <Field key={l} label={l === "uz" ? t("Узбекский", "Oʻzbekcha") : t("Русский", "Ruscha")}>
                  {long ? <textarea className="min-h-24 rounded-control border border-line bg-card p-2 text-small" value={v[l]} onChange={(e) => setDraft({ ...draft, [key]: { ...v, [l]: e.target.value } })} /> : <input className={input} value={v[l]} onChange={(e) => setDraft({ ...draft, [key]: { ...v, [l]: e.target.value } })} />}
                </Field>
              ))}
              <div className="md:col-span-2"><button className={btn} onClick={async () => { await adminFetch(`/content/${key}`, { method: "PUT", body: get(key) }); setSaved(key); reload(); }}>{t("Сохранить", "Saqlash")}</button></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Banners() {
  const t = useT();
  const { data, reload } = useAdminData<Banner[]>("/banners");
  const [form, setForm] = useState({ title: "", subtitle: "", linkUrl: "/catalog", locale: "" });
  const [error, setError] = useState("");
  return (
    <Card title={t("Баннеры на главной", "Bosh sahifadagi bannerlar")}>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <p className="mb-3 text-small text-ink-2">
        {t("Картинка баннера показывается в рамке 16:7 и заполняет её целиком: рекомендуемый размер", "Banner rasmi 16:7 ramkada koʻrsatiladi va uni toʻliq egallaydi. Tavsiya etilgan oʻlcham:")} <b>1600×700</b>.{" "}
        {t("Если формат другой, края обрежутся — в превью ниже видно ровно то, что увидят на сайте. Важный текст держите ближе к центру.", "Format boshqacha boʻlsa, chetlari kesiladi: pastdagi koʻrinishda saytda qanday chiqishi aynan koʻrinadi. Muhim yozuvni markazga yaqin joylashtiring.")}
      </p>
      <Table head={[t("Заголовок", "Sarlavha"), t("Ссылка", "Havola"), t("Язык", "Til"), t("Картинка (как на сайте)", "Rasm (saytdagidek)"), ""]}>
        {data?.map((b) => (
          <tr key={b.id}>
            <td>{b.title}<br /><span className="text-ink-2">{b.subtitle}</span></td>
            <td className="font-mono text-caption">{b.linkUrl}</td>
            <td>{b.locale ?? t("все", "hammasi")}</td>
            <td>
              <div className="flex flex-col gap-2">
                {b.imageKey ? (
                  // Same frame and fit as the home page, so the owner sees the exact crop.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/media/${b.imageKey}-1000.webp`} alt="" className="aspect-[16/7] w-48 rounded-control border border-line object-cover" />
                ) : (
                  <span className="flex aspect-[16/7] w-48 items-center justify-center rounded-control border border-dashed border-line-strong text-caption text-ink-2">{t("нет картинки", "rasm yoʻq")}</span>
                )}
                <label className={`${btn} w-fit cursor-pointer`}>{b.imageKey ? t("Заменить", "Almashtirish") : t("Загрузить", "Yuklash")}
                  <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const r = await uploadImageTo(`/banners/${b.id}/image`, f, t.lang); setError(r.ok ? "" : r.error); reload(); }} />
                </label>
              </div>
            </td>
            <td className="whitespace-nowrap">
              <button className={btn} onClick={async () => { await adminFetch(`/banners/${b.id}`, { method: "PATCH", body: { active: !b.active } }); reload(); }}>{b.active ? t("Выключить", "Oʻchirish") : t("Включить", "Yoqish")}</button>{" "}
              <button className={btn} onClick={async () => { await adminFetch(`/banners/${b.id}`, { method: "DELETE" }); reload(); }}>{t("Удалить", "Oʻchirish")}</button>
            </td>
          </tr>
        ))}
      </Table>
      <form className="mt-4 grid gap-2 md:grid-cols-4" onSubmit={async (e) => {
        e.preventDefault();
        const r = await adminFetch("/banners", { body: { title: form.title, subtitle: form.subtitle, linkUrl: form.linkUrl, locale: form.locale || null } });
        setError(r.ok ? "" : t("Проверьте поля: ссылка должна начинаться с / или https://", "Maydonlarni tekshiring: havola / yoki https:// bilan boshlanishi kerak"));
        if (r.ok) setForm({ title: "", subtitle: "", linkUrl: "/catalog", locale: "" });
        reload();
      }}>
        <Field label={t("Заголовок", "Sarlavha")}><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
        <Field label={t("Подзаголовок", "Qoʻshimcha matn")}><input className={input} value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></Field>
        <Field label={t("Ссылка", "Havola")}><input className={input} value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} /></Field>
        <Field label={t("Язык", "Til")}><select className={input} value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}><option value="">{t("Все", "Hammasi")}</option><option value="uz">uz</option><option value="ru">ru</option></select></Field>
        <button type="submit" className={`${btnPrimary} md:col-span-4 md:w-fit`}>{t("Добавить баннер", "Banner qoʻshish")}</button>
      </form>
    </Card>
  );
}

function Categories() {
  const t = useT();
  return (
    <Card title={t("Категории", "Kategoriyalar")}>
      <p className="text-small text-ink-2">{t("Названия категорий на двух языках, порядок и вложенность — в разделе", "Kategoriya nomlari ikki tilda, tartibi va joylashuvi:")} <Link href="/admin/categories" className="font-semibold text-action hover:underline">{t("Категории", "Kategoriyalar")}</Link>.</p>
    </Card>
  );
}
