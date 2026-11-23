"use client";

import { editableMessages } from "@shop/shared";
import { useMemo, useState } from "react";
import { adminFetch, useAdminData } from "@/components/admin/api";
import { useT } from "@/components/admin/i18n";
import { Card, Notice, btn, btnPrimary, input } from "@/components/admin/ui";

interface Block { key: string; uz: string; ru: string }

/** Every plain text of the website and the Mini App, editable. An empty field = the built-in text (shown as the placeholder). */
export default function TextsPage() {
  const t = useT();
  const all = useMemo(() => editableMessages(), []);
  const { data, reload } = useAdminData<Block[]>("/content");
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [draft, setDraft] = useState<Record<string, { uz: string; ru: string }>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const sections = useMemo(() => [...new Set(all.map((m) => m.section))], [all]);
  const saved = (key: string) => data?.find((b) => b.key === key);
  const get = (key: string) => draft[key] ?? { uz: saved(key)?.uz ?? "", ru: saved(key)?.ru ?? "" };
  const needle = q.trim().toLowerCase();
  const rows = all.filter((m) => (!section || m.section === section) && (!needle || `${m.key} ${m.uz} ${m.ru}`.toLowerCase().includes(needle))).slice(0, 60);
  const edited = all.filter((m) => saved(m.key)?.uz || saved(m.key)?.ru).length;

  const save = async (key: string) => {
    const r = await adminFetch(`/content/${key}`, { method: "PUT", body: get(key) });
    setMsg(r.ok ? { tone: "ok", text: t("Сохранено.", "Saqlandi.") } : { tone: "bad", text: t("Не сохранено: слишком длинный текст?", "Saqlanmadi: matn juda uzunmi?") });
    if (r.ok) {
      const { [key]: _done, ...rest } = draft;
      void _done;
      setDraft(rest);
      reload();
    }
  };

  const reset = async (key: string) => {
    await adminFetch(`/content/${key}`, { method: "PUT", body: { uz: "", ru: "" } });
    const { [key]: _done, ...rest } = draft;
    void _done;
    setDraft(rest);
    setMsg({ tone: "ok", text: t("Возвращён исходный текст.", "Asl matn qaytarildi.") });
    reload();
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <h1 className="text-title font-bold">{t("Все тексты сайта", "Barcha matnlar")}</h1>
      <Notice tone="ok">
        {t(
          "Здесь можно изменить любой текст сайта и Mini App: меню, кнопки, подписи, сообщения. Пустое поле = встроенный текст (показан серым). Изменено текстов:",
          "Bu yerda saytning va Mini App'ning istalgan matnini oʻzgartirish mumkin: menyu, tugmalar, yozuvlar, xabarlar. Boʻsh maydon = ichki matn (kulrang koʻrinadi). Oʻzgartirilgan matnlar:",
        )}{" "}
        <b>{edited}</b>
      </Notice>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={`${input} max-w-xs`} placeholder={t("Поиск по тексту", "Matn boʻyicha qidirish")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Поиск", "Qidirish")} />
          <select className={`${input} max-w-48`} value={section} onChange={(e) => setSection(e.target.value)} aria-label={t("Раздел", "Boʻlim")}>
            <option value="">{t("Все разделы", "Barcha boʻlimlar")}</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((m) => {
            const v = get(m.key);
            const changed = !!(saved(m.key)?.uz || saved(m.key)?.ru);
            const dirty = draft[m.key] !== undefined;
            return (
              <li key={m.key} className="grid gap-2 py-3 md:grid-cols-2">
                <p className="font-mono text-caption text-ink-2 md:col-span-2">
                  {m.key.slice(2)}
                  {changed ? <span className="ml-2 rounded-full bg-ok-bg px-2 py-0.5 font-sans text-ok">{t("изменён", "oʻzgartirilgan")}</span> : null}
                </p>
                {(["uz", "ru"] as const).map((l) => (
                  <input key={l} className={input} maxLength={2000} value={v[l]} placeholder={m[l]} aria-label={`${m.key} ${l}`} onChange={(e) => setDraft({ ...draft, [m.key]: { ...v, [l]: e.target.value } })} />
                ))}
                <div className="flex gap-2 md:col-span-2">
                  <button className={btnPrimary} disabled={!dirty} onClick={() => save(m.key)}>{t("Сохранить", "Saqlash")}</button>
                  {changed ? <button className={btn} onClick={() => reset(m.key)}>{t("Сбросить", "Asl holiga")}</button> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? <p className="py-6 text-center text-ink-2">{t("Ничего не найдено.", "Hech narsa topilmadi.")}</p> : null}
        {rows.length === 60 ? <p className="pt-3 text-caption text-ink-2">{t("Показаны первые 60: уточните поиск или раздел.", "Dastlabki 60 ta koʻrsatildi: qidiruvni yoki boʻlimni aniqlashtiring.")}</p> : null}
      </Card>
    </div>
  );
}
