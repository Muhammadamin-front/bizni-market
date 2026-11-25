"use client";

import { Lightbulb, LineChart, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AiAnswer, AiLockCard, AiUsageMeter, aiCall, useAiStatus } from "@/components/admin/ai";
import { useT } from "@/components/admin/i18n";
import { Card, Notice, btn, btnPrimary } from "@/components/admin/ui";

const PERIODS = [7, 30, 90] as const;

export default function AiPage() {
  const t = useT();
  const s = useAiStatus();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-bold">{t("AI-помощник", "AI yordamchi")}</h1>
      {!s ? (
        <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p>
      ) : !s.enabled ? (
        <AiLockCard s={s} />
      ) : (
        <>
          {!s.configured ? (
            <Notice tone="warn">{t("Помощник открыт, но ключ Gemini ещё не установлен на сервере. Обратитесь к разработчику.", "Yordamchi ochilgan, lekin Gemini kaliti serverda hali oʻrnatilmagan. Dasturchiga murojaat qiling.")}</Notice>
          ) : null}
          <AiUsageMeter s={s} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Analysis />
            <Advice />
          </div>
          <Card>
            <h2 className="flex items-center gap-2 text-lead font-semibold"><Sparkles aria-hidden className="size-5 text-action" />{t("Описание и перевод товара", "Tovar tavsifi va tarjimasi")}</h2>
            <p className="mt-1 text-small text-ink-2">
              {t(
                "На странице товара, под полями описания, есть кнопки «AI: написать описание» и «AI: на два языка». AI только заполняет поля: прочитайте текст и сохраните товар как обычно.",
                "Tovar sahifasida, tavsif maydonlari ostida «AI: tavsif yozish» va «AI: ikki tilga yozish» tugmalari bor. AI faqat maydonlarni toʻldiradi: matnni oʻqib chiqing va tovarni odatdagidek saqlang.",
              )}
            </p>
            <Link href="/admin/products/new" className={`${btn} mt-3`}>{t("+ Добавить товар", "+ Tovar qoʻshish")}</Link>
          </Card>
          <p className="text-caption text-ink-2">
            {t(
              "В Gemini (Google) отправляются только тексты товаров и общие цифры продаж. Имена, телефоны и адреса покупателей не отправляются.",
              "Gemini'ga (Google) faqat tovar matnlari va umumiy savdo raqamlari yuboriladi. Xaridorlarning ismi, telefoni va manzili yuborilmaydi.",
            )}
          </p>
        </>
      )}
    </div>
  );
}

function Analysis() {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    const r = await aiCall<{ text: string }>("analyze", { days, lang: t.lang }, t);
    setBusy(false);
    if (r.ok) setText(r.data.text);
    else setError(r.message);
  };

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lead font-semibold"><LineChart aria-hidden className="size-5 text-action" />{t("Анализ продаж", "Savdo tahlili")}</h2>
      <p className="mt-1 text-small text-ink-2">{t("AI изучит продажи, остатки и каталог за выбранный период и предложит, что делать.", "AI tanlangan davrdagi savdo, qoldiq va katalogni koʻrib chiqib, nima qilish kerakligini aytadi.")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label={t("Период", "Davr")}>
          {PERIODS.map((p) => (
            <button key={p} type="button" className={`${btn} ${days === p ? "border-ink bg-ink text-on-ink hover:bg-ink" : ""}`} aria-pressed={days === p} onClick={() => setDays(p)}>
              {t(`${p} дн.`, `${p} kun`)}
            </button>
          ))}
        </div>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run()}>
          {busy ? t("AI анализирует…", "AI tahlil qilmoqda…") : t("Анализировать", "Tahlil qilish")}
        </button>
      </div>
      {error ? <p role="status" className="mt-3 text-small text-promo">{error}</p> : null}
      {text ? <AiAnswer text={text} /> : null}
    </Card>
  );
}

function Advice() {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const ideas = [
    t("Как увеличить продажи в этом месяце?", "Bu oy savdoni qanday oshiraman?"),
    t("Какие товары продвигать в первую очередь?", "Qaysi tovarlarni birinchi navbatda reklama qilay?"),
    t("Как получать больше заказов через Telegram?", "Telegram orqali koʻproq buyurtma olish uchun nima qilay?"),
  ];

  const run = async () => {
    if (question.trim().length < 3) return setError(t("Напишите вопрос.", "Savolingizni yozing."));
    setBusy(true);
    setError("");
    const r = await aiCall<{ text: string }>("advice", { question, lang: t.lang }, t);
    setBusy(false);
    if (r.ok) setText(r.data.text);
    else setError(r.message);
  };

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lead font-semibold"><Lightbulb aria-hidden className="size-5 text-action" />{t("Совет", "Maslahat")}</h2>
      <p className="mt-1 text-small text-ink-2">{t("Задайте вопрос о магазине: AI ответит с учётом ваших продаж за 30 дней.", "Doʻkon haqida savol bering: AI soʻnggi 30 kunlik savdongizni hisobga olib javob beradi.")}</p>
      <label className="mt-3 flex flex-col gap-1 text-small">
        <span className="font-medium">{t("Вопрос", "Savol")}</span>
        <textarea className="min-h-24 rounded-control border border-line bg-card p-2.5 text-small hover:border-line-strong focus:border-action focus:outline-none" value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ideas.map((q) => (
          <button key={q} type="button" className="rounded-full border border-line px-2.5 py-1 text-caption text-ink-2 hover:border-line-strong hover:text-ink" onClick={() => setQuestion(q)}>{q}</button>
        ))}
      </div>
      <button type="button" className={`${btnPrimary} mt-3`} disabled={busy} onClick={() => void run()}>
        {busy ? t("AI думает…", "AI oʻylamoqda…") : t("Получить совет", "Maslahat olish")}
      </button>
      {error ? <p role="status" className="mt-3 text-small text-promo">{error}</p> : null}
      {text ? <AiAnswer text={text} /> : null}
    </Card>
  );
}
