import { formatPrice, type Locale } from "@shop/shared";

/** Customer-facing and staff-facing Telegram texts. Short, factual, in the customer's language. */
export const texts = {
  start: (locale: Locale) =>
    locale === "ru"
      ? "Добро пожаловать! Откройте магазин кнопкой ниже: компьютеры, компьютерные услуги и канцелярия с актуальными ценами и наличием."
      : "Xush kelibsiz! Do‘konni pastdagi tugma orqali oching: kompyuterlar, kompyuter xizmatlari va kanselyariya, joriy narx va qoldiq bilan.",
  openShop: (locale: Locale) => (locale === "ru" ? "Открыть магазин" : "Do‘konni ochish"),
  orderReceived: (locale: Locale, number: string, total: number) =>
    locale === "ru"
      ? `Заказ №${number} принят. Сумма: ${formatPrice(total, "ru")}. Мы свяжемся с вами для подтверждения.`
      : `№${number} buyurtma qabul qilindi. Summa: ${formatPrice(total, "uz")}. Tasdiqlash uchun siz bilan bog‘lanamiz.`,
  orderStatus: (locale: Locale, number: string, state: string) =>
    locale === "ru" ? `Заказ №${number}: статус «${state}».` : `№${number} buyurtma: holati «${state}».`,
  staffNewOrder: (o: { number: string; channel: string; name: string; phone: string; total: number; delivery: boolean; address: string; comment: string; items: { name: string; qty: number; sum: number }[] }) =>
    [
      `🛒 Yangi buyurtma №${o.number} (${o.channel})`,
      `${o.name}, ${o.phone}`,
      o.delivery ? `Yetkazib berish: ${o.address || "manzil koʻrsatilmagan"}` : "Olib ketish",
      ...(o.comment ? [`Izoh: ${o.comment}`] : []),
      "",
      ...o.items.map((i) => `• ${i.name} × ${i.qty} = ${formatPrice(i.sum, "uz")}`),
      "",
      `Jami: ${formatPrice(o.total, "uz")}`,
    ].join("\n"),
  syncAlert: (message: string) => `⚠️ Sinxronizatsiya ogohlantirishi: ${message}`,
};
