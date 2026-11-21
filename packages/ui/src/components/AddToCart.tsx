"use client";

import { Plus } from "lucide-react";
import { Button } from "./Button";
import { QuantityStepper } from "./QuantityStepper";

export interface AddToCartProps {
  /** Quantity currently in the cart. 0 shows the add button; above 0 the button turns into a stepper in place. */
  quantity: number;
  onChange: (quantity: number) => void;
  /** Free stock; the stepper cannot go above it. */
  max: number;
  /** Increment per press (1 for pieces, 0.1/0.5 for weight). The first add puts one step in the cart. */
  step?: number;
  disabled?: boolean;
  labels: { add: string; quantity: string; increase: string; decrease: string };
}

/** The signature move: the add button becomes the quantity stepper where it stands, so the cart count is never a separate trip. */
export function AddToCart({ quantity, onChange, max, step = 1, disabled = false, labels }: AddToCartProps) {
  if (quantity > 0 && !disabled) {
    return <QuantityStepper value={quantity} max={max} step={step} onChange={onChange} labels={labels} className="w-full" />;
  }
  return (
    <Button fullWidth disabled={disabled} onClick={() => onChange(step)}>
      <Plus aria-hidden className="size-5" />
      {labels.add}
    </Button>
  );
}
