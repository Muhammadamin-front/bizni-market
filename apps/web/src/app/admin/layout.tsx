import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getMessagesWithContent } from "@shop/shared";
import { AdminBrandProvider } from "@/components/admin/brand";
import { fontClass } from "@/lib/fonts";
import { getConfig } from "@/lib/server-api";
import "../globals.css";

export const dynamic = "force-dynamic";

const shopName = async () => getMessagesWithContent("uz", (await getConfig().catch(() => null))?.content).brand.name;

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await shopName()} · admin`, robots: { index: false, follow: false } };
}

export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz" className={fontClass}>
      <body>
        <AdminBrandProvider name={await shopName()}>{children}</AdminBrandProvider>
      </body>
    </html>
  );
}
