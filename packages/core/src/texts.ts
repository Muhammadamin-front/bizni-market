import { formatPrice, type Locale } from "@shop/shared";

/** Customer-facing and staff-facing Telegram texts. Short, factual, in the customer's language. */
export const texts = {
  start: (locale: Locale) =>
    locale === "ru"
      ? "Добро пожаловать! Откройте магазин кнопкой ниже: канцелярия, электроника и компьютеры с актуальными ценами и наличием."
      : "Xush kelibsiz! Do‘konni pastdagi tugma orqali oching: kanselyariya, elektronika va kompyuterlar, joriy narx va qoldiq bilan.",
  openShop: (locale: Locale) => (locale === "ru" ? "Открыть магазин" : "Do‘konni ochish"),
  orderReceived: (locale: Locale, number: string, total: number) =>
    locale === "ru"
      ? `Заказ №${number} принят. Сумма: ${formatPrice(total, "ru")}. Мы свяжемся с вами для подтверждения.`
      : `№${number} buyurtma qabul qilindi. Summa: ${formatPrice(total, "uz")}. Tasdiqlash uchun siz bilan bog‘lanamiz.`,
  orderStatus: (locale: Locale, number: string, state: string) =>
    locale === "ru" ? `Заказ №${number}: статус «${state}».` : `№${number} buyurtma: holati «${state}».`,
  staffNewOrder: (number: string, channel: string, name: string, phone: string, total: number, items: number) =>
    `Yangi buyurtma №${number} (${channel})\n${name}, ${phone}\nPozitsiyalar: ${items}, summa: ${formatPrice(total, "uz")}`,
  syncAlert: (message: string) => `⚠️ Sinxronizatsiya ogohlantirishi: ${message}`,
};
