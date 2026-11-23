"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch, useAdminData } from "@/components/admin/api";
import { uploadImageTo } from "@/components/admin/images";
import { useT, type L } from "@/components/admin/i18n";
import { Card, Field, Notice, Table, btn, btnPrimary, input } from "@/components/admin/ui";

interface Block { key: string; uz: string; ru: string }
interface Banner { id: string; locale: string | null; title: string; subtitle: string; imageKey: string | null; linkUrl: string; position: number; active: boolean }

/** One editable text. Empty = the built-in default (shown greyed as the placeholder). */
interface BlockDef { key: string; label: L; kind?: "line" | "text"; max?: number; placeholder?: L; hint?: L }

const SHOP_BLOCKS: BlockDef[] = [
  { key: "brand.name", label: { ru: "Название магазина", uz: "Doʻkon nomi" }, max: 60, placeholder: { ru: "Kanso", uz: "Kanso" }, hint: { ru: "В шапке сайта, в подвале, во вкладке браузера, в админке.", uz: "Sayt tepasida, pastida, brauzer yorligʻida va admin panelda." } },
  { key: "home.heroTitle", label: { ru: "Заголовок главной страницы", uz: "Bosh sahifa sarlavhasi" }, max: 120, placeholder: { ru: "Компьютеры, компьютерные услуги и канцелярия", uz: "Kompyuterlar, kompyuter xizmatlari va kanselyariya" }, hint: { ru: "Виден, когда нет баннеров с картинкой; всегда используется для поисковиков.", uz: "Rasmli banner boʻlmaganda koʻrinadi; qidiruv tizimlari uchun doim ishlatiladi." } },
  { key: "home.heroBody", label: { ru: "Текст под заголовком (и описание для поисковиков)", uz: "Sarlavha ostidagi matn (qidiruv tizimlari uchun tavsif ham)" }, kind: "text", max: 300, placeholder: { ru: "Цены и наличие всегда актуальны: видно только то, что есть на полке.", uz: "Narx va qoldiq doimo joriy: omborda bor narsagina koʻrinadi." } },
];

const BOT_BLOCKS: BlockDef[] = [
  { key: "bot.welcome", label: { ru: "Приветствие на /start", uz: "/start xabari" }, kind: "text", max: 4000, placeholder: { ru: "Добро пожаловать! Откройте магазин кнопкой ниже: компьютеры, компьютерные услуги и канцелярия с актуальными ценами и наличием.", uz: "Xush kelibsiz! Doʻkonni pastdagi tugma orqali oching: kompyuterlar, kompyuter xizmatlari va kanselyariya, joriy narx va qoldiq bilan." }, hint: { ru: "Действует сразу.", uz: "Darhol ishlaydi." } },
  { key: "bot.description", label: { ru: "Описание бота (экран до /start)", uz: "Bot tavsifi (/start dan oldingi ekran)" }, kind: "text", max: 512, placeholder: { ru: "Компьютеры, компьютерные услуги и канцелярия с актуальными ценами и наличием. Оформите заказ.", uz: "Kompyuterlar, kompyuter xizmatlari va kanselyariya: joriy narx va qoldiq bilan. Buyurtma bering." }, hint: { ru: "После сохранения: Система → «Настроить бота».", uz: "Saqlagach: Tizim → «Botni sozlash»." } },
  { key: "bot.shortDescription", label: { ru: "Короткое описание (профиль бота)", uz: "Qisqa tavsif (bot profili)" }, max: 120, placeholder: { ru: "Компьютеры и компьютерные услуги", uz: "Kompyuterlar va kompyuter xizmatlari" }, hint: { ru: "После сохранения: Система → «Настроить бота».", uz: "Saqlagach: Tizim → «Botni sozlash»." } },
];

