import { Onest } from "next/font/google";

// Self-hosted by Next at build time. Cyrillic and Latin-ext cover Russian and Uzbek Latin (oʻ gʻ).
// Not preloaded: the browser then fetches only the subsets the page actually uses (an Uzbek page never downloads Cyrillic),
// and text shows at once in a metric-matched fallback, so slow connections are not held up by fonts.
const onest = Onest({ subsets: ["cyrillic", "latin", "latin-ext"], variable: "--font-onest", display: "swap", preload: false, adjustFontFallback: true });

export const fontClass = onest.variable;
