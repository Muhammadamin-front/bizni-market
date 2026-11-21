import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fontClass } from "@/lib/fonts";
import "../globals.css";

export const metadata: Metadata = { title: "Bizni Market · admin", robots: { index: false, follow: false } };

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz" className={fontClass}>
      <body>{children}</body>
    </html>
  );
}
