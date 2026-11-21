"use client";

import { useEffect, useState } from "react";
import { adminFetch, currency, useAdminData } from "@/components/admin/api";
import { useT } from "@/components/admin/i18n";
import { Card, Field, Notice, btn, btnPrimary, input } from "@/components/admin/ui";

type Opt = { id: string; name: string; stateType?: string };
interface Payload {
  settings: Record<string, unknown>;
  options: { priceTypes: Opt[]; stores: Opt[]; organizations: Opt[]; salesChannels: Opt[]; states: Opt[]; attributes: Opt[] } | null;
  optionsError: string | null;
  connected: boolean;
  demo: boolean;
}

export default function SettingsPage() {
  const t = useT();
  const { data, reload } = useAdminData<Payload>("/settings");
  const [s, setS] = useState<Record<string, unknown>>({});
  const [uomJson, setUomJson] = useState("{}");
  const [chatIds, setChatIds] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setS(data.settings);
    setUomJson(JSON.stringify(data.settings.qtyStepByUom ?? {}, null, 2));
    setChatIds(((data.settings.staffChatIds as number[]) ?? []).join(", "));
  }, [data]);

  if (!data) return <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p>;
  const o = data.options;
  const set = (k: string, v: unknown) => setS((prev) => ({ ...prev, [k]: v }));
  const select = (k: string, list: Opt[] | undefined, empty = t("— автоматически / не выбрано —", "— avtomatik / tanlanmagan —")) => (
    <select className={input} value={(s[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)}>
      <option value="">{empty}</option>
      {list?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
  const check = (k: string, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-small"><input type="checkbox" className="mt-0.5 size-4" checked={!!s[k]} onChange={(e) => set(k, e.target.checked)} /><span><span className="font-medium">{label}</span>{hint ? <span className="block text-caption text-ink-2">{hint}</span> : null}</span></label>
  );

  const save = async () => {
    setBusy(true);
    let uom: unknown;
    try { uom = JSON.parse(uomJson); } catch { setBusy(false); return setMsg({ tone: "bad", text: t("Шаги по единицам: некорректный JSON.", "Birlik qadamlari: JSON notoʻgʻri.") }); }
    const body = { ...s, qtyStepByUom: uom, staffChatIds: chatIds.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n !== 0) };
    const r = await adminFetch<{ resync?: string | null; issues?: unknown }>("/settings", { method: "PUT", body });
    setBusy(false);
    setMsg(
      r.ok
        ? { tone: "ok", text: r.data.resync ? t(`Сохранено. Запущена пересинхронизация (${r.data.resync}).`, `Saqlandi. Qayta sinxronizatsiya boshlandi (${r.data.resync}).`) : t("Сохранено.", "Saqlandi.") }
        : { tone: "bad", text: t("Не удалось сохранить: проверьте значения.", "Saqlab boʻlmadi: qiymatlarni tekshiring.") },
    );
    reload();
  };

  const ms = data.connected;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">{t("Настройки", "Sozlamalar")}</h1>
      {!ms ? (
        <Notice tone="ok">
          {t(
            "МойСклад не подключён: товары, остатки и заказы ведутся здесь, в админке. Настройки МойСклад появятся на этой странице после подключения.",
            "MoySklad ulanmagan: tovarlar, qoldiqlar va buyurtmalar shu yerda, admin panelda yuritiladi. MoySklad sozlamalari u ulangandan keyin shu sahifada chiqadi.",
          )}
        </Notice>
      ) : null}
      {data.optionsError && ms ? <Notice tone="bad">{t("Не удалось получить списки из МойСклад:", "MoySklad'dan roʻyxatlarni olib boʻlmadi:")} {data.optionsError}</Notice> : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {ms ? (
        <button
          className={`${btn} self-start`}
          onClick={async () => {
            const r = await adminFetch("/settings/autoconfigure", { body: {} });
            setMsg({ tone: r.ok ? "ok" : "bad", text: r.ok ? t("Однозначные значения подобраны автоматически.", "Aniq qiymatlar avtomatik tanlandi.") : t("Ошибка", "Xato") });
            reload();
          }}
        >
          {t("Подобрать автоматически", "Avtomatik tanlash")}
        </button>
      ) : null}

      <Card title={t("Магазин", "Doʻkon")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("Порог «осталось мало» (шт.)", "«Kam qoldi» chegarasi (dona)")} hint={t("Ниже — на карточке «Qoldi: N».", "Undan kam boʻlsa, kartochkada «Qoldi: N» chiqadi.")}><input className={input} type="number" min={1} value={(s.lowStockThreshold as number) ?? 5} onChange={(e) => set("lowStockThreshold", Number(e.target.value))} /></Field>
          <Field label={t("Фото на один товар (максимум)", "Bitta tovarga rasm (eng koʻpi)")}><input className={input} type="number" min={1} max={10} value={(s.maxImagesPerProduct as number) ?? 5} onChange={(e) => set("maxImagesPerProduct", Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></Field>
          <Field label={t(`Минимальная сумма заказа (${currency("ru")})`, `Eng kam buyurtma summasi (${currency("uz")})`)}><input className={input} type="number" min={0} value={(s.minimumOrderAmount as number) ?? 0} onChange={(e) => set("minimumOrderAmount", Number(e.target.value))} /></Field>
          <Field label={t("Префикс номера заказа (сайт / Telegram)", "Buyurtma raqami prefiksi (sayt / Telegram)")}><span className="flex gap-2"><input className={input} value={(s.orderPrefixWeb as string) ?? "W"} onChange={(e) => set("orderPrefixWeb", e.target.value)} /><input className={input} value={(s.orderPrefixTma as string) ?? "T"} onChange={(e) => set("orderPrefixTma", e.target.value)} /></span></Field>
          <Field label={t("Чаты сотрудников для уведомлений о заказах (id через запятую)", "Buyurtma xabarlari uchun xodimlar chatlari (id, vergul bilan)")} hint={t("Сюда бот пишет о каждом новом заказе.", "Bot har bir yangi buyurtma haqida shu yerga yozadi.")}><input className={input} value={chatIds} onChange={(e) => setChatIds(e.target.value)} placeholder="-1001234567890" /></Field>
        </div>
        <div className="mt-3 flex flex-col gap-2">{check("requireImage", t("Скрывать товары без фото", "Rasmsiz tovarlarni yashirish"))}</div>
      </Card>

      <Card title={t("Весовые товары", "Tortib sotiladigan tovarlar")}>
        <Field
          label={t("Шаг количества по единице измерения (JSON)", "Oʻlchov birligi boʻyicha miqdor qadami (JSON)")}
          hint={t('Единицы, которых нет в списке, продаются поштучно. Пример: {"kg": 0.1, "кг": 0.1, "l": 0.5}', 'Roʻyxatda yoʻq birliklar donalab sotiladi. Misol: {"kg": 0.1, "кг": 0.1, "l": 0.5}')}
        >
          <textarea className="min-h-28 rounded-control border border-line bg-card p-2 font-mono text-small" value={uomJson} onChange={(e) => setUomJson(e.target.value)} />
        </Field>
      </Card>

      {ms ? (
        <>
          <Card title={t("МойСклад: цены и остатки", "MoySklad: narxlar va qoldiqlar")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("Тип цены для сайта", "Sayt uchun narx turi")} hint={t("Розничная цена. Закупочная и минимальная никогда не читаются.", "Chakana narx. Xarid va minimal narxlar hech qachon olinmaydi.")}>{select("priceTypeId", o?.priceTypes)}</Field>
              <Field label={t("Тип цены «старая цена» (необязательно)", "«Eski narx» turi (ixtiyoriy)")} hint={t("Зачёркнутая цена показывается, только если она выше обычной.", "Ustidan chizilgan narx faqat oddiy narxdan yuqori boʻlsa koʻrsatiladi.")}>{select("oldPriceTypeId", o?.priceTypes, t("— нет —", "— yoʻq —"))}</Field>
              <Field label={t("Поле «Бренд» (доп. поле товара)", "«Brend» maydoni (tovarning qoʻshimcha maydoni)")} hint={t("Если не выбрано: бренд берётся из поставщика.", "Tanlanmasa, brend yetkazib beruvchidan olinadi.")}>{select("brandAttributeId", o?.attributes)}</Field>
            </div>
            <fieldset className="mt-3"><legend className="text-small font-medium">{t("Склады для остатка", "Qoldiq uchun omborlar")}</legend>
              <p className="text-caption text-ink-2">{t("Остаток = свободный остаток, сумма по отмеченным складам. Ничего не отмечено — все склады.", "Qoldiq = belgilangan omborlardagi boʻsh qoldiqlar yigʻindisi. Hech biri belgilanmasa, barcha omborlar.")}</p>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {o?.stores.map((st) => (
                  <label key={st.id} className="flex items-center gap-2 text-small"><input type="checkbox" className="size-4" checked={((s.storeIds as string[]) ?? []).includes(st.id)} onChange={(e) => { const cur = new Set((s.storeIds as string[]) ?? []); if (e.target.checked) cur.add(st.id); else cur.delete(st.id); set("storeIds", [...cur]); }} />{st.name}</label>
                ))}
              </div>
            </fieldset>
          </Card>

          <Card title={t("МойСклад: заказы", "MoySklad: buyurtmalar")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("Организация", "Tashkilot")}>{select("organizationId", o?.organizations)}</Field>
              <Field label={t("Склад заказа", "Buyurtma ombori")} hint={t("У заказа МойСклад один склад. Два магазина = два склада? Уточните у клиента.", "MoySklad buyurtmasida bitta ombor boʻladi. Ikki doʻkon = ikki ombormi? Mijozdan aniqlang.")}>{select("orderStoreId", o?.stores)}</Field>
              <Field label={t("Канал продаж", "Savdo kanali")}>{select("salesChannelId", o?.salesChannels, t("— не указывать —", "— koʻrsatilmasin —"))}</Field>
              <Field label={t("Начальный статус заказа", "Buyurtmaning boshlangʻich holati")}>{select("initialStateId", o?.states)}</Field>
              <Field label={t("Статус «подтверждён»", "«Tasdiqlangan» holati")}>{select("confirmedStateId", o?.states, t("— не используется —", "— ishlatilmaydi —"))}</Field>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {check("reserveOnCreateWeb", t("Резервировать товар при заказе с сайта", "Saytdan buyurtma kelganda tovarni band qilish"), t("По умолчанию выключено: анонимные заказы не должны блокировать остаток.", "Standart holatda oʻchiq: anonim buyurtmalar qoldiqni band qilmasligi kerak."))}
              {check("reserveOnCreateTma", t("Резервировать товар при заказе из Telegram", "Telegram'dan buyurtma kelganda tovarni band qilish"))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label={t("Контрагенты гостей", "Mehmon mijozlar (kontragentlar)")} hint={t("«Только созданные сайтом»: телефон гостя не привязывается к контрагенту, созданному сотрудниками.", "«Faqat sayt yaratganlar»: mehmonning telefoni xodimlar yaratgan kontragentga bogʻlanmaydi.")}>
                <select className={input} value={(s.counterpartyMatching as string) ?? "site-only"} onChange={(e) => set("counterpartyMatching", e.target.value)}>
                  <option value="site-only">{t("Только созданные сайтом (безопаснее)", "Faqat sayt yaratganlar (xavfsizroq)")}</option>
                  <option value="trust-phone">{t("Доверять телефону и привязывать", "Telefonga ishonib bogʻlash")}</option>
                </select>
              </Field>
              <Field label={t("Часовой пояс фильтров МойСклад (UTC+)", "MoySklad filtrlari vaqt mintaqasi (UTC+)")} hint={t("3 = Москва. Уточняется командой probe на реальном аккаунте.", "3 = Moskva. Haqiqiy akkauntda probe buyrugʻi bilan aniqlanadi.")}><input className={input} type="number" min={-12} max={14} step={1} value={(s.filterTimezoneOffsetHours as number) ?? 3} onChange={(e) => set("filterTimezoneOffsetHours", Number(e.target.value))} /></Field>
            </div>
          </Card>
        </>
      ) : null}

      <button className={`${btnPrimary} h-11 self-start px-6`} disabled={busy} onClick={save}>{busy ? t("Сохранение…", "Saqlanmoqda…") : t("Сохранить", "Saqlash")}</button>
    </div>
  );
}
