export const LOCALES = ["uz", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "uz";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Interface strings. Catalog content (product names, descriptions) is NOT translated: it comes from MoySklad as entered. */
export interface Messages {
  brand: { name: string };
  nav: { home: string; catalog: string; favorites: string; cart: string; profile: string; mainNav: string };
  language: { label: string; uz: string; ru: string };
  search: { placeholder: string; label: string; clear: string };
  catalog: {
    all: string;
    stationery: string;
    grocery: string;
    categories: string;
    brands: string;
    filters: string;
    sort: string;
    inStockOnly: string;
    priceFrom: string;
    priceTo: string;
    apply: string;
    reset: string;
    results: (n: number) => string;
    viewGrid: string;
    viewList: string;
    sortPopular: string;
    sortNew: string;
    sortPriceAsc: string;
    sortPriceDesc: string;
  };
  product: {
    add: string;
    inCart: string;
    inStock: string;
    lowStock: (n: number) => string;
    outOfStock: string;
    article: string;
    perPack: (n: number) => string;
    increase: string;
    decrease: string;
    quantity: string;
    favorite: string;
    unfavorite: string;
  };
  states: {
    emptyTitle: string;
    emptyBody: string;
    clearFilters: string;
    addedToast: string;
    loading: string;
    close: string;
  };
  home: {
    heroTitle: string;
    heroBody: string;
    categories: string;
    brands: string;
    allBrands: string;
    featured: string;
    newArrivals: string;
    offers: string;
    bestsellers: string;
    viewAll: string;
    demoBanner: string;
    emptyTitle: string;
    emptyBody: string;
    slidePrev: string;
    slideNext: string;
    slideOf: (n: number, total: number) => string;
    products: (n: number) => string;
    open: string;
  };
  listing: {
    page: (n: number, total: number) => string;
    prev: string;
    next: string;
    resultsFor: (q: string) => string;
    allCategories: string;
    categoryHeading: string;
    brandHeading: string;
    suggestProducts: string;
    suggestCategories: string;
    suggestBrands: string;
    searchAll: (q: string) => string;
    closeFilters: string;
    showResults: (n: number) => string;
    breadcrumbs: string;
  };
  productPage: {
    description: string;
    details: string;
    unit: string;
    barcode: string;
    related: string;
    imageOf: (i: number, n: number) => string;
    noPhoto: string;
  };
  cart: {
    title: string;
    empty: string;
    emptyBody: string;
    goCatalog: string;
    subtotal: string;
    total: string;
    proceed: string;
    remove: string;
    items: (n: number) => string;
    unavailable: string;
    onlyLeft: (n: number) => string;
    minimum: (amount: string) => string;
    priceUpdated: string;
    clear: string;
    loading: string;
  };
  checkout: {
    title: string;
    contact: string;
    name: string;
    phone: string;
    phoneHelp: string;
    deliveryMethod: string;
    delivery: string;
    pickup: string;
    address: string;
    addressHelp: string;
    comment: string;
    summary: string;
    submit: string;
    submitting: string;
    payNote: string;
    fixLines: string;
    errors: {
      name: string;
      phone: string;
      address: string;
      generic: string;
      lines: string;
      rate: string;
      challenge: string;
      minimum: (amount: string) => string;
      network: string;
    };
  };
  order: {
    thanks: string;
    number: (n: string) => string;
    status: string;
    received: string;
    sending: string;
    items: string;
    total: string;
    deliveryTo: string;
    pickup: string;
    contact: string;
    keepLink: string;
    backToShop: string;
    myOrders: string;
    noOrders: string;
    placedAt: string;
    refresh: string;
  };
  footer: {
    contacts: string;
    info: string;
    about: string;
    delivery: string;
    offer: string;
    privacy: string;
    rights: (name: string) => string;
    openBot: string;
    admin: string;
  };
  profile: {
    title: string;
    name: string;
    phone: string;
    language: string;
    save: string;
    saved: string;
    orders: string;
    connecting: string;
    needTelegram: string;
    devNotice: string;
  };
  errors: {
    title: string;
    body: string;
    retry: string;
    notFoundTitle: string;
    notFoundBody: string;
  };
}
