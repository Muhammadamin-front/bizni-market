/**
 * Search skeleton. MoySklad product names here are transliterated Latin ("Shtrix korrektor") while customers type
 * Cyrillic ("штрих") or other Latin spellings ("shtrikh", "shtrih"). Both the stored name and the query are reduced to
 * the same skeleton, so those all meet. It is deliberately lossy: it is for matching, never for display.
 */

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  // Uzbek Cyrillic
  ў: "o", ғ: "g", қ: "k", ҳ: "h",
};

/** Apostrophe-like marks used for Uzbek oʻ / gʻ (U+02BB, U+02BC, U+2018, U+2019, U+0060, U+00B4, U+0027). */
const APOSTROPHES = /[ʻʼ‘’`´']/g;

export function transliterateCyrillic(input: string): string {
  let out = "";
  for (const ch of input) out += CYRILLIC[ch] ?? ch;
  return out;
}

export function normalizeSearch(input: string): string {
  let s = input.toLowerCase().replace(APOSTROPHES, "");
  s = transliterateCyrillic(s);
  s = s
    .replace(/kh/g, "h")
    .replace(/x/g, "h")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/ts/g, "c")
    .replace(/y[aueo]/g, (m) => m.slice(1))
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

export function searchTokens(input: string): string[] {
  return normalizeSearch(input)
    .split(" ")
    .filter((t) => t.length > 0);
}

/** ASCII slug for URLs ("Ruchka sharikovaya Deli EQ19-BL" -> "ruchka-sharikovaya-deli-eq19-bl"). */
export function slugify(input: string, maxLength = 60): string {
  const latin = transliterateCyrillic(input.toLowerCase().replace(APOSTROPHES, ""));
  const slug = latin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** Product slug = readable part + first 8 hex of the MoySklad id, so a rename never breaks a link. */
export function productSlug(name: string, msId: string): string {
  return `${slugify(name, 56)}-${msId.replace(/-/g, "").slice(0, 8)}`;
}

/** The trailing short id of a product slug, or null when the slug has none. */
export function slugShortId(slug: string): string | null {
  const m = /-([0-9a-f]{8})$/.exec(slug);
  return m?.[1] ?? null;
}
