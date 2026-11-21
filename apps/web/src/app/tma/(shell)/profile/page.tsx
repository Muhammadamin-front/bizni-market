"use client";

import { formatPhone, normalizePhone } from "@shop/shared";
import { Button, LanguageSwitch, TextField } from "@shop/ui";
import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { useTma } from "@/lib/tma";

export default function TmaProfile() {
  const { locale, messages: m, href } = useI18n();
  const { me, token, setMe, setLocale } = useTma();
  const toast = useToast();
  const [name, setName] = useState(me?.name ?? "");
  const [phone, setPhone] = useState(me?.phone ? formatPhone(me.phone) : "");
  const [error, setError] = useState("");

  const save = async () => {
    const normalized = phone ? normalizePhone(phone) : null;
    if (phone && !normalized) return setError(m.checkout.errors.phone);
    setError("");
    const res = await fetch("/api/v1/me", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: name.trim() || undefined, phone: normalized ?? undefined }) });
    if (res.ok) {
      setMe(await res.json());
      toast.show(m.profile.saved);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lead font-bold">{m.profile.title}</h1>
      <div className="flex items-center justify-between"><span className="text-small font-medium">{m.profile.language}</span>
        <LanguageSwitch value={locale} onChange={setLocale} label={m.language.label} options={[{ locale: "uz", label: m.language.uz }, { locale: "ru", label: m.language.ru }]} /></div>
      <TextField label={m.profile.name} value={name} onChange={setName} autoComplete="name" />
      <TextField label={m.profile.phone} value={phone} onChange={setPhone} error={error} inputMode="tel" autoComplete="tel" placeholder={m.checkout.phoneHelp} />
      <Button onClick={save}>{m.profile.save}</Button>
      <Link href={href("/orders")} className="inline-flex h-11 items-center justify-center rounded-control border border-line-strong bg-card font-semibold">{m.profile.orders}</Link>
    </div>
  );
}
