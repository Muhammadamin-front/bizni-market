import { getMessages, type ProductCardData } from "@shop/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AddToCart, Price, ProductCard, QuantityStepper, StockBadge } from "../src";

const m = getMessages("uz");
const labels = { add: m.product.add, quantity: m.product.quantity, increase: m.product.increase, decrease: m.product.decrease };

describe("QuantityStepper", () => {
  it("never goes below min or above max", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<QuantityStepper value={1} min={1} max={3} onChange={onChange} labels={labels} />);
    expect(screen.getByRole("button", { name: labels.decrease })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: labels.increase }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    rerender(<QuantityStepper value={3} min={1} max={3} onChange={onChange} labels={labels} />);
    expect(screen.getByRole("button", { name: labels.increase })).toBeDisabled();
  });

  it("steps by fractions without float drift and formats with a decimal comma", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityStepper value={0.2} step={0.1} onChange={onChange} labels={labels} />);
    await user.click(screen.getByRole("button", { name: labels.increase }));
    expect(onChange).toHaveBeenLastCalledWith(0.3);
    expect(screen.getByRole("status")).toHaveTextContent("0,2");
  });

  it("clamps a step that would overshoot the stock", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityStepper value={4.8} max={5} step={0.5} onChange={onChange} labels={labels} />);
    await user.click(screen.getByRole("button", { name: labels.increase }));
    expect(onChange).toHaveBeenLastCalledWith(5);
  });
});

describe("AddToCart", () => {
  function Harness({ max = 5, step = 1 }: { max?: number; step?: number }) {
    const [q, setQ] = useState(0);
    return <AddToCart quantity={q} onChange={setQ} max={max} step={step} labels={labels} />;
  }

  it("turns the add button into a stepper in place and back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: m.product.add }));
    expect(screen.getByRole("group", { name: labels.quantity })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: labels.decrease }));
    expect(screen.getByRole("button", { name: m.product.add })).toBeInTheDocument();
  });

  it("starts weight goods at one step", async () => {
    const user = userEvent.setup();
    render(<Harness step={0.5} />);
    await user.click(screen.getByRole("button", { name: m.product.add }));
    expect(screen.getByRole("status")).toHaveTextContent("0,5");
  });

  it("shows only a disabled add button when unavailable", () => {
    render(<AddToCart quantity={2} onChange={() => undefined} max={0} disabled labels={labels} />);
    expect(screen.getByRole("button", { name: m.product.add })).toBeDisabled();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});

describe("StockBadge and Price", () => {
  it("carries the meaning in text, not only colour", () => {
    render(<StockBadge status="low" label="Faqat 3 dona qoldi" />);
    expect(screen.getByText("Faqat 3 dona qoldi")).toBeInTheDocument();
  });

  it("shows a struck old price and the real percentage only for a real discount", () => {
    const { container, rerender } = render(<Price amount={6800} oldAmount={8000} locale="uz" />);
    expect(container.querySelector("s")).toHaveTextContent("8 000");
    expect(container).toHaveTextContent("−15%");
    rerender(<Price amount={8000} oldAmount={8000} locale="ru" />);
    expect(container.querySelector("s")).toBeNull();
    expect(container).toHaveTextContent("сум");
  });
});

describe("ProductCard", () => {
  const product: ProductCardData = {
    id: "1",
    slug: "ruchka-1",
    name: "Ruchka Deli",
    article: "EQ19",
    brand: "Deli",
    price: 1500,
    oldPrice: null,
    packSize: 12,
    unit: "dona",
    qtyStep: 1,
    stockStatus: "out",
    freeStock: 0,
    imageUrl: null,
  };

  it("disables adding and says so when out of stock", () => {
    render(<ProductCard product={product} locale="uz" messages={m} quantity={0} onQuantityChange={() => undefined} />);
    expect(screen.getByRole("button", { name: m.product.add })).toBeDisabled();
    expect(screen.getByText(m.product.outOfStock)).toBeInTheDocument();
  });
});
