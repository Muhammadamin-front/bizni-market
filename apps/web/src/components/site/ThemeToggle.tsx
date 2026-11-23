"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const KEY = "kanso-theme";

/** Day/night switch of the site. The choice is kept in the browser and applied before first paint (see the script in the site layout). */
export function ThemeToggle() {
  const { messages } = useI18n();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the theme the early script already applied is the point of this effect
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* private mode: the choice just lasts until reload */
    }
  };
  const Icon = dark ? Moon : Sun;
  return (
    <button type="button" onClick={toggle} aria-label={messages.theme.label} aria-pressed={dark} className="inline-flex h-8 items-center gap-2 rounded-control px-2 text-small font-medium hover:bg-ink/10">
      <Icon aria-hidden className="size-4" />
      {dark ? messages.theme.night : messages.theme.day}
    </button>
  );
}
