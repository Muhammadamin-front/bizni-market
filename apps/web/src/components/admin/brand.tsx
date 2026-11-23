"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The shop name the owner set in the admin (Sayt matnlari), for the admin header and login page. */
const BrandCtx = createContext("Kanso");

export function AdminBrandProvider({ name, children }: { name: string; children: ReactNode }) {
  return <BrandCtx.Provider value={name}>{children}</BrandCtx.Provider>;
}

export const useShopName = () => useContext(BrandCtx);
