import { stockStatus, type ProductCardData } from "@shop/shared";
import type { ArtKind } from "./demo-art";

/** Synthetic demo products. Names follow MoySklad's transliterated-Latin style; prices and stock are invented. */
export interface DemoProduct extends ProductCardData {
  category: "stationery" | "grocery";
  art: ArtKind;
}

type Seed = Omit<DemoProduct, "slug" | "stockStatus" | "imageUrl" | "unit" | "qtyStep">;

const seeds: Seed[] = [
  { id: "p1", name: "Ruchka sharikovaya Deli EQ19-BL", article: "EQ19-BL", brand: "Deli", price: 1500, oldPrice: null, packSize: 12, freeStock: 240, category: "stationery", art: "pen" },
  { id: "p2", name: "Daftar 48 varaq, katak", article: "D48K", brand: "Mirl", price: 6800, oldPrice: 8000, packSize: 10, freeStock: 3, category: "stationery", art: "notebook" },
  { id: "p3", name: "Guruch Mehr, 5 kg", article: "GR-5", brand: "Mehr", price: 48500, oldPrice: null, packSize: null, freeStock: 36, category: "grocery", art: "sack" },
  { id: "p4", name: "Sut Lactel 1 l, 3.2%", article: "ST-0132", brand: "Lactel", price: 13900, oldPrice: null, packSize: 12, freeStock: 0, category: "grocery", art: "milk" },
  { id: "p5", name: "Karandash oddiy Maped HB", article: "851500", brand: "Maped", price: 2200, oldPrice: null, packSize: 12, freeStock: 118, category: "stationery", art: "pen" },
  { id: "p6", name: "Plastilin \"ZOO\" 6 tsvetov", article: "30C 1810-08", brand: "Luch", price: 17400, oldPrice: null, packSize: 48, freeStock: 52, category: "stationery", art: "box" },
  { id: "p7", name: "Un oliy nav, 2 kg", article: "UN-2", brand: "Mehr", price: 21800, oldPrice: null, packSize: null, freeStock: 64, category: "grocery", art: "sack" },
  { id: "p8", name: "Shtrix korrektor 8 ml Deli E7286", article: "E7286", brand: "Deli", price: 5700, oldPrice: null, packSize: 12, freeStock: 4, category: "stationery", art: "bottle" },
  { id: "p9", name: "Choy qora Ahmad Tea 100 g", article: "CH-100", brand: "Ahmad", price: 24900, oldPrice: 28000, packSize: 24, freeStock: 85, category: "grocery", art: "box" },
  { id: "p10", name: "Albom risovaniya uchun A4, 20 varaq", article: "AL-A4", brand: "Luch", price: 12500, oldPrice: null, packSize: 10, freeStock: 40, category: "stationery", art: "notebook" },
  { id: "p11", name: "Shakar, 1 kg", article: "SH-1", brand: "Mehr", price: 14500, oldPrice: null, packSize: null, freeStock: 0, category: "grocery", art: "sack" },
  { id: "p12", name: "Marker matnli 4 rang Deli E37232", article: "E37232", brand: "Deli", price: 28400, oldPrice: null, packSize: 12, freeStock: 22, category: "stationery", art: "pen" },
];

export const demoProducts: DemoProduct[] = seeds.map((seed) => ({
  ...seed,
  slug: seed.id,
  stockStatus: stockStatus(seed.freeStock),
  imageUrl: null,
  unit: null,
  qtyStep: 1,
}));

export const demoBrands = Array.from(new Set(demoProducts.map((p) => p.brand ?? ""))).filter(Boolean).map((name) => ({ id: name.toLowerCase(), name }));
