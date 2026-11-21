import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    ".impeccable/**",
    "docs/**",
    "scripts/out/**",
  ]),
  {
    settings: { next: { rootDir: "apps/web/" } },
  },
  {
    // The browser-facing app and shared UI must never reach MoySklad or server secrets.
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@shop/moysklad", "@shop/moysklad/*", "@shop/db", "@shop/db/*"],
              message: "The web app and UI package must not import server-only packages (MoySklad client, database).",
            },
          ],
        },
      ],
    },
  },
]);
