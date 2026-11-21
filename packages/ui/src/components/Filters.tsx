"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../cn";

/** A titled group of related filter controls. */
export function FilterGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0 border-0 p-0", className)}>
      <legend className="mb-1 text-small font-semibold text-ink">{title}</legend>
      <div className="flex flex-col">{children}</div>
    </fieldset>
  );
}

export interface CheckboxRowProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "size"> {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Right-aligned count, e.g. products in this brand. */
  count?: number;
}

export function CheckboxRow({ label, checked, onChange, count, className, ...rest }: CheckboxRowProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 py-1 text-body text-ink", className)}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-5 shrink-0 rounded-[4px]" {...rest} />
      <span className="flex-1">{label}</span>
      {count !== undefined ? <span className="tnum text-small text-ink-2">{count}</span> : null}
    </label>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Error text; also sets aria-invalid and links the message to the input. */
  error?: string;
}

export function TextField({ label, value, onChange, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-small font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "tnum h-11 w-full rounded-control border bg-card px-3 text-body text-ink transition-colors duration-150 focus:border-action focus:outline-none",
          error ? "border-promo" : "border-line hover:border-line-strong",
        )}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-small text-promo">
          {error}
        </p>
      ) : null}
    </div>
  );
}
