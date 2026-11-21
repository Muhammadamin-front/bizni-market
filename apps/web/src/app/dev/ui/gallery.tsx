"use client";

import { getMessages, type Locale } from "@shop/shared";
import {
  AddToCart,
  AppHeader,
  BottomTabBar,
  BrandStrip,
  Button,
  CheckboxRow,
  Chip,
  EmptyState,
  FilterGroup,
  IconButton,
  LanguageSwitch,
  Price,
  ProductCard,
  ProductCardSkeleton,
  ProductRow,
  QuantityStepper,
  SearchField,
  Sheet,
  StockBadge,
  TextField,
  Toast,
  ToastRegion,
  type TabItem,
} from "@shop/ui";
import { Grid2x2, Heart, House, LayoutGrid, LayoutList, ShoppingCart, SlidersHorizontal, User } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DemoArt } from "./demo-art";
import { demoBrands, demoProducts, type DemoProduct } from "./demo-data";

type Category = "all" | "stationery" | "grocery";
type Sort = "popular" | "new" | "asc" | "desc";

const swatches = [
  { name: "ground", cls: "bg-ground", hex: "#F6F3EE" },
  { name: "card", cls: "bg-card", hex: "#FFFFFF" },
  { name: "sunken", cls: "bg-sunken", hex: "#EFEAE2" },
  { name: "line", cls: "bg-line", hex: "#E8E3DA" },
  { name: "ink", cls: "bg-ink", hex: "#1B1B1F" },
  { name: "ink-2", cls: "bg-ink-2", hex: "#6B6760" },
  { name: "action", cls: "bg-action", hex: "#2F5BFF" },
  { name: "off", cls: "bg-off", hex: "#E4E0D8" },
  { name: "ok", cls: "bg-ok", hex: "#1F7A4D" },
  { name: "warn", cls: "bg-warn", hex: "#A8480A" },
  { name: "promo", cls: "bg-promo", hex: "#B3261E" },
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="text-lead font-semibold">{title}</h2>
      {note ? <p className="mt-1 max-w-prose text-small text-ink-2">{note}</p> : null}
      <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-6">{children}</div>
    </section>
  );
}

function Sample({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-2 text-caption text-ink-2">{label}</p>
      {children}
    </div>
  );
}

