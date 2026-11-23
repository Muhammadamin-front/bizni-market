import { describe, expect, it } from "vitest";
import { editableMessages, getMessages, getMessagesWithContent, HEX_COLOR, sectionVisible, themeCss } from "../src";

describe("any text of the site can be overridden", () => {
  it("replaces one text in one language only, leaving everything else (and the functions) intact", () => {
    const base = getMessages("uz");
    const m = getMessagesWithContent("uz", { "t.nav.cart": { uz: "Savatcha", ru: "Корзинка" } });
    expect(m.nav.cart).toBe("Savatcha");
    expect(m.nav.home).toBe(base.nav.home);
    expect(m.cart.items(2)).toBe(base.cart.items(2));
    expect(getMessagesWithContent("ru", { "t.nav.cart": { uz: "Savatcha", ru: "" } }).nav.cart).toBe(getMessages("ru").nav.cart);
    // the built-in catalogue object itself is never modified
    expect(getMessages("uz").nav.cart).toBe(base.nav.cart);
    expect(base.nav.cart).not.toBe("Savatcha");
  });

  it("ignores keys that do not point at a text", () => {
    const base = getMessages("uz");
    const m = getMessagesWithContent("uz", { "t.nav": { uz: "x", ru: "x" }, "t.nope.nothing": { uz: "x", ru: "x" }, "t.cart.items": { uz: "x", ru: "x" } });
    expect(m.nav).toEqual(base.nav);
    expect(m.cart.items(1)).toBe(base.cart.items(1));
  });

  it("lists plain texts with their defaults, and only those", () => {
    const list = editableMessages();
    const cart = list.find((e) => e.key === "t.nav.cart");
    expect(cart).toMatchObject({ section: "nav", uz: getMessages("uz").nav.cart, ru: getMessages("ru").nav.cart });
    expect(list.some((e) => e.key === "t.cart.items")).toBe(false);
    expect(new Set(list.map((e) => e.key)).size).toBe(list.length);
  });
});

describe("colours and home sections", () => {
  it("builds CSS only from valid hex colours", () => {
    expect(themeCss({})).toBe("");
    expect(themeCss({ "theme.action": { uz: "red; } body { display:none", ru: "" } })).toBe("");
    const css = themeCss({ "theme.action": { uz: "#2f5bff", ru: "#2f5bff" }, "theme.ground": { uz: "#ffffff", ru: "#ffffff" } });
    expect(css).toContain("--color-action:#2f5bff");
    expect(css).toContain("--color-ground:#ffffff");
    expect(css).toMatch(/--color-action-press:#[0-9a-f]{6}/);
    expect(HEX_COLOR.test("#12345g")).toBe(false);
  });

  it("shows a home section unless the owner switched it off", () => {
    expect(sectionVisible({}, "brands")).toBe(true);
    expect(sectionVisible({ "home.show.brands": { uz: "0", ru: "0" } }, "brands")).toBe(false);
    expect(sectionVisible({ "home.show.brands": { uz: "1", ru: "1" } }, "brands")).toBe(true);
    expect(sectionVisible({ "home.show.brands": { uz: "0", ru: "0" } }, "offers")).toBe(true);
  });
});
