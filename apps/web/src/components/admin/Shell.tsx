"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { adminFetch } from "./api";
import { LangSwitch, useT, type L } from "./i18n";
import { btnPrimary, Field, input, Notice } from "./ui";

const NAV: { href: string; label: L; moysklad?: boolean }[] = [
  { href: "/admin", label: { ru: "Обзор", uz: "Umumiy holat" } },
  { href: "/admin/orders", label: { ru: "Заказы", uz: "Buyurtmalar" } },
  { href: "/admin/products", label: { ru: "Товары", uz: "Tovarlar" } },
  { href: "/admin/categories", label: { ru: "Категории", uz: "Kategoriyalar" } },
  { href: "/admin/content", label: { ru: "Контент", uz: "Sayt matnlari" } },
  { href: "/admin/settings", label: { ru: "Настройки", uz: "Sozlamalar" } },
  { href: "/admin/sync", label: { ru: "Синхронизация", uz: "Sinxronizatsiya" }, moysklad: true },
  { href: "/admin/system", label: { ru: "Система", uz: "Tizim" } },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useT();
  const [me, setMe] = useState<{ email: string; connected?: boolean } | null | undefined>(undefined);
  const pathname = usePathname();

  const check = useCallback(async () => {
    const r = await adminFetch<{ email: string; connected?: boolean }>("/me");
    setMe(r.ok ? r.data : null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    void check();
    const onUnauthorized = () => setMe(null);
    window.addEventListener("admin-unauthorized", onUnauthorized);
    return () => window.removeEventListener("admin-unauthorized", onUnauthorized);
  }, [check]);

  if (me === undefined) return <p className="p-8 text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p>;
  if (me === null) return <Login onDone={check} />;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_1fr]">
      <aside className="border-b border-line bg-card lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block">
          <div className="min-w-0">
            <p className="text-lead font-bold">
              Bizni Market{" "}
              <span className="whitespace-nowrap font-medium text-ink-2 lg:block">
                <span className="lg:hidden">· </span>
                {t("админ", "admin")}
              </span>
            </p>
            <p className="hidden truncate text-caption text-ink-2 lg:block">{me.email}</p>
          </div>
          <LangSwitch className="lg:mt-2" />
        </div>
        <nav aria-label={t("Разделы", "Boʻlimlar")} className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:px-3">
          {NAV.filter((n) => !n.moysklad || me.connected).map((n) => {
            const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`shrink-0 rounded-control px-3 py-2 text-small font-medium ${active ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}>
                {n.label[t.lang]}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={async () => {
              await adminFetch("/logout", { method: "POST", body: {} });
              setMe(null);
            }}
            className="shrink-0 rounded-control px-3 py-2 text-left text-small font-medium text-ink-2 hover:bg-sunken hover:text-ink lg:mt-4"
          >
            {t("Выйти", "Chiqish")}
          </button>
        </nav>
      </aside>
      <main className="min-w-0 p-4 lg:p-6">{children}</main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<"totp" | "locked" | "rate_limited" | "bad" | "">("");
  const [busy, setBusy] = useState(false);

  const errorText = {
    totp: t("Введите код из приложения-аутентификатора.", "Autentifikator ilovasidagi kodni kiriting."),
    locked: t("Аккаунт временно заблокирован. Повторите через 15 минут.", "Akkaunt vaqtincha bloklandi. 15 daqiqadan keyin qayta urinib koʻring."),
    rate_limited: t("Слишком много попыток. Повторите позже.", "Urinishlar juda koʻp. Birozdan keyin qayta urinib koʻring."),
    bad: t("Неверная почта или пароль.", "Email yoki parol notoʻgʻri."),
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <LangSwitch className="self-end" />
      <div>
        <p className="text-small font-semibold text-ink-2">Bizni Market</p>
        <h1 className="text-title font-bold">{t("Вход в админку", "Admin panelga kirish")}</h1>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const r = await adminFetch<{ error?: string }>("/login", { body: { email, password, totp: totp || undefined } });
          setBusy(false);
          if (r.ok) return onDone();
          if (r.data.error === "totp_required") {
            setNeedTotp(true);
            return setError("totp");
          }
          setError(r.data.error === "locked" ? "locked" : r.data.error === "rate_limited" ? "rate_limited" : "bad");
        }}
      >
        <Field label={t("Почта", "Email")}>
          <input className={input} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("Пароль", "Parol")}>
          <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {needTotp ? (
          <Field label={t("Код (6 цифр)", "Kod (6 ta raqam)")}>
            <input className={input} inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Field>
        ) : null}
        {error ? <Notice tone="bad">{errorText[error]}</Notice> : null}
        <button type="submit" disabled={busy} className={`${btnPrimary} h-11`}>
          {busy ? t("Вход…", "Kirilmoqda…") : t("Войти", "Kirish")}
        </button>
      </form>
    </div>
  );
}
