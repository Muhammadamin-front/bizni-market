import { createHash } from "node:crypto";

/*
 * SYNTHETIC demo catalogue. Product names imitate MoySklad's transliterated-Latin style, but every name, price and stock
 * figure here is invented for development and for the client demo. It is generated, deterministic, and clearly labelled
 * "demo" wherever it is shown. None of it is real shop data.
 */

export function uuidFrom(seed: string): string {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ArtKind = "pen" | "notebook" | "sack" | "milk" | "box" | "bottle" | "can" | "paper";

export interface MockFolder {
  id: string;
  name: string;
  parentId: string | null;
  pathName: string;
  updated: Date;
}

export interface MockProduct {
  id: string;
  name: string;
  code: string;
  externalCode: string;
  article: string;
  description: string;
  archived: boolean;
  updated: Date;
  folderId: string;
  uom: string;
  packQty: number | null;
  /** Hundredths of a so'm, as the real API returns. */
  priceMinor: number;
  oldPriceMinor: number | null;
  brand: string;
  barcodes: string[];
  imageIds: string[];
  art: ArtKind;
  hue: number;
  /** Per store id. */
  stock: Record<string, number>;
}

export const IDS = {
  organization: uuidFrom("org"),
  storeStationery: uuidFrom("store-stationery"),
  storeGrocery: uuidFrom("store-grocery"),
  priceRetail: uuidFrom("price-retail"),
  priceOld: uuidFrom("price-old"),
  priceWholesale: uuidFrom("price-wholesale"),
  brandAttr: uuidFrom("attr-brand"),
  channelWeb: uuidFrom("channel-web"),
  channelTma: uuidFrom("channel-tma"),
  account: uuidFrom("account"),
};

export const STATES = [
  { id: uuidFrom("state-new"), name: "Yangi", stateType: "Regular" },
  { id: uuidFrom("state-confirmed"), name: "Tasdiqlandi", stateType: "Regular" },
  { id: uuidFrom("state-packed"), name: "Yigʻildi", stateType: "Regular" },
  { id: uuidFrom("state-delivered"), name: "Yetkazildi", stateType: "Successful" },
  { id: uuidFrom("state-cancelled"), name: "Bekor qilindi", stateType: "Unsuccessful" },
] as const;

interface Template {
  folder: string;
  parent: string;
  type: string;
  art: ArtKind;
  uom: string;
  brands: string[];
  variants: string[];
  price: [number, number];
  pack?: number;
  desc: string;
}

const TEMPLATES: Template[] = [
  { parent: "Kanselyariya", folder: "Ruchkalar va flomasterlar", type: "Ruchka sharikovaya", art: "pen", uom: "dona", brands: ["Deli", "Maped", "Luch", "Erich Krause"], variants: ["EQ19-BL", "EQ20-RD", "E7102", "F12", "GL-05", "XL-03"], price: [1200, 3500], pack: 12, desc: "Shariksimon ruchka, silliq yozuv." },
  { parent: "Kanselyariya", folder: "Ruchkalar va flomasterlar", type: "Flomaster", art: "pen", uom: "dona", brands: ["Deli", "Luch", "Maped"], variants: ["6 rang", "12 rang", "18 rang", "24 rang"], price: [9000, 38000], pack: 12, desc: "Yuviladigan siyohli flomasterlar to'plami." },
  { parent: "Kanselyariya", folder: "Daftar va bloknotlar", type: "Daftar katak", art: "notebook", uom: "dona", brands: ["Mirl", "Luch", "Erich Krause"], variants: ["12 varaq", "18 varaq", "24 varaq", "48 varaq", "96 varaq"], price: [2500, 18000], pack: 10, desc: "Maktab daftari, katakli." },
  { parent: "Kanselyariya", folder: "Daftar va bloknotlar", type: "Bloknot", art: "notebook", uom: "dona", brands: ["Deli", "Maped", "Mirl"], variants: ["A5", "A6", "A4", "B5"], price: [6000, 32000], pack: 6, desc: "Spiralli bloknot." },
  { parent: "Kanselyariya", folder: "Qogʻoz va karton", type: "Oq qogʻoz", art: "paper", uom: "pachka", brands: ["Svetocopy", "Ballet", "SvetoCopy"], variants: ["A4 80g 500 varaq", "A3 80g 500 varaq", "A4 70g 500 varaq"], price: [42000, 98000], desc: "Ofis qogʻozi." },
  { parent: "Kanselyariya", folder: "Qogʻoz va karton", type: "Rangli karton", art: "paper", uom: "dona", brands: ["Luch", "Mirl"], variants: ["8 rang", "10 rang", "12 rang"], price: [7000, 16000], pack: 20, desc: "Rangli karton to'plami, A4." },
  { parent: "Kanselyariya", folder: "Papka va fayllar", type: "Papka-skoroshivatel", art: "box", uom: "dona", brands: ["Deli", "Erich Krause"], variants: ["A4 sariq", "A4 koʻk", "A4 yashil", "A4 qizil"], price: [4000, 12000], pack: 20, desc: "Karton papka, A4." },
  { parent: "Kanselyariya", folder: "Maktab buyumlari", type: "Penal", art: "box", uom: "dona", brands: ["Maped", "Deli", "Mirl"], variants: ["bir qavatli", "ikki qavatli", "yumshoq"], price: [14000, 62000], pack: 6, desc: "Maktab penali." },
  { parent: "Kanselyariya", folder: "Maktab buyumlari", type: "Plastilin", art: "box", uom: "dona", brands: ["Luch", "Maped"], variants: ["6 rang", "12 rang", "ZOO 8 rang"], price: [8000, 21000], pack: 48, desc: "Yumshoq plastilin." },
  { parent: "Kanselyariya", folder: "Ofis jihozlari", type: "Shtrix korrektor", art: "bottle", uom: "dona", brands: ["Deli", "Maped"], variants: ["8 ml E7286", "12 ml", "20 ml"], price: [4500, 12000], pack: 12, desc: "Tez quriydigan korrektor." },
  { parent: "Kanselyariya", folder: "Ofis jihozlari", type: "Stepler", art: "box", uom: "dona", brands: ["Deli", "Maped"], variants: ["No.10", "No.24/6", "No.23"], price: [9000, 45000], pack: 6, desc: "Metall stepler." },
  { parent: "Oziq-ovqat", folder: "Ichimliklar", type: "Ichimlik gazsiz", art: "bottle", uom: "dona", brands: ["Hydrolife", "Nestle", "Bonaqua"], variants: ["0,5 l", "1 l", "1,5 l", "5 l"], price: [2500, 12000], pack: 12, desc: "Ichimlik suvi." },
  { parent: "Oziq-ovqat", folder: "Ichimliklar", type: "Sharbat olma", art: "milk", uom: "dona", brands: ["Sadochok", "Dobryi", "Rich"], variants: ["0,2 l", "1 l", "2 l"], price: [4500, 26000], pack: 12, desc: "Tabiiy sharbat." },
  { parent: "Oziq-ovqat", folder: "Shirinliklar va pechenye", type: "Pechenye", art: "box", uom: "dona", brands: ["Yashkino", "Oreo", "Bahor"], variants: ["shokoladli 200 g", "sutli 150 g", "vanilli 300 g"], price: [8000, 24000], pack: 24, desc: "Qandolat mahsuloti." },
  { parent: "Oziq-ovqat", folder: "Shirinliklar va pechenye", type: "Shokolad", art: "box", uom: "dona", brands: ["Alpen Gold", "Milka", "Kitkat"], variants: ["sutli 90 g", "yongʻoqli 90 g", "qora 85 g"], price: [9500, 22000], pack: 20, desc: "Plitka shokolad." },
  { parent: "Oziq-ovqat", folder: "Un va yormalar", type: "Guruch", art: "sack", uom: "kg", brands: ["Mehr", "Lazer", "Devzira"], variants: ["1 kg", "5 kg", "10 kg"], price: [14000, 120000], desc: "Guruch, yuqori nav." },
  { parent: "Oziq-ovqat", folder: "Un va yormalar", type: "Un oliy nav", art: "sack", uom: "dona", brands: ["Mehr", "Hosil"], variants: ["2 kg", "5 kg", "10 kg", "50 kg"], price: [21000, 410000], desc: "Bugʻdoy uni." },
  { parent: "Oziq-ovqat", folder: "Un va yormalar", type: "Makaron", art: "box", uom: "dona", brands: ["Barilla", "Mehr", "Makfa"], variants: ["spagetti 400 g", "peru 400 g", "shyoltikcha 500 g"], price: [7000, 17000], pack: 20, desc: "Makaron mahsulotlari." },
  { parent: "Oziq-ovqat", folder: "Konservalar", type: "Konserva goʻsht", art: "can", uom: "dona", brands: ["Gorbusha", "Hortex"], variants: ["tushonka 325 g", "baliq 240 g", "makkajoʻxori 400 g"], price: [11000, 38000], pack: 24, desc: "Konservalangan mahsulot." },
  { parent: "Oziq-ovqat", folder: "Sut mahsulotlari", type: "Sut", art: "milk", uom: "dona", brands: ["Lactel", "Nestle", "Bellakt"], variants: ["0,9 l 2,5%", "1 l 3,2%", "1 l 1,5%"], price: [9500, 17500], pack: 12, desc: "Pasterizatsiyalangan sut." },
  { parent: "Oziq-ovqat", folder: "Sut mahsulotlari", type: "Qatiq", art: "milk", uom: "dona", brands: ["Lactel", "Bellakt"], variants: ["450 g", "900 g"], price: [7000, 14500], pack: 12, desc: "Tabiiy qatiq." },
  { parent: "Oziq-ovqat", folder: "Choy va kofe", type: "Choy qora", art: "box", uom: "dona", brands: ["Ahmad Tea", "Lipton", "Greenfield"], variants: ["100 g", "200 g", "25 paketcha"], price: [12000, 48000], pack: 24, desc: "Qora barg choy." },
  { parent: "Oziq-ovqat", folder: "Choy va kofe", type: "Kofe eruvchan", art: "can", uom: "dona", brands: ["Nescafe", "Jacobs"], variants: ["50 g", "95 g", "190 g"], price: [19000, 98000], pack: 12, desc: "Eruvchan kofe." },
];

export interface Dataset {
  folders: MockFolder[];
  products: MockProduct[];
}

export function generateDataset(baseTime: Date = new Date()): Dataset {
  const rand = mulberry32(20261107);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const folders = new Map<string, MockFolder>();
  const fold = (name: string, parent: MockFolder | null): MockFolder => {
    const key = `${parent?.name ?? ""}/${name}`;
    let f = folders.get(key);
    if (!f) {
      f = { id: uuidFrom(`folder:${key}`), name, parentId: parent?.id ?? null, pathName: parent ? (parent.pathName ? `${parent.pathName}/${parent.name}` : parent.name) : "", updated: baseTime };
      folders.set(key, f);
    }
    return f;
  };

  const products: MockProduct[] = [];
  let n = 0;
  for (const t of TEMPLATES) {
    const root = fold(t.parent, null);
    const leaf = fold(t.folder, root);
    for (const brand of t.brands) {
      for (const variant of t.variants) {
        n++;
        const id = uuidFrom(`product:${t.type}:${brand}:${variant}`);
        const code = `D${String(n).padStart(5, "0")}`;
        const priceUzs = Math.round((t.price[0] + rand() * (t.price[1] - t.price[0])) / 100) * 100;
        const onSale = rand() < 0.12;
        const stockRoll = rand();
        const qty = stockRoll < 0.1 ? 0 : stockRoll < 0.2 ? Math.floor(rand() * 4) + 1 : Math.floor(rand() * 240) + 5;
        const isGrocery = t.parent === "Oziq-ovqat";
        const storeId = isGrocery ? IDS.storeGrocery : IDS.storeStationery;
        products.push({
          id,
          name: `${t.type} ${brand} ${variant}`,
          code,
          externalCode: id.slice(0, 8),
          article: `${brand.slice(0, 2).toUpperCase()}${String(1000 + n)}`,
          description: `${t.desc} (demo ma'lumot)`,
          archived: false,
          updated: new Date(baseTime.getTime() - Math.floor(rand() * 30 * 86_400_000)),
          folderId: leaf.id,
          uom: t.uom,
          packQty: t.pack ?? null,
          priceMinor: priceUzs * 100,
          oldPriceMinor: onSale ? Math.round(priceUzs * 1.18 / 100) * 100 * 100 : null,
          brand,
          barcodes: [String(4780000000000 + n * 7)],
          imageIds: [uuidFrom(`image:${id}:0`)],
          art: t.art,
          hue: Math.floor(rand() * 360),
          stock: { [storeId]: qty },
        });
        void pick;
      }
    }
  }
  // A few archived products and one without a price/image, to exercise the visibility rules.
  for (const p of products.filter((_, i) => i % 41 === 7)) p.archived = true;
  const noImage = products[11];
  if (noImage) noImage.imageIds = [];
  return { folders: [...folders.values()], products };
}
