"use client";

import type { AiStatus } from "@shop/shared";
import { Languages, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { adminFetch, fmtMoney } from "./api";
import { useT, type T } from "./i18n";
import { Card, btn } from "./ui";

// ------------------------------------------------------------------------------------------------ status (shared)

/** One status for the menu, the AI page and the product form; every AI call refreshes it, so the meter is always current. */
let cached: AiStatus | null = null;
const listeners = new Set<(s: AiStatus | null) => void>();

export async function refreshAiStatus(): Promise<void> {
  const r = await adminFetch<AiStatus>("/ai/status");
  if (r.ok) cached = r.data;
  listeners.forEach((l) => l(cached));
}

export function useAiStatus(): AiStatus | null {
  const [s, setS] = useState<AiStatus | null>(cached);
  useEffect(() => {
    listeners.add(setS);
    void refreshAiStatus();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export const fmtTokens = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const fmtDay = (iso: string, lang: "uz" | "ru") => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(lang === "uz" ? "uz-UZ" : "ru-RU", { day: "numeric", month: "long" }) : "");

// ------------------------------------------------------------------------------------------------ calls

/** Calls an AI route; on failure returns a message in the admin's language. The meter is refreshed either way. */
export async function aiCall<R>(path: string, body: unknown, t: T): Promise<{ ok: true; data: R } | { ok: false; message: string }> {
  const r = await adminFetch<R & { error?: string }>(`/ai/${path}`, { body });
  void refreshAiStatus();
  if (r.ok) return { ok: true, data: r.data };
  if (r.status === 401) window.dispatchEvent(new Event("admin-unauthorized"));
  return { ok: false, message: aiErrorText(r.data?.error, r.status, t) };
}

export function aiErrorText(code: string | undefined, status: number, t: T): string {
  switch (code) {
    case "ai_locked":
      return t("AI-помощник закрыт. Его открывает разработчик после оплаты.", "AI yordamchi qulflangan. Toʻlovdan keyin uni dasturchi ochib beradi.");
    case "ai_not_configured":
      return t("Ключ Gemini ещё не установлен на сервере. Обратитесь к разработчику.", "Gemini kaliti serverda hali oʻrnatilmagan. Dasturchiga murojaat qiling.");
    case "ai_bad_key":
      return t("Gemini не принял ключ. Обратитесь к разработчику.", "Gemini kalitni qabul qilmadi. Dasturchiga murojaat qiling.");
    case "ai_limit":
      return t("Лимит AI на этот месяц исчерпан. Он обновится с 1-го числа.", "Bu oylik AI limiti tugadi. Oyning 1-sanasida yangilanadi.");
    case "ai_busy":
      return t("Gemini сейчас перегружен (лимит Google). Попробуйте через минуту.", "Gemini hozir band (Google limiti). Bir daqiqadan keyin qayta urinib koʻring.");
    case "ai_timeout":
      return t("Gemini не ответил вовремя. Попробуйте ещё раз.", "Gemini oʻz vaqtida javob bermadi. Qayta urinib koʻring.");
    case "ai_failed":
      return t("Ответ AI получился непригодным. Попробуйте ещё раз.", "AI javobi yaroqsiz chiqdi. Qayta urinib koʻring.");
    case "rate_limited":
      return t("Слишком много запросов. Подождите 10 минут.", "Soʻrovlar juda koʻp. 10 daqiqa kuting.");
    case "validation":
      return t("Проверьте введённый текст.", "Kiritilgan matnni tekshiring.");
    default:
      return t(`Не удалось связаться с AI (ошибка ${status}).`, `AI bilan bogʻlanib boʻlmadi (xato ${status}).`);
  }
}

// ------------------------------------------------------------------------------------------------ pieces

/** The locked add-on: what it does and its one-time price. Shown on the AI page and when a locked AI button is pressed. */
export function AiLockCard({ s, compact = false }: { s: AiStatus; compact?: boolean }) {
  const t = useT();
  const contact = s.contact.trim();
  const features = [
    t("Описание товара на узбекском и русском", "Tovarga tavsif yozish (oʻzbekcha va ruscha)"),
    t("Перевод вашего текста на оба языка", "Siz yozgan matnni ikki tilga tarjima qilish"),
    t("Анализ продаж", "Savdoni tahlil qilish"),
    t("Советы по магазину", "Doʻkon boʻyicha maslahatlar"),
    t("Расход и лимит AI видны в админке", "AI sarfi va limiti admin panelda koʻrinib turadi"),
  ];
  return (
    <Card className={compact ? "" : "max-w-xl"}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink" aria-hidden>
          <Lock className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lead font-semibold">{t("AI-помощник закрыт", "AI yordamchi qulflangan")}</h2>
          <p className="mt-1">
            <span className="text-title font-bold tnum">{fmtMoney(s.priceUzs, t.lang)}</span>{" "}
            <span className="text-small text-ink-2">{t("· разовая оплата", "· bir martalik toʻlov")}</span>
          </p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-small">
        {features.map((f) => (
          <li key={f} className="flex gap-2"><Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-action" />{f}</li>
        ))}
      </ul>
      <p className="mt-3 text-small text-ink-2">
        {t("После оплаты помощник откроет разработчик.", "Toʻlovdan keyin yordamchini dasturchi ochib beradi.")}{" "}
        {contact ? (
          <>
            {t("Связь:", "Aloqa:")}{" "}
            {/^https?:\/\//.test(contact) ? <a className="font-semibold text-link hover:underline" href={contact} target="_blank" rel="noreferrer">{contact.replace(/^https?:\/\//, "")}</a> : <span className="font-semibold text-ink">{contact}</span>}
          </>
        ) : null}
      </p>
      {compact ? <Link href="/admin/ai" className={`${btn} mt-3`}>{t("Подробнее", "Batafsil")}</Link> : null}
    </Card>
  );
}

/** Tokens used this month against the limit, always in view on the AI page (a short form sits in the menu). */
export function AiUsageMeter({ s }: { s: AiStatus }) {
  const t = useT();
  const share = s.limit > 0 ? Math.min(1, s.used / s.limit) : 1;
  const tone = share >= 1 ? "bg-promo" : share >= 0.8 ? "bg-warn" : "bg-action";
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lead font-semibold">{t("Лимит AI в этом месяце", "Bu oylik AI limiti")}</h2>
        <p className="tnum text-small">
          <span className="font-bold">{fmtTokens(s.used)}</span> / {fmtTokens(s.limit)} {t("токенов", "token")}
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-sunken" role="meter" aria-valuemin={0} aria-valuemax={s.limit} aria-valuenow={s.used} aria-label={t("Расход токенов", "Token sarfi")}>
        <div className={`h-full ${tone}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="mt-2 text-caption text-ink-2">
        {t(
          `Осталось ${fmtTokens(s.remaining)} токенов · запросов в этом месяце: ${s.requests} · обновится ${fmtDay(s.resetsOn, "ru")}`,
          `Qoldi: ${fmtTokens(s.remaining)} token · bu oy soʻrovlar: ${s.requests} · ${fmtDay(s.resetsOn, "uz")} kuni yangilanadi`,
        )}
      </p>
    </Card>
  );
}

/**
 * The top-right button of the admin bar: an accent-coloured "AI yordamchi" that is seen on every page. A lock while the add-on
 * is closed (it opens the page with the price), the share of this month's tokens used once it is open.
 */
export function AiTopButton() {
  const t = useT();
  const s = useAiStatus();
  const pathname = usePathname();
  const open = !!s?.enabled;
  const pct = s && s.limit > 0 ? Math.min(100, Math.round((s.used / s.limit) * 100)) : null;
  const here = pathname.startsWith("/admin/ai");
  return (
    <Link
      href="/admin/ai"
      aria-current={here ? "page" : undefined}
      title={open ? t("Расход лимита AI в этом месяце", "Bu oylik AI limitidan sarflangani") : t("AI-помощник закрыт — нажмите, чтобы увидеть цену", "AI yordamchi qulflangan — narxini koʻrish uchun bosing")}
      className={`inline-flex h-10 items-center gap-2 rounded-control bg-action px-4 text-small font-bold text-white shadow-sm hover:bg-action-press ${here ? "ring-2 ring-action/40 ring-offset-2" : ""}`}
    >
      <Sparkles aria-hidden className="size-4" />
      <span>{t("AI-помощник", "AI yordamchi")}</span>
      {s && !open ? <Lock aria-label={t("закрыт", "qulflangan")} className="size-4" /> : null}
      {open && pct !== null ? <span className="tnum rounded-full bg-white/20 px-1.5 py-0.5 text-caption font-semibold">{pct}%</span> : null}
    </Link>
  );
}

/** An AI answer: plain text with "• " lines, shown as written. */
export function AiAnswer({ text }: { text: string }) {
  return <div className="mt-3 rounded-control border border-line bg-sunken/50 p-3 text-small whitespace-pre-wrap">{text}</div>;
}

// ------------------------------------------------------------------------------------------------ product form tools

interface Texts {
  name: string;
  nameRu: string;
  brand: string;
  description: string;
  descriptionRu: string;
}
type Patch = Partial<Pick<Texts, "name" | "nameRu" | "description" | "descriptionRu">>;

/**
 * "Write a description" and "Write in both languages" next to the description fields. They only fill the fields
 * (with one-step undo); the admin reads the text and saves as usual.
 */
export function AiProductTools({ form, apply }: { form: Texts; apply: (patch: Patch) => void }) {
  const t = useT();
  const s = useAiStatus();
  const [busy, setBusy] = useState<"describe" | "translate" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [undo, setUndo] = useState<Patch | null>(null);
  const [showLock, setShowLock] = useState(false);
  const locked = !s || !s.enabled;

  const run = async (kind: "describe" | "translate") => {
    setNote(null);
    if (locked) return setShowLock((v) => !v);
    if (kind === "describe") {
      if ((form.name || form.nameRu).trim().length < 2) return setNote({ tone: "bad", text: t("Сначала введите название товара.", "Avval tovar nomini yozing.") });
      if ((form.description || form.descriptionRu).trim() && !window.confirm(t("Описания будут заменены текстом AI (можно отменить). Продолжить?", "Tavsiflar AI matni bilan almashtiriladi (bekor qilsa boʻladi). Davom etilsinmi?"))) return;
      setBusy(kind);
      const notes = [form.description, form.descriptionRu].filter((x) => x.trim()).join("\n\n");
      const r = await aiCall<{ uz: string; ru: string }>("describe", { name: form.name, nameRu: form.nameRu, brand: form.brand, notes }, t);
      setBusy(null);
      if (!r.ok) return setNote({ tone: "bad", text: r.message });
      setUndo({ description: form.description, descriptionRu: form.descriptionRu });
      apply({ description: r.data.uz, descriptionRu: r.data.ru });
      return setNote({ tone: "ok", text: t("AI написал описание на двух языках. Проверьте и сохраните.", "AI ikki tilda tavsif yozdi. Tekshirib, keyin saqlang.") });
    }
    // The admin's own text is the source and is never rewritten (the Uzbek name also makes the link): only the other
    // language is written. Uzbek filled -> Russian is written; only Russian filled -> Uzbek is written.
    const nameTo: keyof Patch | null = form.name.trim() ? "nameRu" : form.nameRu.trim() ? "name" : null;
    const descriptionTo: keyof Patch | null = form.description.trim() ? "descriptionRu" : form.descriptionRu.trim() ? "description" : null;
    if (!nameTo && !descriptionTo) return setNote({ tone: "bad", text: t("Сначала введите название или описание (на любом языке).", "Avval nom yoki tavsif yozing (istalgan tilda).") });
    const targets = [nameTo, descriptionTo].filter((k): k is keyof Patch => !!k);
    if (targets.some((k) => form[k].trim()) && !window.confirm(t("Русские поля будут заменены переводом вашего узбекского текста (можно отменить). Продолжить?", "Ruscha maydonlar oʻzbekcha matningiz tarjimasi bilan almashtiriladi (bekor qilsa boʻladi). Davom etilsinmi?"))) return;
    setBusy(kind);
    const source = (to: keyof Patch | null, uz: string, ru: string) => (to === null ? "" : to.endsWith("Ru") ? uz : ru);
    const r = await aiCall<{ name: { uz: string; ru: string }; description: { uz: string; ru: string } }>(
      "translate",
      { name: source(nameTo, form.name, form.nameRu), description: source(descriptionTo, form.description, form.descriptionRu) },
      t,
    );
    setBusy(null);
    if (!r.ok) return setNote({ tone: "bad", text: r.message });
    const patch: Patch = {};
    if (nameTo) patch[nameTo] = nameTo === "nameRu" ? r.data.name.ru : r.data.name.uz;
    if (descriptionTo) patch[descriptionTo] = descriptionTo === "descriptionRu" ? r.data.description.ru : r.data.description.uz;
    setUndo(Object.fromEntries(targets.map((k) => [k, form[k]])) as Patch);
    apply(patch);
    setNote({ tone: "ok", text: t("Готово: текст на узбекском и русском. Проверьте и сохраните.", "Tayyor: matn oʻzbekcha va ruscha. Tekshirib, keyin saqlang.") });
  };

  const label = (icon: ReactNode, text: string) => (
    <>
      {locked ? <Lock aria-hidden className="size-4" /> : icon}
      <span>{text}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${btn} gap-1.5`} disabled={!!busy} onClick={() => void run("describe")}>
          {label(<Sparkles aria-hidden className="size-4 text-action" />, busy === "describe" ? t("AI пишет…", "AI yozmoqda…") : t("AI: написать описание", "AI: tavsif yozish"))}
        </button>
        <button type="button" className={`${btn} gap-1.5`} disabled={!!busy} onClick={() => void run("translate")}>
          {label(<Languages aria-hidden className="size-4 text-action" />, busy === "translate" ? t("AI переводит…", "AI tarjima qilmoqda…") : t("AI: на два языка", "AI: ikki tilga yozish"))}
        </button>
        {undo ? (
          <button type="button" className="text-small text-link hover:underline" onClick={() => { apply(undo); setUndo(null); setNote(null); }}>
            {t("Отменить", "Bekor qilish")}
          </button>
        ) : null}
        {s?.enabled ? (
          <span className="ml-auto text-caption text-ink-2 tnum">
            {t("Лимит AI:", "AI limiti:")} {fmtTokens(s.used)} / {fmtTokens(s.limit)}
          </span>
        ) : null}
      </div>
      <p className="text-caption text-ink-2">
        {t(
          "«Написать описание» — по названию, бренду и вашим заметкам в полях описания. «На два языка» — переводит ваш текст на другой язык (узбекский → русский, или русский → узбекский, если узбекское поле пустое); ваш текст не меняется. AI только заполняет поля, сохраняете вы.",
          "«Tavsif yozish» — nomi, brendi va tavsif maydonidagi qaydlaringiz asosida. «Ikki tilga yozish» — yozgan matningizni ikkinchi tilga oʻgiradi (oʻzbekchadan ruschaga, oʻzbekcha maydon boʻsh boʻlsa ruschadan oʻzbekchaga); oʻzingiz yozgan matn oʻzgarmaydi. AI faqat maydonlarni toʻldiradi, saqlashni oʻzingiz bosasiz.",
        )}
      </p>
      {note ? <p role="status" className={`text-small ${note.tone === "ok" ? "text-ok" : "text-promo"}`}>{note.text}</p> : null}
      {showLock && s && !s.enabled ? <AiLockCard s={s} compact /> : null}
    </div>
  );
}
