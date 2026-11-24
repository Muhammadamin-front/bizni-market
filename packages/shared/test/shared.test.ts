import { describe, expect, it } from "vitest";
import { discountPercent, formatAmount, formatPrice, getMessages, isCancelledOrder, LOCALES, stockStatus } from "../src";

describe("money", () => {
  it("groups integer UZS with non-breaking spaces", () => {
    expect(formatAmount(1500)).toBe("1 500");
    expect(formatAmount(2084300)).toBe("2 084 300");
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(999)).toBe("999");
  });

  it("rounds, never shows decimals, and marks negatives", () => {
    expect(formatAmount(1499.6)).toBe("1 500");
    expect(formatAmount(-12000)).toBe("−12 000");
    expect(formatAmount(Number.NaN)).toBe("");
  });

  it("uses the locale's currency word and keeps it on the same line", () => {
    expect(formatPrice(48500, "uz")).toBe("48 500 soʻm");
    expect(formatPrice(48500, "ru")).toBe("48 500 сум");
  });

  it("computes real discounts only", () => {
    expect(discountPercent(6800, 8000)).toBe(15);
    expect(discountPercent(8000, 8000)).toBe(0);
    expect(discountPercent(9000, 8000)).toBe(0);
    expect(discountPercent(5000, null)).toBe(0);
  });
});

describe("stockStatus", () => {
  it("treats a missing or non-positive figure as out of stock", () => {
    expect(stockStatus(undefined)).toBe("out");
    expect(stockStatus(null)).toBe("out");
    expect(stockStatus(0)).toBe("out");
    expect(stockStatus(-3)).toBe("out");
  });

  it("marks small positive stock as low and the rest as in", () => {
    expect(stockStatus(1)).toBe("low");
    expect(stockStatus(4)).toBe("low");
    expect(stockStatus(5)).toBe("in");
    expect(stockStatus(240)).toBe("in");
    expect(stockStatus(8, 10)).toBe("low");
  });
});

describe("i18n catalogs", () => {
  it("define the same shape for every locale", () => {
    const shape = (v: unknown): unknown =>
      v !== null && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
        : typeof v;
    const [first, ...rest] = LOCALES.map((l) => shape(getMessages(l)));
    for (const other of rest) expect(other).toEqual(first);
  });

  it("formats counts in both languages without leaving placeholders", () => {
    for (const locale of LOCALES) {
      const m = getMessages(locale);
      expect(m.product.lowStock(3)).toContain("3");
      expect(m.product.perPack(12)).toContain("12");
      expect(m.catalog.results(48)).toContain("48");
    }
  });
});

describe("isCancelledOrder", () => {
  it("is true for a cancelled order in either pipeline and false for anything else", () => {
    const o = (syncStatus: string, localStatus: string | null, msStateType: string | null) => isCancelledOrder({ syncStatus, localStatus, msStateType });
    expect(o("local", "cancelled", null)).toBe(true);
    expect(o("cancelled", null, null)).toBe(true);
    expect(o("synced", null, "Unsuccessful")).toBe(true);
    expect(o("local", "new", null)).toBe(false);
    expect(o("local", "done", "Unsuccessful")).toBe(false); // a local order follows its own status only
    expect(o("synced", null, "Successful")).toBe(false);
    expect(o("pending_sync", null, null)).toBe(false);
  });
});
