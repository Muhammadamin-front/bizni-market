import type { Locale } from "./i18n/types";
import type { LocalOrderStatus } from "./order";
import type { ProductCardData } from "./product";

/** Shapes the public API returns. Built from the local read model; never from a live MoySklad call. */
export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  productCount: number;
  segment: "stationery" | "grocery" | null;
  /** Up to three photos of in-stock products in this category or below it (most popular first), for picture tiles. */
  covers: string[];
  /** The owner's own picture for this category (admin → Kategoriyalar), shown instead of product photos. */
  imageUrl: string | null;
  children: CategoryNode[];
}

export interface BrandDTO {
  id: string;
  slug: string;
  name: string;
  productCount: number;
}

export interface ProductImageDTO {
  /** URLs of our own copies, in three widths. */
  small: string;
  medium: string;
  large: string;
}

export interface ProductDetail extends ProductCardData {
  description: string;
  barcodes: string[];
  categoryPath: { slug: string; name: string }[];
  images: ProductImageDTO[];
}

export interface CatalogPage {
  items: ProductCardData[];
  total: number;
  page: number;
  pageSize: number;
  priceMin: number;
  priceMax: number;
}

export interface BannerDTO {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  linkUrl: string;
}

export interface HomePayload {
  banners: BannerDTO[];
  featured: ProductCardData[];
  newArrivals: ProductCardData[];
  offers: ProductCardData[];
  bestsellers: ProductCardData[];
  categories: CategoryNode[];
  brands: BrandDTO[];
}

export interface SuggestResult {
  products: ProductCardData[];
  categories: { slug: string; name: string }[];
  brands: { slug: string; name: string }[];
}

export interface OrderItemView {
  name: string;
  article: string;
  unit: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderView {
  id: string;
  publicId: string;
  number: string;
  channel: "web" | "tma";
  /** Customer-facing status: the MoySklad state name, or for a locally handled order its name in the order's language; null while being sent. */
  status: string | null;
  /** Set for locally handled orders: show LOCAL_ORDER_STATUS_INFO[statusCode][viewer locale] instead of `status`. */
  statusCode: LocalOrderStatus | null;
  statusType: "Regular" | "Successful" | "Unsuccessful" | null;
  syncStatus: "pending_sync" | "synced" | "failed" | "cancelled" | "local";
  total: number;
  deliveryMethod: "delivery" | "pickup";
  address: string;
  comment: string;
  contactName: string;
  contactPhone: string;
  createdAt: string;
  items: OrderItemView[];
}

export interface MeView {
  id: string;
  name: string;
  phone: string | null;
  language: Locale;
  telegramId: number | null;
  username: string | null;
}

export interface PublicConfig {
  /** True while the catalog comes from the synthetic mock instead of a real MoySklad account. */
  demo: boolean;
  /** Cloudflare Turnstile site key, or null when guest checkout runs without the challenge. */
  turnstileSiteKey: string | null;
  /** The bot's username without @, or null before the bot exists. */
  botUsername: string | null;
  /** True when the Mini App may open in a plain browser with a stand-in Telegram user (never in production with a real bot). */
  tmaDevMode: boolean;
  minimumOrderAmount: number;
  content: Record<string, { uz: string; ru: string }>;
}
