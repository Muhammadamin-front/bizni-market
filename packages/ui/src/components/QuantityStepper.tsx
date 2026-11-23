"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "../cn";

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Increment per press. 1 for pieces; 0.1 or 0.5 for goods sold by weight or volume. */
  step?: number;
  labels: { quantity: string; increase: string; decrease: string };
  className?: string;
}

const stepButton =
  "inline-flex size-11 shrink-0 items-center justify-center text-link transition-[background-color,transform] duration-150 ease-out " +
  "hover:bg-sunken active:scale-90 disabled:cursor-not-allowed disabled:text-off-ink disabled:hover:bg-transparent";

/** Float-safe: 0.1 + 0.2 must read 0.3, not 0.30000000000000004. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function formatQuantity(value: number): string {
  return String(round(value)).replace(".", ",");
}

export function QuantityStepper({ value, onChange, min = 0, max = 999, step = 1, labels, className }: QuantityStepperProps) {
  return (
    <div
      role="group"
      aria-label={labels.quantity}
      className={cn("inline-flex items-center overflow-hidden rounded-control border border-action bg-card", className)}
    >
      <button
        type="button"
        aria-label={labels.decrease}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, round(value - step)))}
        className={stepButton}
      >
        <Minus aria-hidden className="size-5" />
      </button>
      <output aria-live="polite" className="tnum min-w-9 flex-1 text-center text-body font-semibold text-ink">
        {formatQuantity(value)}
      </output>
      <button
        type="button"
        aria-label={labels.increase}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, round(value + step)))}
        className={stepButton}
      >
        <Plus aria-hidden className="size-5" />
      </button>
    </div>
  );
}
