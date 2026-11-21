import type { ReactNode } from "react";
import { TmaApp } from "@/components/tma/TabShell";

export const dynamic = "force-dynamic";

export default function TmaLayout({ children }: { children: ReactNode }) {
  return <TmaApp>{children}</TmaApp>;
}
