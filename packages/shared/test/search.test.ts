import { describe, expect, it } from "vitest";
import {
  CatalogQuery,
  CheckoutInput,
  formatPhone,
  IntegrationSettingsSchema,
  normalizePhone,
  normalizeSearch,
  productSlug,
  slugify,
  slugShortId,
} from "../src";

describe("normalizeSearch", () => {
  const same = (...variants: string[]) => {
    const [first, ...rest] = variants.map(normalizeSearch);
    for (const v of rest) expect(v).toBe(first);
  };

  it("matches Cyrillic and every Latin spelling of the same word", () => {
    same("Shtrix korrektor", "штрих корректор", "shtrikh korrektor", "SHTRIH KOREKTOR");
    same("ruchka", "ручка", "RUCHKA");
    same("choy", "чой", "чай".replace("ай", "ой"));
    same("Yog'", "ёг", "yog", "yogʻ");
  });

  it("ignores Uzbek apostrophes, punctuation and case", () => {
    same("Oʻzbekiston", "o'zbekiston", "O`zbekiston", "ozbekiston");
    same("Daftar 48 varaq, katak", "daftar 48 varaq katak");
  });

  it("keeps digits and article codes intact", () => {
    expect(normalizeSearch("100 ml")).not.toBe(normalizeSearch("10 ml"));
    expect(normalizeSearch("EQ19-BL")).toBe("ek19 bl");
    expect(normalizeSearch("851500")).toBe("851500");
  });

  it("does not merge genuinely different words", () => {
    expect(normalizeSearch("sut")).not.toBe(normalizeSearch("suv"));
    expect(normalizeSearch("un")).not.toBe(normalizeSearch("ung"));
  });
});

describe("slugs", () => {
  it("makes ASCII slugs from Latin and Cyrillic names", () => {
    expect(slugify("Ruchka sharikovaya Deli EQ19-BL")).toBe("ruchka-sharikovaya-deli-eq19-bl");
    expect(slugify("Ручка шариковая")).toBe("ruchka-sharikovaya");
    expect(slugify("!!!")).toBe("item");
  });

  it("appends a short id that survives renames", () => {
    const slug = productSlug("Guruch Mehr, 5 kg", "3f2a9c1e-7b44-4d0a-9e61-0a1b2c3d4e5f");
    expect(slug).toBe("guruch-mehr-5-kg-3f2a9c1e");
    expect(slugShortId(slug)).toBe("3f2a9c1e");
    expect(slugShortId("no-short-id-here")).toBeNull();
  });
});

describe("phone", () => {
  it("normalises the formats customers type", () => {
    for (const v of ["+998 90 123 45 67", "998901234567", "90 123 45 67", "(90) 123-45-67", "0901234567"]) {
      expect(normalizePhone(v)).toBe("+998901234567");
    }
    expect(formatPhone("+998901234567")).toBe("+998 90 123 45 67");
  });

  it("rejects things that are not Uzbek numbers", () => {
    for (const v of ["", "12345", "+7 912 345 67 89", "+998 90 123 45", "abc"]) expect(normalizePhone(v)).toBeNull();
  });
});

describe("CheckoutInput", () => {
  const base = { items: [{ productId: "3f2a9c1e-7b44-4d0a-9e61-0a1b2c3d4e5f", quantity: 2 }], name: "Ali", phone: "90 123 45 67" };

  it("normalises the phone and requires an address only for delivery", () => {
    const ok = CheckoutInput.safeParse({ ...base, deliveryMethod: "pickup" });
    expect(ok.success && ok.data.phone).toBe("+998901234567");
    expect(CheckoutInput.safeParse({ ...base, deliveryMethod: "delivery" }).success).toBe(false);
    expect(CheckoutInput.safeParse({ ...base, deliveryMethod: "delivery", address: "Chilonzor 12, 5" }).success).toBe(true);
  });

  it("rejects empty carts, bad quantities and a filled honeypot", () => {
    expect(CheckoutInput.safeParse({ ...base, deliveryMethod: "pickup", items: [] }).success).toBe(false);
    expect(CheckoutInput.safeParse({ ...base, deliveryMethod: "pickup", items: [{ ...base.items[0], quantity: -1 }] }).success).toBe(false);
    expect(CheckoutInput.safeParse({ ...base, deliveryMethod: "pickup", website: "http://spam" }).success).toBe(false);
  });
});

describe("CatalogQuery and settings", () => {
  it("coerces query-string values", () => {
    const q = CatalogQuery.parse({ page: "2", brand: "deli,maped", inStock: "1", priceMax: "5000" });
    expect(q).toMatchObject({ page: 2, brand: ["deli", "maped"], inStock: true, priceMax: 5000, sort: "popular", pageSize: 24 });
  });

  it("has safe defaults: guest orders do not reserve stock, counterparties are never auto-attached", () => {
    const s = IntegrationSettingsSchema.parse({});
    expect(s.reserveOnCreateWeb).toBe(false);
    expect(s.counterpartyMatching).toBe("site-only");
    expect(s.filterTimezoneOffsetHours).toBe(3);
  });
});