export function Gallery({ initialLocale }: { initialLocale: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const messages = getMessages(locale);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [brandId, setBrandId] = useState<string | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [cart, setCart] = useState<Record<string, number>>({ p1: 2 });
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("catalog");
  const [demoQty, setDemoQty] = useState(3);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!toastOpen) return;
    const timer = window.setTimeout(() => setToastOpen(false), 2800);
    return () => window.clearTimeout(timer);
  }, [toastOpen]);

  const cartCount = Object.values(cart).reduce((sum, n) => sum + n, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = Number(priceMin) || 0;
    const max = Number(priceMax) || Number.POSITIVE_INFINITY;
    const list = demoProducts.filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!brandId || p.brand?.toLowerCase() === brandId) &&
        (!inStockOnly || p.stockStatus !== "out") &&
        p.price >= min &&
        p.price <= max &&
        (!q || p.name.toLowerCase().includes(q) || p.article.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q)),
    );
    if (sort === "asc") return [...list].sort((a, b) => a.price - b.price);
    if (sort === "desc") return [...list].sort((a, b) => b.price - a.price);
    if (sort === "new") return [...list].reverse();
    return list;
  }, [query, category, brandId, inStockOnly, priceMin, priceMax, sort]);

  function setQuantity(id: string, quantity: number) {
    const was = cart[id] ?? 0;
    setCart((prev) => ({ ...prev, [id]: quantity }));
    if (was === 0 && quantity === 1) setToastOpen(true);
  }

  function toggleFavorite(id: string, on: boolean) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function resetFilters() {
    setCategory("all");
    setBrandId(null);
    setInStockOnly(false);
    setPriceMin("");
    setPriceMax("");
    setQuery("");
  }

  const c = messages.catalog;
  const tabs: TabItem[] = [
    { id: "home", label: messages.nav.home, icon: <House aria-hidden className="size-6" /> },
    { id: "catalog", label: messages.nav.catalog, icon: <LayoutGrid aria-hidden className="size-6" /> },
    { id: "favorites", label: messages.nav.favorites, icon: <Heart aria-hidden className="size-6" /> },
    { id: "cart", label: messages.nav.cart, icon: <ShoppingCart aria-hidden className="size-6" />, badge: cartCount },
    { id: "profile", label: messages.nav.profile, icon: <User aria-hidden className="size-6" /> },
  ];

  const filterPanel = (showBrands: boolean) => (
    <div className="flex flex-col gap-6">
      <FilterGroup title={c.filters}>
        <CheckboxRow label={c.inStockOnly} checked={inStockOnly} onChange={setInStockOnly} />
      </FilterGroup>
      <FilterGroup title={messages.product.article.length ? `${c.priceFrom} / ${c.priceTo}` : ""}>
        <div className="grid grid-cols-2 gap-3">
          <TextField label={c.priceFrom} value={priceMin} onChange={setPriceMin} inputMode="numeric" placeholder="0" />
          <TextField label={c.priceTo} value={priceMax} onChange={setPriceMax} inputMode="numeric" placeholder="100 000" />
        </div>
      </FilterGroup>
      {showBrands ? (
        <FilterGroup title={c.brands}>
          {demoBrands.map((b) => (
            <CheckboxRow
              key={b.id}
              label={b.name}
              checked={brandId === b.id}
              onChange={(on) => setBrandId(on ? b.id : null)}
              count={demoProducts.filter((p) => p.brand?.toLowerCase() === b.id).length}
            />
          ))}
        </FilterGroup>
      ) : null}
    </div>
  );

  const renderProduct = (p: DemoProduct) => {
    const props = {
      product: p,
      locale,
      messages,
      quantity: cart[p.id] ?? 0,
      onQuantityChange: (q: number) => setQuantity(p.id, q),
      media: <DemoArt kind={p.art} />,
    };
    return view === "grid" ? (
      <ProductCard key={p.id} {...props} favorite={favorites.has(p.id)} onFavoriteChange={(on) => toggleFavorite(p.id, on)} />
    ) : (
      <ProductRow key={p.id} {...props} />
    );
  };

  return (
    <>
      <AppHeader
        brand={messages.brand.name}
        trailing={
          <>
            <LanguageSwitch
              value={locale}
              onChange={setLocale}
              label={messages.language.label}
              options={[
                { locale: "uz", label: messages.language.uz },
                { locale: "ru", label: messages.language.ru },
              ]}
            />
            <span className="relative hidden lg:block">
              <IconButton aria-label={messages.nav.cart} icon={<ShoppingCart aria-hidden className="size-6" />} />
              {cartCount > 0 ? (
                <span className="tnum pointer-events-none absolute top-0.5 right-0 inline-flex min-w-4.5 items-center justify-center rounded-full bg-action px-1 text-[0.6875rem] leading-[1.125rem] font-bold text-white">
                  {cartCount}
                </span>
              ) : null}
            </span>
          </>
        }
      >
        <SearchField value={query} onChange={setQuery} placeholder={messages.search.placeholder} label={messages.search.label} clearLabel={messages.search.clear} />
      </AppHeader>

      <main className="mx-auto max-w-[1280px] px-4 pb-32 lg:px-6 lg:pb-20">
        <div className="grid gap-x-8 pt-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:pt-6">
          <aside className="hidden lg:block" aria-label={c.filters}>
            <div className="sticky top-24">{filterPanel(true)}</div>
          </aside>

          <div className="min-w-0">
            <h1 className="mb-3 text-lead font-bold lg:text-title">{messages.nav.catalog}</h1>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
              {(["all", "stationery", "grocery"] as const).map((key) => (
                <Chip key={key} selected={category === key} onClick={() => setCategory(key)}>
                  {c[key]}
                </Chip>
              ))}
            </div>
            <div className="mt-1">
              <BrandStrip brands={demoBrands} selectedId={brandId} onSelect={setBrandId} label={c.brands} />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="tnum text-small text-ink-2" aria-live="polite">
                {c.results(visible.length)}
              </p>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="sort">
                  {c.sort}
                </label>
                <select
                  id="sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-10 rounded-control border border-line bg-card px-3 text-small text-ink hover:border-line-strong pointer-coarse:h-11"
                >
                  <option value="popular">{c.sortPopular}</option>
                  <option value="new">{c.sortNew}</option>
                  <option value="asc">{c.sortPriceAsc}</option>
                  <option value="desc">{c.sortPriceDesc}</option>
                </select>
                <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
                  <SlidersHorizontal aria-hidden className="size-4" />
                  {c.filters}
                </Button>
                <div role="group" aria-label={c.viewGrid + " / " + c.viewList} className="hidden lg:flex">
                  <IconButton aria-label={c.viewGrid} pressed={view === "grid"} onClick={() => setView("grid")} icon={<Grid2x2 aria-hidden className="size-5" />} />
                  <IconButton aria-label={c.viewList} pressed={view === "list"} onClick={() => setView("list")} icon={<LayoutList aria-hidden className="size-5" />} />
                </div>
              </div>
            </div>

            <div className="mt-3">
              {visible.length === 0 ? (
                <EmptyState
                  title={messages.states.emptyTitle}
                  body={messages.states.emptyBody}
                  action={<Button variant="secondary" onClick={resetFilters}>{messages.states.clearFilters}</Button>}
                />
              ) : view === "grid" ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">{visible.map(renderProduct)}</div>
              ) : (
                <div className="overflow-hidden rounded-card border border-line">{visible.map(renderProduct)}</div>
              )}
            </div>
          </div>
        </div>

        <Section title="Design system" note="Dev gallery with synthetic demo data. Every component below is the one the storefront, the Mini App and the admin will use.">
          <Sample label="Colour tokens. Only “action” is saturated, and it is used only on things you can press.">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {swatches.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className={`size-8 shrink-0 rounded-control border border-line ${s.cls}`} />
                  <span className="text-caption leading-tight">
                    {s.name}
                    <br />
                    <span className="tnum font-mono text-ink-2">{s.hex}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Sample>
          <Sample label="Type scale (Onest). Prices and counts use tabular figures; articles use the mono face.">
            <p className="text-title font-bold">Guruch Mehr, 5 kg</p>
            <p className="text-lead font-semibold">48 500 soʻm · 48 500 сум</p>
            <p className="text-body">Oʻzbekcha: oʻ gʻ shaklidagi harflar va русские буквы bir xil shriftda.</p>
            <p className="text-small text-ink-2">Omborda bor · Осталось 3 шт.</p>
            <p className="tnum font-mono text-caption text-ink-2">EQ19-BL · 30C 1810-08 · 0123456789</p>
          </Sample>
        </Section>

        <Section title="Actions" note="Primary is the only filled control. Disabled controls lose the action colour entirely.">
          <Sample label="Primary">
            <div className="flex flex-wrap gap-3">
              <Button>{messages.product.add}</Button>
              <Button disabled>{messages.product.add}</Button>
              <Button loading>{messages.states.loading}</Button>
              <Button size="sm">{c.apply}</Button>
            </div>
          </Sample>
          <Sample label="Secondary and ghost">
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary">{c.reset}</Button>
              <Button variant="secondary" disabled>{c.reset}</Button>
              <Button variant="ghost">{messages.states.close}</Button>
            </div>
          </Sample>
          <Sample label="Add to cart: add button, in-cart stepper (in place), unavailable" className="w-full max-w-xl">
            <div className="grid grid-cols-3 gap-3">
              <AddToCart quantity={0} onChange={() => undefined} max={10} labels={messages.product} />
              <AddToCart quantity={demoQty} onChange={setDemoQty} max={5} labels={messages.product} />
              <AddToCart quantity={0} onChange={() => undefined} max={0} disabled labels={messages.product} />
            </div>
          </Sample>
          <Sample label="Quantity stepper at its minimum and its maximum">
            <div className="flex gap-3">
              <QuantityStepper value={1} min={1} onChange={() => undefined} labels={messages.product} />
              <QuantityStepper value={5} max={5} onChange={() => undefined} labels={messages.product} />
            </div>
          </Sample>
        </Section>

        <Section title="Product data" note="Stock always says it in words; the dot is only decoration. Out-of-stock items stay visible and cannot be added.">
          <Sample label="Stock">
            <div className="flex flex-col gap-2">
              <StockBadge status="in" label={messages.product.inStock} />
              <StockBadge status="low" label={messages.product.lowStock(3)} />
              <StockBadge status="out" label={messages.product.outOfStock} />
            </div>
          </Sample>
          <Sample label="Price: plain, with a real discount, unavailable">
            <div className="flex flex-col gap-2">
              <Price amount={48500} locale={locale} />
              <Price amount={6800} oldAmount={8000} locale={locale} />
              <Price amount={13900} locale={locale} muted />
              <Price amount={2084300} locale={locale} size="lg" />
            </div>
          </Sample>
        </Section>

        <Section title="Forms and filters">
          <Sample label="Text field: normal and error" className="w-64">
            <div className="flex flex-col gap-3">
              <TextField label={c.priceFrom} value="12000" onChange={() => undefined} inputMode="numeric" />
              <TextField label={c.priceTo} value="abc" onChange={() => undefined} error="Faqat raqam kiriting" />
            </div>
          </Sample>
          <Sample label="Checkbox rows" className="w-64">
            <CheckboxRow label={c.inStockOnly} checked onChange={() => undefined} />
            <CheckboxRow label="Deli" checked={false} onChange={() => undefined} count={4} />
          </Sample>
          <Sample label="Language switch (also in the header)">
            <LanguageSwitch
              value={locale}
              onChange={setLocale}
              label={messages.language.label}
              options={[
                { locale: "uz", label: "UZ" },
                { locale: "ru", label: "RU" },
              ]}
            />
          </Sample>
        </Section>

        <Section title="Feedback and states" note="Loading keeps the card footprint so the grid never jumps. Toasts are announced to screen readers.">
          <Sample label="Loading" className="w-full">
            <Button variant="secondary" size="sm" onClick={() => setLoading((v) => !v)}>
              {loading ? "Hide skeleton" : "Show skeleton"}
            </Button>
            {loading ? (
              <div aria-busy className="mt-3 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : null}
          </Sample>
          <Sample label="Toast" className="w-full max-w-sm">
            <Toast message={messages.states.addedToast} actionLabel={messages.nav.cart} onAction={() => setTab("cart")} onDismiss={() => undefined} dismissLabel={messages.states.close} />
          </Sample>
          <Sample label="Empty state" className="w-full max-w-md">
            <EmptyState title={messages.states.emptyTitle} body={messages.states.emptyBody} action={<Button variant="secondary">{messages.states.clearFilters}</Button>} />
          </Sample>
        </Section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <BottomTabBar items={tabs} activeId={tab} onSelect={setTab} label={messages.nav.mainNav} />
      </div>

      <ToastRegion>
        {toastOpen ? (
          <Toast message={messages.states.addedToast} actionLabel={messages.nav.cart} onAction={() => setTab("cart")} onDismiss={() => setToastOpen(false)} dismissLabel={messages.states.close} />
        ) : null}
      </ToastRegion>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={c.filters}
        closeLabel={messages.states.close}
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={resetFilters}>{c.reset}</Button>
            <Button onClick={() => setFiltersOpen(false)}>{c.apply}</Button>
          </div>
        }
      >
        {filterPanel(false)}
      </Sheet>
    </>
  );
}
