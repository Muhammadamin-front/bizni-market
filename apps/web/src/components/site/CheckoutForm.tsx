"use client";

import { formatPhone, formatPrice, normalizePhone } from "@shop/shared";
import { Button, EmptyState, TextField } from "@shop/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearCart, useCart, useCartProducts } from "@/lib/cart";
import { usePublicConfig } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { haptic, useMainButton, useTma } from "@/lib/tma";
import { lineTotal, resolveLines } from "./CartView";

interface Turnstile {
  render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }): string;
  reset(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** One idempotency key per distinct order attempt: retries (flaky network, double tap) reuse it, so they can never create a second order. */
function idempotencyKey(signature: string): string {
  try {
    const stored = JSON.parse(sessionStorage.getItem("shop.idem") ?? "null") as { sig: string; key: string } | null;
    if (stored?.sig === signature) return stored.key;
    const key = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
    sessionStorage.setItem("shop.idem", JSON.stringify({ sig: signature, key }));
    return key;
  } catch {
    return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  }
}

type Problems = { productId: string; reason: string }[];

/** `orderPrefix` is the path before the order id ("/uz/order" on the site, "/tma/order" in the Mini App); a string, because server components cannot pass functions. */
export function CheckoutForm({ token, orderPrefix, cartHref, prefill }: { token?: string | null; orderPrefix: string; cartHref: string; prefill?: { name?: string; phone?: string | null } }) {
  const { locale, messages, href } = useI18n();
  const router = useRouter();
  const m = messages.checkout;
  const config = usePublicConfig();
  const { lines } = useCart();
  const { products, loading } = useCartProducts(lines);
  const rows = resolveLines(lines, products, !loading);
  const sellable = rows.filter((r) => r.product && !r.unavailable);
  const total = sellable.reduce((s, r) => s + lineTotal(r.product!, r.line.quantity), 0);

  const [name, setName] = useState(prefill?.name ?? "");
  const [phone, setPhone] = useState(prefill?.phone ? formatPhone(prefill.phone) : "");
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [problems, setProblems] = useState<Problems>([]);
  const [busy, setBusy] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const tma = useTma();
  const siteKey = !token ? config?.turnstileSiteKey : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    if (prefill?.name && !name) setName(prefill.name);
    if (prefill?.phone && !phone) setPhone(formatPhone(prefill.phone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.name, prefill?.phone]);

  useEffect(() => {
    if (!siteKey || !widget.current) return;
    const mount = () => window.turnstile && widget.current && widget.current.childElementCount === 0 && window.turnstile.render(widget.current, { sitekey: siteKey, callback: setTurnstile, "expired-callback": () => setTurnstile("") });
    if (window.turnstile) {
      mount();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = mount;
    document.head.appendChild(s);
  }, [siteKey]);

  const below = config && total < config.minimumOrderAmount;
  const signature = useMemo(() => JSON.stringify([lines, normalizePhone(phone)]), [lines, phone]);

  const native = useMainButton(tma.inTelegram && lines.length > 0 ? { text: `${m.submit} · ${formatPrice(total, locale)}`, onClick: () => formRef.current?.requestSubmit(), disabled: loading || sellable.length === 0, busy } : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = m.errors.name;
    const normalized = normalizePhone(phone);
    if (!normalized) next.phone = m.errors.phone;
    if (method === "delivery" && address.trim().length < 5) next.address = m.errors.address;
    setErrors(next);
    setFormError("");
    setProblems([]);
    if (Object.keys(next).length) return;
    if (below) return setFormError(m.errors.minimum(formatPrice(config!.minimumOrderAmount, locale)));

    setBusy(true);
    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey(signature), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          items: sellable.map((r) => ({ productId: r.line.productId, quantity: r.line.quantity })),
          name: name.trim(),
          phone,
          deliveryMethod: method,
          address: method === "delivery" ? address.trim() : "",
          comment: comment.trim(),
          language: locale,
          turnstileToken: turnstile || undefined,
          website: honeypot || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { publicId?: string; error?: string; details?: Problems | { minimum: number }; issues?: { path: string }[] };
      if (res.ok && body.publicId) {
        try {
          sessionStorage.removeItem("shop.idem");
        } catch {
          /* ignore */
        }
        haptic("success");
        clearCart();
        router.replace(`${orderPrefix}/${body.publicId}`);
        return;
      }
      if (res.status === 409 && Array.isArray(body.details)) {
        setProblems(body.details);
        setFormError(m.errors.lines);
      } else if (res.status === 429) setFormError(m.errors.rate);
      else if (body.error === "challenge_failed") {
        setFormError(m.errors.challenge);
        window.turnstile?.reset();
        setTurnstile("");
      } else if (body.error === "below_minimum" && body.details && "minimum" in body.details) setFormError(m.errors.minimum(formatPrice(body.details.minimum, locale)));
      else if (res.status === 400 && body.issues) {
        const fieldErrors: Record<string, string> = {};
        for (const i of body.issues) {
          if (i.path === "phone") fieldErrors.phone = m.errors.phone;
          if (i.path === "address") fieldErrors.address = m.errors.address;
          if (i.path === "name") fieldErrors.name = m.errors.name;
        }
        setErrors(fieldErrors);
        if (!Object.keys(fieldErrors).length) setFormError(m.errors.generic);
      } else setFormError(m.errors.generic);
    } catch {
      haptic("error");
      setFormError(m.errors.network);
    } finally {
      setBusy(false);
    }
  }

  if (lines.length === 0) {
    return <EmptyState title={messages.cart.empty} body={messages.cart.emptyBody} action={<Link href={href("/catalog")} className="inline-flex h-11 items-center rounded-control bg-action px-5 font-semibold text-white">{messages.cart.goCatalog}</Link>} />;
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
          <legend className="px-1 text-lead font-semibold">{m.contact}</legend>
          <TextField label={m.name} value={name} onChange={setName} error={errors.name} autoComplete="name" required />
          <TextField label={m.phone} value={phone} onChange={setPhone} error={errors.phone} inputMode="tel" autoComplete="tel" placeholder={m.phoneHelp} required />
        </fieldset>

        <fieldset className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
          <legend className="px-1 text-lead font-semibold">{m.deliveryMethod}</legend>
          <div role="radiogroup" aria-label={m.deliveryMethod} className="grid grid-cols-2 gap-2">
            {(["delivery", "pickup"] as const).map((v) => (
              <label key={v} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-control border px-3 text-center font-medium ${method === v ? "border-ink bg-ink text-on-ink" : "border-line bg-card hover:border-line-strong"}`}>
                <input type="radio" name="method" value={v} checked={method === v} onChange={() => setMethod(v)} className="sr-only" />
                {v === "delivery" ? m.delivery : m.pickup}
              </label>
            ))}
          </div>
          {method === "delivery" ? <TextField label={m.address} value={address} onChange={setAddress} error={errors.address} autoComplete="street-address" placeholder={m.addressHelp} required /> : null}
          <label className="flex flex-col gap-1 text-small font-medium">
            {m.comment}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3} className="rounded-control border border-line bg-card p-3 text-body font-normal hover:border-line-strong focus:border-action focus:outline-none" />
          </label>
        </fieldset>

        {/* Honeypot: invisible to people, irresistible to form-filling bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Website <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
        </div>
        {siteKey ? <div ref={widget} className="min-h-16" /> : null}
      </div>

      <aside className="h-fit rounded-card border border-line bg-card p-5 lg:sticky lg:top-28">
        <h2 className="text-lead font-semibold">{m.summary}</h2>
        <ul className="mt-3 divide-y divide-line text-small">
          {sellable.map(({ line, product }) => (
            <li key={line.productId} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{product!.name} <span className="tnum text-ink-2">× {String(line.quantity).replace(".", ",")}</span></span>
              <span className="tnum shrink-0">{formatPrice(lineTotal(product!, line.quantity), locale)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-line pt-3 text-lead font-bold"><span>{messages.cart.total}</span><span className="tnum">{formatPrice(total, locale)}</span></p>
        <p className="mt-2 text-small text-ink-2">{m.payNote}</p>
        {below ? <p className="mt-2 text-small text-warn">{messages.cart.minimum(formatPrice(config!.minimumOrderAmount, locale))}</p> : null}
        {formError ? (
          <p role="alert" className="mt-3 rounded-control bg-promo-bg px-3 py-2 text-small text-promo">
            {formError} {problems.length ? <Link href={cartHref} className="font-semibold underline">{m.fixLines}</Link> : null}
          </p>
        ) : null}
        {native ? null : (
          <Button type="submit" fullWidth loading={busy} disabled={loading || sellable.length === 0 || busy} className="mt-4">
            {busy ? m.submitting : m.submit}
          </Button>
        )}
      </aside>
    </form>
  );
}
