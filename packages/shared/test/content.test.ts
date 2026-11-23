import { describe, expect, it } from "vitest";
import { contentText, getMessages, getMessagesWithContent } from "../src";

describe("owner texts over the built-in messages", () => {
  it("keeps the defaults when nothing is set", () => {
    expect(getMessagesWithContent("uz", {})).toBe(getMessages("uz"));
    expect(getMessagesWithContent("ru", null).brand.name).toBe(getMessages("ru").brand.name);
  });

  it("uses the owner's shop name and home texts per language", () => {
    const content = { "brand.name": { uz: "Kanso PC", ru: "Канзо ПК" }, "home.heroTitle": { uz: "Noutbuklar", ru: "" } };
    expect(getMessagesWithContent("uz", content).brand.name).toBe("Kanso PC");
    expect(getMessagesWithContent("ru", content).brand.name).toBe("Канзо ПК");
    expect(getMessagesWithContent("uz", content).home.heroTitle).toBe("Noutbuklar");
    // An empty Russian value falls back to the Uzbek one rather than to the built-in text.
    expect(getMessagesWithContent("ru", content).home.heroTitle).toBe("Noutbuklar");
    expect(getMessagesWithContent("uz", content).home.heroBody).toBe(getMessages("uz").home.heroBody);
  });

  it("ignores blank values and does not touch the shared catalogue", () => {
    expect(contentText({ "brand.name": { uz: "   ", ru: "" } }, "brand.name", "uz")).toBe("");
    getMessagesWithContent("uz", { "brand.name": { uz: "X", ru: "X" } });
    expect(getMessages("uz").brand.name).toBe("Kanso");
  });
});
