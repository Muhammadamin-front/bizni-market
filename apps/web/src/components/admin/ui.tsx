"use client";

import type { ReactNode } from "react";

export function Card({ title, children, actions, className = "" }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-card p-4 ${className}`}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-lead font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "bad" | "ok" }) {
  const color = tone === "bad" ? "text-promo" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="rounded-control border border-line bg-card p-3">
      <p className="text-caption text-ink-2">{label}</p>
      <p className={`tnum text-lead font-bold ${color}`}>{value}</p>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "bad" | "warn" }) {
  const cls = tone === "ok" ? "bg-[#e3f3ea] text-ok" : tone === "bad" ? "bg-[#fdecea] text-promo" : tone === "warn" ? "bg-[#fdf0e3] text-warn" : "bg-sunken text-ink-2";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold ${cls}`}>{children}</span>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-small">
        <thead>
          <tr className="border-b border-line text-caption text-ink-2">
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-2 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export const btn = "inline-flex h-9 items-center justify-center rounded-control border border-line-strong bg-card px-3 text-small font-semibold hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = "inline-flex h-9 items-center justify-center rounded-control bg-action px-3 text-small font-semibold text-white hover:bg-action-press disabled:cursor-not-allowed disabled:opacity-50";
export const input = "h-9 w-full rounded-control border border-line bg-card px-2.5 text-small hover:border-line-strong focus:border-action focus:outline-none";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-small">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-caption text-ink-2">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok"; children: ReactNode }) {
  const cls = tone === "bad" ? "border-promo/30 bg-[#fdecea] text-promo" : tone === "ok" ? "border-ok/30 bg-[#e3f3ea] text-ok" : "border-warn/30 bg-[#fdf0e3] text-warn";
  return <p role="status" className={`rounded-control border px-3 py-2 text-small ${cls}`}>{children}</p>;
}
