"use client";

import { useState } from "react";
import { adminFetch, fmtDate, useAdminData } from "@/components/admin/api";
import { useT, type L } from "@/components/admin/i18n";
import { Badge, Card, Field, Notice, Table, btn, btnPrimary, input } from "@/components/admin/ui";

export default function SystemPage() {
  const t = useT();
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-title font-bold">{t("Система", "Tizim")}</h1>
      <Telegram />
      <Security />
      <Featured />
      <Lists />
    </div>
  );
}

function Telegram() {
  const t = useT();
  const { data, reload } = useAdminData<{ enabled: boolean; publicUrl: string; https: boolean; me?: { username: string } | null; webhook?: { url: string; pending_update_count: number; last_error_message?: string } | null; error?: string | null }>("/telegram");
  const [report, setReport] = useState<{ ok: boolean; steps: { step: string; ok: boolean; detail?: string }[] } | null>(null);
  return (
    <Card title={t("Telegram-бот", "Telegram bot")}>
      {!data ? <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p> : !data.enabled ? (
        <Notice>
          {t("Токен бота не задан в настройках сервера. Получите токен у @BotFather, задайте домен и username бота, затем нажмите «Настроить» здесь или выполните", "Server sozlamalarida bot tokeni berilmagan. @BotFather'dan token oling, domen va bot username'ini kiriting, keyin shu yerda «Sozlash»ni bosing yoki buyruqni bajaring:")} <code>pnpm telegram:setup</code>.
        </Notice>
      ) : (
        <div className="flex flex-col gap-2 text-small">
          <p>{t("Бот", "Bot")}: {data.me ? `@${data.me.username}` : data.error}</p>
          <p>{t("Адрес сайта", "Sayt manzili")}: <span className="font-mono">{data.publicUrl}</span> {data.https ? <Badge tone="ok">https</Badge> : <Badge tone="bad">{t("нужен https", "https kerak")}</Badge>}</p>
          <p>{t("Вебхук", "Vebxuk")}: <span className="font-mono">{data.webhook?.url || t("не задан", "berilmagan")}</span>{data.webhook?.last_error_message ? <span className="text-promo"> — {data.webhook.last_error_message}</span> : null}</p>
          <button className={`${btnPrimary} self-start`} onClick={async () => { const r = await adminFetch<{ ok: boolean; steps: { step: string; ok: boolean; detail?: string }[] }>("/telegram/setup", { body: {} }); setReport(r.data); reload(); }}>{t("Настроить бота (вебхук, меню, команды)", "Botni sozlash (vebxuk, menyu, buyruqlar)")}</button>
          {report ? <ul className="mt-1">{report.steps.map((s) => <li key={s.step}>{s.ok ? "✓" : "✗"} {s.step}{s.detail ? ` — ${s.detail}` : ""}</li>)}</ul> : null}
        </div>
      )}
    </Card>
  );
}

