"use client";

import { HEX_COLOR, HOME_SECTIONS, type HomeSection } from "@shop/shared";
import { useState } from "react";
import { adminFetch, useAdminData } from "@/components/admin/api";
import { uploadImageTo } from "@/components/admin/images";
import { useT, type L } from "@/components/admin/i18n";
import { Card, Notice, btn, btnPrimary, input } from "@/components/admin/ui";

interface Block { key: string; uz: string; ru: string }

const SECTION_LABEL: Record<HomeSection, L> = {
  banners: { ru: "Баннеры / заголовок вверху", uz: "Tepadagi bannerlar / sarlavha" },
  categories: { ru: "Категории", uz: "Kategoriyalar" },
  brands: { ru: "Бренды", uz: "Brendlar" },
  featured: { ru: "Рекомендуемые товары", uz: "Tavsiya etilgan tovarlar" },
  offers: { ru: "Скидки и акции", uz: "Chegirmalar" },
  newArrivals: { ru: "Новинки", uz: "Yangi kelganlar" },
  bestsellers: { ru: "Хиты продаж", uz: "Eng koʻp sotilganlar" },
};

/** Look of the site, managed by the owner: logo, colours and which home sections are shown. Applies to the website and the Mini App. */
export default function SitePage() {
  const t = useT();
  const { data, reload } = useAdminData<Block[]>("/content");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const value = (key: string) => data?.find((b) => b.key === key)?.uz ?? "";
  const logo = value("theme.logo");

  const put = async (key: string, v: string, okText: string) => {
    const r = await adminFetch(`/content/${key}`, { method: "PUT", body: { uz: v, ru: v } });
    setMsg(r.ok ? { tone: "ok", text: okText } : { tone: "bad", text: t("Не сохранено.", "Saqlanmadi.") });
    reload();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">{t("Дизайн сайта", "Sayt dizayni")}</h1>
      <Notice tone="ok">{t("Изменения действуют на сайте и в Telegram Mini App сразу. Тексты сайта: раздел «Все тексты».", "Oʻzgarishlar saytda va Telegram Mini App'da darhol kuchga kiradi. Sayt matnlari: «Barcha matnlar» boʻlimi.")}</Notice>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card title={t("Логотип", "Logotip")}>
        <p className="mb-3 text-small text-ink-2">{t("Показывается в шапке сайта вместо названия магазина. Лучше PNG/WebP с прозрачным фоном, высота около 100 px.", "Sayt tepasida doʻkon nomi oʻrniga koʻrsatiladi. Shaffof fonli PNG/WebP yaxshi, balandligi taxminan 100 px.")}</p>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/media/${logo}-400.webp`} alt="" className="mb-3 h-14 w-auto max-w-60 rounded-control border border-line bg-card object-contain p-1" />
        ) : (
          <p className="mb-3 text-small text-ink-2">{t("Логотип не загружен: показывается название магазина.", "Logotip yuklanmagan: doʻkon nomi koʻrsatiladi.")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <label className={`${btnPrimary} cursor-pointer`}>
            {logo ? t("Заменить", "Almashtirish") : t("Загрузить", "Yuklash")}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const r = await uploadImageTo("/site/logo", f, t.lang);
                setMsg(r.ok ? { tone: "ok", text: t("Логотип сохранён.", "Logotip saqlandi.") } : { tone: "bad", text: r.error });
                reload();
              }}
            />
          </label>
          {logo ? (
            <button
              className={btn}
              onClick={async () => {
                await adminFetch("/site/logo", { method: "DELETE" });
                setMsg({ tone: "ok", text: t("Логотип удалён.", "Logotip oʻchirildi.") });
                reload();
              }}
            >
              {t("Удалить", "Oʻchirish")}
            </button>
          ) : null}
        </div>
      </Card>

      <Card title={t("Цвета", "Ranglar")}>
        <div className="grid gap-4 md:grid-cols-2">
          <ColorField label={t("Цвет кнопок и ссылок", "Tugmalar va havolalar rangi")} def="#2f5bff" value={value("theme.action")} onSave={(v) => put("theme.action", v, t("Цвет сохранён.", "Rang saqlandi."))} />
          <ColorField label={t("Цвет фона страниц", "Sahifa foni rangi")} def="#f6f3ee" value={value("theme.ground")} onSave={(v) => put("theme.ground", v, t("Цвет сохранён.", "Rang saqlandi."))} />
        </div>
        <p className="mt-3 text-caption text-ink-2">{t("Выбирайте цвет кнопок достаточно тёмным: белый текст на нём должен читаться. «По умолчанию» возвращает исходный цвет.", "Tugma rangini yetarlicha toʻq tanlang: ustidagi oq matn oʻqilishi kerak. «Standart» asl rangni qaytaradi.")}</p>
      </Card>

      <Card title={t("Разделы главной страницы", "Bosh sahifa boʻlimlari")}>
        <p className="mb-3 text-small text-ink-2">{t("Снимите галочку, чтобы скрыть раздел на главной (сайт и Mini App).", "Boʻlimni bosh sahifada yashirish uchun belgini olib tashlang (sayt va Mini App).")}</p>
        <ul className="flex flex-col gap-2">
          {HOME_SECTIONS.map((s) => {
            const shown = value(`home.show.${s}`) !== "0";
            return (
              <li key={s}>
                <label className="flex cursor-pointer items-center gap-3 text-small">
                  <input type="checkbox" className="size-4" checked={shown} onChange={() => put(`home.show.${s}`, shown ? "0" : "1", `${SECTION_LABEL[s][t.lang]}: ${shown ? t("скрыто", "yashirildi") : t("показано", "koʻrsatildi")}`)} />
                  {SECTION_LABEL[s][t.lang]}
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function ColorField({ label, def, value, onSave }: { label: string; def: string; value: string; onSave: (v: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  const valid = shown === "" || HEX_COLOR.test(shown);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} className="size-9 cursor-pointer rounded-control border border-line bg-card p-0.5" value={HEX_COLOR.test(shown) ? shown : def} onChange={(e) => setDraft(e.target.value)} />
        <input className={`${input} max-w-32 font-mono`} value={shown} placeholder={def} maxLength={7} onChange={(e) => setDraft(e.target.value)} aria-label={`${label} (hex)`} />
      </div>
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={!valid || draft === null} onClick={() => { onSave(shown); setDraft(null); }}>{t("Сохранить", "Saqlash")}</button>
        <button className={btn} disabled={value === "" && draft === null} onClick={() => { onSave(""); setDraft(null); }}>{t("По умолчанию", "Standart")}</button>
      </div>
      {!valid ? <p className="text-caption text-promo">{t("Формат: #2f5bff", "Format: #2f5bff")}</p> : null}
    </div>
  );
}
