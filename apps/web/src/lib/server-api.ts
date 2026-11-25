import "server-only";
import type { BrandDTO, CatalogPage, CategoryNode, HomePayload, Locale, ProductCardData, ProductDetail, PublicConfig } from "@shop/shared";

/** Server-side calls to our own API (never to MoySklad). Read at request time, so the address is not baked into the build. */
const base = () => process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`API ${status} for ${path}`);
  }
}

interface Options {
  revalidate?: number;
  tags?: string[];
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, { next: { revalidate: options.revalidate ?? 60, tags: ["catalog", ...(options.tags ?? [])] } });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

/** Like api(), but a 404 is an ordinary answer ("no such product"), not an error. */
export async function apiOrNull<T>(path: string, options: Options = {}): Promise<T | null> {
  try {
    return await api<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export const getConfig = () => api<PublicConfig>("/v1/config", { revalidate: 30, tags: ["config"] });
export const getHome = (locale: Locale) => api<HomePayload>(`/v1/home?locale=${locale}`, { revalidate: 60 });
export const getCategories = (locale: Locale, opts: { includeEmpty?: boolean } = {}) => api<CategoryNode[]>(`/v1/categories?locale=${locale}${opts.includeEmpty ? "&empty=1" : ""}`, { revalidate: 60 });
export const getBrands = () => api<BrandDTO[]>("/v1/brands", { revalidate: 120 });
export const getCatalog = (query: URLSearchParams) => api<CatalogPage>(`/v1/catalog/products?${query.toString()}`, { revalidate: 30 });
export const getProduct = (slug: string, locale: Locale) => apiOrNull<ProductDetail | { redirectTo: string }>(`/v1/products/${encodeURIComponent(slug)}?locale=${locale}`, { revalidate: 60 });
export const getRelated = (id: string, locale: Locale) => api<ProductCardData[]>(`/v1/products/${id}/related?locale=${locale}`, { revalidate: 120 });
export const getCategory = (slug: string, locale: Locale) =>
  apiOrNull<{ node: CategoryNode; path: { slug: string; name: string }[] }>(`/v1/categories/${encodeURIComponent(slug)}?locale=${locale}`, { revalidate: 60 });