function Security() {
  const t = useT();
  const { data: me, reload } = useAdminData<{ email: string; totpEnabled: boolean }>("/me");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  return (
    <Card title={t("Безопасность", "Xavfsizlik")}>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <form
        className="mt-2 grid gap-2 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await adminFetch<{ message?: string }>("/password", { body: { current: cur, next } });
          setMsg(r.ok ? { tone: "ok", text: t("Пароль изменён.", "Parol oʻzgartirildi.") } : { tone: "bad", text: r.data.message ?? t("Неверный текущий пароль.", "Joriy parol notoʻgʻri.") });
          if (r.ok) { setCur(""); setNext(""); }
        }}
      >
        <Field label={t("Текущий пароль", "Joriy parol")}><input className={input} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
        <Field label={t("Новый пароль (от 12 знаков)", "Yangi parol (kamida 12 belgi)")}><input className={input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
        <div className="self-end"><button className={btn} type="submit">{t("Сменить пароль", "Parolni almashtirish")}</button></div>
      </form>
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-small font-semibold">{t("Двухфакторная защита (TOTP)", "Ikki bosqichli himoya (TOTP)")} {me?.totpEnabled ? <Badge tone="ok">{t("включена", "yoqilgan")}</Badge> : <Badge>{t("выключена", "oʻchiq")}</Badge>}</p>
        {!me?.totpEnabled && !totp ? <button className={`${btn} mt-2`} onClick={async () => { const r = await adminFetch<{ secret: string; uri: string }>("/totp/setup", { body: {} }); setTotp(r.data); }}>{t("Включить", "Yoqish")}</button> : null}
        {totp ? (
          <div className="mt-2 flex flex-col gap-2 text-small">
            <p>{t("Добавьте в приложение-аутентификатор ключ:", "Autentifikator ilovasiga shu kalitni qoʻshing:")} <code className="select-all rounded bg-sunken px-1 font-mono">{totp.secret}</code></p>
            <div className="flex gap-2"><input className={`${input} max-w-40`} inputMode="numeric" placeholder={t("Код из приложения", "Ilovadagi kod")} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              <button className={btnPrimary} onClick={async () => { const r = await adminFetch("/totp/enable", { body: { code } }); setMsg(r.ok ? { tone: "ok", text: t("TOTP включён.", "TOTP yoqildi.") } : { tone: "bad", text: t("Неверный код.", "Kod notoʻgʻri.") }); if (r.ok) { setTotp(null); reload(); } }}>{t("Подтвердить", "Tasdiqlash")}</button></div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const SLOTS: [string, L][] = [
  ["featured", { ru: "Выбор магазина", uz: "Doʻkon tanlovi" }],
  ["offers", { ru: "Акции", uz: "Aksiyalar" }],
  ["new", { ru: "Новинки", uz: "Yangiliklar" }],
  ["bestseller", { ru: "Хиты продаж", uz: "Xitlar" }],
];

interface Card { id: string; name: string; price: number }
function Featured() {
  const t = useT();
  const [slot, setSlot] = useState("featured");
  const { data, reload } = useAdminData<Card[]>(`/featured/${slot}`, [slot]);
  const [q, setQ] = useState("");
  const { data: found } = useAdminData<{ rows: { id: string; name: string }[] }>(q.length >= 2 ? `/products?q=${encodeURIComponent(q)}&pageSize=8` : null, [q]);
  const save = async (ids: string[]) => { await adminFetch(`/featured/${slot}`, { method: "PUT", body: { productIds: ids } }); reload(); };
  return (
    <Card title={t("Подборки на главной", "Bosh sahifadagi toʻplamlar")}>
      <p className="mb-2 text-small text-ink-2">
        {t(
          "Если подборка пуста, «Акции», «Новинки» и «Хиты» строятся автоматически из реальных данных; «Выбор магазина» без ручного выбора не показывается.",
          "Toʻplam boʻsh boʻlsa, «Aksiyalar», «Yangiliklar» va «Xitlar» haqiqiy maʼlumotlardan avtomatik tuziladi; «Doʻkon tanlovi» qoʻlda tanlanmasa koʻrsatilmaydi.",
        )}
      </p>
      <select className={`${input} max-w-56`} value={slot} onChange={(e) => setSlot(e.target.value)} aria-label={t("Подборка", "Toʻplam")}>
        {SLOTS.map(([v, l]) => <option key={v} value={v}>{l[t.lang]}</option>)}
      </select>
      <ul className="mt-3 divide-y divide-line text-small">
        {data?.map((p, i) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
            <span>{i + 1}. {p.name}</span>
            <span className="flex gap-1">
              <button className={btn} disabled={i === 0} onClick={() => { const ids = data.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!]; void save(ids); }} aria-label={t("Выше", "Yuqoriga")}>↑</button>
              <button className={btn} onClick={() => void save(data.filter((x) => x.id !== p.id).map((x) => x.id))}>{t("Убрать", "Olib tashlash")}</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3"><input className={`${input} max-w-sm`} placeholder={t("Найти товар, чтобы добавить", "Qoʻshish uchun tovar qidiring")} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="mt-1 text-small">{found?.rows.map((r) => <li key={r.id}><button className="py-1 text-left text-link hover:underline" onClick={() => { void save([...(data?.map((x) => x.id) ?? []), r.id]); setQ(""); }}>+ {r.name}</button></li>)}</ul></div>
    </Card>
  );
}

const TABS: ["customers" | "notifications" | "audit", L][] = [
  ["customers", { ru: "Клиенты Telegram", uz: "Telegram mijozlari" }],
  ["notifications", { ru: "Уведомления", uz: "Bildirishnomalar" }],
  ["audit", { ru: "Действия админов", uz: "Adminlar harakatlari" }],
];

function Lists() {
  const t = useT();
  const [tab, setTab] = useState<"customers" | "notifications" | "audit">("customers");
  const customers = useAdminData<{ rows: { id: string; name: string; phone: string | null; telegramId: number | null; username: string | null; createdAt: string }[] }>(tab === "customers" ? "/customers" : null, [tab]);
  const notifications = useAdminData<{ id: number; kind: string; chatId: number | null; text: string; status: string; error: string | null; createdAt: string }[]>(tab === "notifications" ? "/notifications" : null, [tab]);
  const audit = useAdminData<{ id: number; action: string; entity: string; entity_id: string | null; created_at: string; email: string | null }[]>(tab === "audit" ? "/audit" : null, [tab]);
  return (
    <Card title={t("Журналы", "Jurnallar")}>
      <div className="mb-3 flex flex-wrap gap-2">{TABS.map(([k, l]) => <button key={k} className={tab === k ? btnPrimary : btn} onClick={() => setTab(k)}>{l[t.lang]}</button>)}</div>
      {tab === "customers" ? <Table head={[t("Имя", "Ism"), t("Телефон", "Telefon"), "Telegram", t("Дата", "Sana")]}>{customers.data?.rows.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.phone ?? "—"}</td><td>{c.username ? `@${c.username}` : c.telegramId}</td><td>{fmtDate(c.createdAt)}</td></tr>)}</Table> : null}
      {tab === "notifications" ? <Table head={[t("Дата", "Sana"), t("Тип", "Turi"), t("Чат", "Chat"), t("Текст", "Matn"), t("Статус", "Holat")]}>{notifications.data?.map((n) => <tr key={n.id}><td className="whitespace-nowrap">{fmtDate(n.createdAt)}</td><td>{n.kind}</td><td className="font-mono">{n.chatId}</td><td className="max-w-xs">{n.text}</td><td><Badge tone={n.status === "sent" ? "ok" : n.status === "failed" ? "bad" : "neutral"}>{n.status}</Badge>{n.error ? <p className="text-caption text-ink-2">{n.error}</p> : null}</td></tr>)}</Table> : null}
      {tab === "audit" ? <Table head={[t("Дата", "Sana"), t("Админ", "Admin"), t("Действие", "Harakat"), t("Объект", "Obyekt")]}>{audit.data?.map((a) => <tr key={a.id}><td className="whitespace-nowrap">{fmtDate(a.created_at)}</td><td>{a.email ?? "—"}</td><td>{a.action}</td><td className="font-mono text-caption">{a.entity} {a.entity_id ?? ""}</td></tr>)}</Table> : null}
    </Card>
  );
}