const CONTACT_BLOCKS: BlockDef[] = [
  { key: "footer.phone", label: { ru: "Телефон", uz: "Telefon" } },
  { key: "footer.address", label: { ru: "Адрес", uz: "Manzil" } },
  { key: "footer.hours", label: { ru: "Часы работы", uz: "Ish vaqti" } },
  { key: "footer.email", label: { ru: "Почта", uz: "Email" } },
  { key: "page.about", label: { ru: "Страница «О нас»", uz: "«Biz haqimizda» sahifasi" }, kind: "text" },
  { key: "page.delivery", label: { ru: "Страница «Доставка»", uz: "«Yetkazib berish» sahifasi" }, kind: "text" },
  { key: "page.offer", label: { ru: "Публичная оферта", uz: "Ommaviy oferta" }, kind: "text" },
  { key: "page.privacy", label: { ru: "Политика конфиденциальности", uz: "Maxfiylik siyosati" }, kind: "text" },
];

export default function ContentPage() {
  const t = useT();
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-title font-bold">{t("Контент витрины", "Sayt matnlari")}</h1>
      <Notice tone="ok">{t("Всё, что видят покупатели на сайте и в Telegram. Пустое поле = текст по умолчанию (показан серым). Пустые контакты и страницы на сайте не показываются.", "Xaridorlar saytda va Telegram'da koʻradigan hamma narsa. Boʻsh maydon = standart matn (kulrang koʻrinadi). Boʻsh kontaktlar va sahifalar saytda koʻrsatilmaydi.")}</Notice>
      <Blocks title={t("Магазин и главная страница", "Doʻkon va bosh sahifa")} defs={SHOP_BLOCKS} />
      <Blocks title={t("Telegram-бот", "Telegram bot")} defs={BOT_BLOCKS} />
      <Blocks title={t("Контакты и страницы", "Kontaktlar va sahifalar")} defs={CONTACT_BLOCKS} />
      <Banners />
      <Categories />
    </div>
  );
}

function Blocks({ title, defs }: { title: string; defs: BlockDef[] }) {
  const t = useT();
  const { data, reload } = useAdminData<Block[]>("/content");
  const [draft, setDraft] = useState<Record<string, { uz: string; ru: string }>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const get = (k: string) => draft[k] ?? { uz: data?.find((b) => b.key === k)?.uz ?? "", ru: data?.find((b) => b.key === k)?.ru ?? "" };
  return (
    <Card title={title}>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <div className="mt-2 flex flex-col gap-5">
        {defs.map((d) => {
          const v = get(d.key);
          return (
            <div key={d.key} className="grid gap-2 md:grid-cols-2">
              <div className="md:col-span-2">
                <p className="text-small font-semibold">{d.label[t.lang]}</p>
                {d.hint ? <p className="text-caption text-ink-2">{d.hint[t.lang]}</p> : null}
              </div>
              {(["uz", "ru"] as const).map((l) => {
                const common = {
                  value: v[l],
                  maxLength: d.max,
                  placeholder: d.placeholder?.[l === "uz" ? "uz" : "ru"],
                  onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [d.key]: { ...v, [l]: e.target.value } }),
                };
                return (
                  <Field key={l} label={l === "uz" ? t("Узбекский", "Oʻzbekcha") : t("Русский", "Ruscha")}>
                    {d.kind === "text" ? <textarea className="min-h-24 rounded-control border border-line bg-card p-2 text-small" {...common} /> : <input className={input} {...common} />}
                  </Field>
                );
              })}
              <div className="flex items-center gap-2 md:col-span-2">
                <button
                  className={btn}
                  onClick={async () => {
                    const r = await adminFetch(`/content/${d.key}`, { method: "PUT", body: get(d.key) });
                    setMsg(r.ok ? { tone: "ok", text: `${t("Сохранено:", "Saqlandi:")} ${d.label[t.lang]}` } : { tone: "bad", text: t("Не сохранено: слишком длинный текст?", "Saqlanmadi: matn juda uzunmi?") });
                    if (r.ok) {
                      const { [d.key]: _done, ...rest } = draft;
                      void _done;
                      setDraft(rest);
                      reload();
                    }
                  }}
                >
                  {t("Сохранить", "Saqlash")}
                </button>
                {d.max ? <span className="text-caption text-ink-2">{t(`до ${d.max} знаков`, `${d.max} belgigacha`)}</span> : null}
              </div>
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
