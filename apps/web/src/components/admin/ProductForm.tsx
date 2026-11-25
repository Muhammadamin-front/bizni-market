"use client";

import {
  getMessages,
  ManualProductInput,
  stockStatus,
  type AdminProductDetail,
  type AdminProductImage,
  type ProductCardData,
} from "@shop/shared";
import { ProductCard } from "@shop/ui";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AiProductTools } from "./ai";
import { adminFetch, currency, fmtMoney, useAdminData } from "./api";
import { useT, type AdminLang, type L, type T } from "./i18n";
import { uploadProductImage } from "./images";
import { Badge, Card, Field, Notice, btn, btnPrimary, input } from "./ui";

// ------------------------------------------------------------------------------------------------ form state

interface FormState {
  name: string;
  nameRu: string;
  categoryId: string;
  brand: string;
  description: string;
  descriptionRu: string;
  price: string;
  oldPrice: string;
  availableQty: string;
  uom: string;
  qtyStep: string;
  packSize: string;
  article: string;
  barcodes: string;
  hidden: boolean;
}

const EMPTY: FormState = { name: "", nameRu: "", categoryId: "", brand: "", description: "", descriptionRu: "", price: "", oldPrice: "", availableQty: "", uom: "dona", qtyStep: "", packSize: "", article: "", barcodes: "", hidden: false };

function fromDetail(d: AdminProductDetail): FormState {
  return {
    name: d.name,
    nameRu: d.nameRu,
    categoryId: d.categoryId ?? "",
    brand: d.brand,
    description: d.description,
    descriptionRu: d.descriptionRu,
    price: d.price ? String(d.price) : "",
    oldPrice: d.oldPrice ? String(d.oldPrice) : "",
    availableQty: String(d.availableQty),
    uom: d.uom,
    qtyStep: d.qtyStep && d.qtyStep !== 1 ? String(d.qtyStep) : "",
    packSize: d.packSize ? String(d.packSize) : "",
    article: d.article,
    barcodes: d.barcodes.join(", "),
    hidden: d.hidden,
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".").replace(/\s/g, "")));

function toInput(f: FormState) {
  return {
    name: f.name,
    nameRu: f.nameRu,
    categoryId: f.categoryId || null,
    brand: f.brand,
    description: f.description,
    descriptionRu: f.descriptionRu,
    price: num(f.price) ?? 0,
    oldPrice: num(f.oldPrice),
    availableQty: num(f.availableQty) ?? 0,
    uom: f.uom,
    qtyStep: num(f.qtyStep),
    packSize: num(f.packSize),
    article: f.article,
    barcodes: f.barcodes.split(/[\s,;]+/).map((b) => b.trim()).filter(Boolean),
    hidden: f.hidden,
  };
}

const FIELD_ERRORS: Record<string, L> = {
  name: { ru: "Название по-узбекски: от 2 символов.", uz: "Oʻzbekcha nomi: kamida 2 belgi." },
  nameRu: { ru: "Название по-русски: до 200 символов.", uz: "Ruscha nomi: 200 belgigacha." },
  price: { ru: "Цена: целое число сумов, без копеек.", uz: "Narx: butun son, soʻmda, tiyinsiz." },
  oldPrice: { ru: "Старая цена должна быть больше текущей — иначе это не скидка.", uz: "Eski narx hozirgidan katta boʻlishi kerak, aks holda bu chegirma emas." },
  availableQty: { ru: "Остаток: число от 0.", uz: "Qoldiq: 0 yoki undan katta son." },
  qtyStep: { ru: "Шаг: положительное число (например 0.1 для товара на вес).", uz: "Qadam: musbat son (masalan, tortib sotiladigan tovar uchun 0.1)." },
  packSize: { ru: "В упаковке: целое число от 1.", uz: "Qadoqda: 1 dan katta butun son." },
  barcodes: { ru: "Штрихкоды: только цифры и латинские буквы, 4–32 символа, через запятую.", uz: "Shtrixkodlar: faqat raqam va lotin harflari, 4–32 belgi, vergul bilan." },
  article: { ru: "Артикул: до 64 символов.", uz: "Artikul: 64 belgigacha." },
  description: { ru: "Описание: до 5000 символов.", uz: "Tavsif: 5000 belgigacha." },
  descriptionRu: { ru: "Описание по-русски: до 5000 символов.", uz: "Ruscha tavsif: 5000 belgigacha." },
  brand: { ru: "Бренд: до 80 символов.", uz: "Brend: 80 belgigacha." },
  uom: { ru: "Единица: до 16 символов.", uz: "Birlik: 16 belgigacha." },
};

function validate(f: FormState, lang: AdminLang): Record<string, string> {
  const parsed = ManualProductInput.safeParse(toInput(f));
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "name");
    out[key] ??= FIELD_ERRORS[key]?.[lang] ?? (lang === "uz" ? "Maydonni tekshiring." : "Проверьте поле.");
  }
  return out;
}

const UNITS = ["dona", "kg", "g", "l", "ml", "m", "pachka", "quti", "to‘plam", "juft", "шт", "кг", "л", "уп"];

// ------------------------------------------------------------------------------------------------ small inputs

/** Sums are typed as plain digits and shown grouped ("125 000"), the way prices are written in Uzbekistan. */
function MoneyInput({ value, onChange, id, invalid, placeholder }: { value: string; onChange: (v: string) => void; id: string; invalid?: boolean; placeholder?: string }) {
  const t = useT();
  const shown = value ? value.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "";
  return (
    <div className="relative">
      <input id={id} className={`${input} pr-12 tnum ${invalid ? "border-promo" : ""}`} inputMode="numeric" autoComplete="off" placeholder={placeholder} value={shown} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12))} aria-invalid={invalid || undefined} />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-caption text-ink-2">{currency(t.lang)}</span>
    </div>
  );
}

function Err({ text }: { text?: string }) {
  return text ? <span className="text-caption text-promo">{text}</span> : null;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <Card>
      <h2 className="text-lead font-semibold">{title}</h2>
      {hint ? <p className="mt-0.5 text-caption text-ink-2">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ categories

interface CatRow { id: string; name: string; parent_id: string | null; uz: string | null; ru: string | null; archived: boolean; sort_order: number }

export function categoryOptions(rows: CatRow[] | null): { id: string; label: string }[] {
  if (!rows) return [];
  const live = rows.filter((r) => !r.archived);
  const byParent = new Map<string | null, CatRow[]>();
  for (const r of live) {
    const key = r.parent_id && live.some((x) => x.id === r.parent_id) ? r.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push({ id: r.id, label: `${"   ".repeat(depth)}${depth ? "└ " : ""}${r.uz || r.ru || r.name}` });
      if (depth < 6) walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  const { data, reload } = useAdminData<CatRow[]>("/categories");
  const [adding, setAdding] = useState(false);
  const [uz, setUz] = useState("");
  const [ru, setRu] = useState("");
  const [error, setError] = useState("");
  const options = useMemo(() => categoryOptions(data), [data]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select id="f-category" className={input} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("— без категории —", "— kategoriyasiz —")}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button type="button" className={`${btn} shrink-0`} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{adding ? t("Отмена", "Bekor qilish") : t("+ Новая", "+ Yangi")}</button>
      </div>
      {adding ? (
        <div className="grid gap-2 rounded-control border border-line bg-sunken p-3 sm:grid-cols-[1fr_1fr_auto]">
          <input className={input} placeholder={t("Название (узбекский)", "Nomi (oʻzbekcha)")} value={uz} onChange={(e) => setUz(e.target.value)} aria-label={t("Название категории по-узбекски", "Kategoriya nomi oʻzbekcha")} />
          <input className={input} placeholder={t("Название (русский)", "Nomi (ruscha)")} value={ru} onChange={(e) => setRu(e.target.value)} aria-label={t("Название категории по-русски", "Kategoriya nomi ruscha")} />
          <button
            type="button"
            className={btnPrimary}
            onClick={async () => {
              const r = await adminFetch<{ id?: string }>("/categories", { body: { nameUz: uz, nameRu: ru, parentId: value || null } });
              if (!r.ok || !r.data.id) return setError(t("Введите название хотя бы на одном языке (от 2 букв).", "Nomini kamida bitta tilda kiriting (2 harfdan koʻp)."));
              setError("");
              setAdding(false);
              setUz("");
              setRu("");
              reload();
              onChange(r.data.id);
            }}
          >
            {t("Создать", "Yaratish")}
          </button>
          <p className="text-caption text-ink-2 sm:col-span-3">{value ? t("Будет создана внутри выбранной категории.", "Tanlangan kategoriya ichida yaratiladi.") : t("Будет создана как основная категория.", "Asosiy kategoriya sifatida yaratiladi.")} {t("Порядок и вложенность — в разделе «Категории».", "Tartib va joylashuv «Kategoriyalar» boʻlimida.")}</p>
          <Err text={error} />
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ photos

interface LocalPhoto { key: string; file: File; url: string; state: "queued" | "uploading" | "error"; error?: string }

function PhotoTile({ src, main, badge, children, warn, busy }: { src: string; main: boolean; badge?: ReactNode; children?: ReactNode; warn?: string; busy?: boolean }) {
  const t = useT();
  return (
    <li className="flex flex-col gap-1">
      <div className={`relative aspect-square overflow-hidden rounded-control border-2 bg-white ${main ? "border-action" : "border-line"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="size-full object-contain" />
        {main ? <span className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-full bg-action px-2 py-0.5 text-caption font-semibold text-white"><Star aria-hidden className="size-3" />{t("Главное", "Asosiy")}</span> : null}
        {badge}
        {busy ? <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 aria-label={t("Загрузка", "Yuklanmoqda")} className="size-6 animate-spin text-ink-2" /></span> : null}
      </div>
      {warn ? <p className="flex items-start gap-1 text-caption text-warn"><TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />{warn}</p> : null}
      <div className="flex flex-wrap gap-1">{children}</div>
    </li>
  );
}

const iconBtn = "inline-flex size-8 items-center justify-center rounded-control border border-line bg-card text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-40";

function softWarning(img: AdminProductImage, t: T): string | undefined {
  if (!img.width || !img.height) return undefined;
  return Math.max(img.width, img.height) < 500 ? t(`Маленькое фото (${img.width}×${img.height}) — может быть нечётким.`, `Kichik rasm (${img.width}×${img.height}), xira chiqishi mumkin.`) : undefined;
}

function Photos({
  saved,
  local,
  max,
  disabled,
  onPick,
  onMove,
  onDelete,
  onDeleteLocal,
  onMoveLocal,
}: {
  saved: AdminProductImage[];
  local: LocalPhoto[];
  max: number;
  disabled?: boolean;
  onPick: (files: File[]) => void;
  onMove: (id: string, to: number) => void;
  onDelete: (id: string) => void;
  onDeleteLocal: (key: string) => void;
  onMoveLocal: (key: string, to: number) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const count = saved.length + local.filter((l) => l.state !== "error").length;
  const full = count >= max;
  const pick = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (files.length) onPick(files.slice(0, Math.max(0, max - count)));
  };
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={disabled || full}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
        className={`flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${over ? "border-action bg-action/5" : "border-line-strong hover:border-action hover:bg-sunken"}`}
      >
        <ImagePlus aria-hidden className="size-8 text-ink-2" strokeWidth={1.5} />
        <span className="text-small font-semibold">{full ? t(`Уже ${max} фото — это максимум`, `${max} ta rasm bor, bu eng koʻpi`) : t("Добавить фото", "Rasm qoʻshish")}</span>
        <span className="text-caption text-ink-2">{t("Нажмите или перетащите сюда. С телефона — из галереи или камерой. Можно несколько сразу.", "Bosing yoki shu yerga sudrab tashlang. Telefondan: galereyadan yoki kamera bilan. Bir nechtasini birdan tanlash mumkin.")}</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />

      {saved.length + local.length > 0 ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {saved.map((img, i) => (
            <PhotoTile key={img.id} src={img.medium} main={i === 0} warn={softWarning(img, t)}>
              <button type="button" className={iconBtn} disabled={disabled || i === 0} onClick={() => onMove(img.id, i - 1)} aria-label={t("Сдвинуть левее", "Chapga surish")} title={t("Левее", "Chapga")}><ArrowLeft aria-hidden className="size-4" /></button>
              <button type="button" className={iconBtn} disabled={disabled || i === saved.length - 1} onClick={() => onMove(img.id, i + 1)} aria-label={t("Сдвинуть правее", "Oʻngga surish")} title={t("Правее", "Oʻngga")}><ArrowRight aria-hidden className="size-4" /></button>
              {i > 0 ? <button type="button" className={iconBtn} disabled={disabled} onClick={() => onMove(img.id, 0)} aria-label={t("Сделать главным", "Asosiy qilish")} title={t("Сделать главным", "Asosiy qilish")}><Star aria-hidden className="size-4" /></button> : null}
              <button type="button" className={`${iconBtn} hover:text-promo`} disabled={disabled} onClick={() => onDelete(img.id)} aria-label={t("Удалить фото", "Rasmni oʻchirish")} title={t("Удалить", "Oʻchirish")}><Trash2 aria-hidden className="size-4" /></button>
            </PhotoTile>
          ))}
          {local.map((l, i) => (
            <PhotoTile
              key={l.key}
              src={l.url}
              main={saved.length === 0 && i === 0}
              busy={l.state === "uploading"}
              badge={l.state === "queued" ? <span className="absolute right-1 bottom-1 rounded-full bg-ink/80 px-2 py-0.5 text-caption text-on-ink">{t("сохранится с товаром", "tovar bilan saqlanadi")}</span> : null}
              warn={l.state === "error" ? l.error : undefined}
            >
              {l.state === "queued" ? (
                <>
                  <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onMoveLocal(l.key, i - 1)} aria-label={t("Сдвинуть левее", "Chapga surish")}><ArrowLeft aria-hidden className="size-4" /></button>
                  <button type="button" className={iconBtn} disabled={i === local.length - 1} onClick={() => onMoveLocal(l.key, i + 1)} aria-label={t("Сдвинуть правее", "Oʻngga surish")}><ArrowRight aria-hidden className="size-4" /></button>
                </>
              ) : null}
              {l.state !== "uploading" ? <button type="button" className={`${iconBtn} hover:text-promo`} onClick={() => onDeleteLocal(l.key)} aria-label={t("Убрать фото", "Rasmni olib tashlash")}><Trash2 aria-hidden className="size-4" /></button> : null}
            </PhotoTile>
          ))}
        </ul>
      ) : null}
      <p className="text-caption text-ink-2">
        {t(
          `${count} из ${max}. Первое фото — на карточке в каталоге. Любое фото (вертикальное, широкое, PNG без фона) автоматически становится квадратом на белом фоне с ровными полями — оно не растянется и не обрежется ни на сайте, ни в Telegram.`,
          `${count} / ${max}. Birinchi rasm katalogdagi kartochkada chiqadi. Har qanday rasm (tik, keng, fonsiz PNG) avtomatik ravishda oq fonli, chetlari teng kvadratga aylanadi: saytda ham, Telegram'da ham choʻzilmaydi va kesilmaydi.`,
        )}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the form

export function ProductForm({ initial }: { initial?: AdminProductDetail }) {
  const t = useT();
  const router = useRouter();
  const isNew = !initial;
  const [detail, setDetail] = useState<AdminProductDetail | undefined>(initial);
  const [form, setForm] = useState<FormState>(initial ? fromDetail(initial) : EMPTY);
  const [baseline, setBaseline] = useState<FormState>(initial ? fromDetail(initial) : EMPTY);
  const [local, setLocal] = useState<LocalPhoto[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: brands } = useAdminData<string[]>("/brands");
  const maxImages = detail?.maxImages ?? 5;
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline) || local.some((l) => l.state === "queued");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  // Do not lose typed work by closing the tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Object URLs of local previews are freed when they leave the list.
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(local.map((l) => l.url));
    for (const u of urls.current) if (!live.has(u)) URL.revokeObjectURL(u);
    urls.current = live;
  }, [local]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const uploadAll = useCallback(async (productId: string, photos: LocalPhoto[]) => {
    let last: AdminProductDetail | undefined;
    const failed: LocalPhoto[] = [];
    for (const p of photos) {
      setLocal((list) => list.map((l) => (l.key === p.key ? { ...l, state: "uploading" } : l)));
      const r = await uploadProductImage<AdminProductDetail>(productId, p.file, t.lang);
      if (r.ok) {
        last = r.data;
        setDetail(r.data);
        setLocal((list) => list.filter((l) => l.key !== p.key));
      } else {
        failed.push(p);
        setLocal((list) => list.map((l) => (l.key === p.key ? { ...l, state: "error", error: r.error } : l)));
      }
    }
    return { last, failed };
  }, [t.lang]);

  const onPick = (files: File[]) => {
    const added: LocalPhoto[] = files.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file), state: "queued" }));
    setLocal((l) => [...l.filter((x) => x.state !== "error"), ...added]);
    if (detail) void uploadAll(detail.id, added);
  };

  const imageAction = async (fn: () => Promise<{ ok: boolean; data: AdminProductDetail | { error?: string } }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) setDetail(r.data as AdminProductDetail);
    else setMessage({ tone: "bad", text: t("Не удалось изменить фото. Обновите страницу.", "Rasmni oʻzgartirib boʻlmadi. Sahifani yangilang.") });
  };
  const moveSaved = (id: string, to: number) => {
    if (!detail) return;
    const ids = detail.images.map((i) => i.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    void imageAction(() => adminFetch<AdminProductDetail>(`/products/${detail.id}/images`, { method: "PUT", body: { ids } }));
  };
  const deleteSaved = (id: string) => {
    if (!detail || !window.confirm(t("Удалить это фото?", "Bu rasm oʻchirilsinmi?"))) return;
    void imageAction(() => adminFetch<AdminProductDetail>(`/products/${detail.id}/images/${id}`, { method: "DELETE" }));
  };
  const moveLocal = (key: string, to: number) =>
    setLocal((list) => {
      const item = list.find((l) => l.key === key);
      if (!item) return list;
      const rest = list.filter((l) => l.key !== key);
      rest.splice(Math.max(0, Math.min(to, rest.length)), 0, item);
      return rest;
    });

  const save = async (then: "stay" | "another" | "list" = "stay") => {
    const found = validate(form, t.lang);
    setErrors(found);
    if (Object.keys(found).length) {
      setMessage({ tone: "bad", text: t("Исправьте отмеченные поля.", "Belgilangan maydonlarni tuzating.") });
      document.getElementById(`f-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setMessage(null);
    const body = toInput(form);
    const r = isNew || !detail ? await adminFetch<AdminProductDetail & { error?: string }>("/products", { body }) : await adminFetch<AdminProductDetail & { error?: string }>(`/products/${detail.id}`, { method: "PUT", body });
    if (!r.ok) {
      setBusy(false);
      return setMessage({ tone: "bad", text: r.status === 400 ? t("Сервер не принял данные: проверьте поля.", "Server maʼlumotni qabul qilmadi: maydonlarni tekshiring.") : t(`Не сохранилось (ошибка ${r.status}).`, `Saqlanmadi (xato ${r.status}).`) });
    }
    setDetail(r.data);
    let failedPhotos = 0;
    const queued = local.filter((l) => l.state === "queued");
    if (queued.length) failedPhotos = (await uploadAll(r.data.id, queued)).failed.length;
    setBusy(false);
    const clean = fromDetail(r.data);
    if (failedPhotos) {
      setBaseline(clean);
      setForm(clean);
      if (isNew) router.replace(`/admin/products/${r.data.id}`);
      return setMessage({ tone: "warn", text: t(`Товар сохранён, но ${failedPhotos} фото не загрузились — см. причину под фото.`, `Tovar saqlandi, lekin ${failedPhotos} ta rasm yuklanmadi. Sababi rasm ostida yozilgan.`) });
    }
    if (then === "another") {
      // Batch entry: keep what usually repeats (category, brand, unit) and start the next product.
      const next = { ...EMPTY, categoryId: form.categoryId, brand: form.brand, uom: form.uom };
      setDetail(undefined);
      setForm(next);
      setBaseline(next);
      setLocal([]);
      setMessage({ tone: "ok", text: t(`«${r.data.name}» сохранён. Добавьте следующий товар.`, `«${r.data.name}» saqlandi. Keyingi tovarni qoʻshing.`) });
      if (!isNew) router.push("/admin/products/new");
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.getElementById("f-name")?.focus();
      return;
    }
    if (then === "list") return router.push("/admin/products");
    setBaseline(clean);
    setForm(clean);
    setMessage({ tone: "ok", text: t("Сохранено. На сайте и в Telegram изменения видны сразу.", "Saqlandi. Oʻzgarishlar saytda va Telegram'da darhol koʻrinadi.") });
    if (isNew) router.replace(`/admin/products/${r.data.id}`);
  };

  // Ctrl/Cmd+S saves, like any editor.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current("stay");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const remove = async () => {
    if (!detail || !window.confirm(t(`Удалить товар «${detail.name}»? Прошлые заказы с ним сохранятся.`, `«${detail.name}» tovari oʻchirilsinmi? U bilan qilingan eski buyurtmalar saqlanib qoladi.`))) return;
    setBusy(true);
    const r = await adminFetch(`/products/${detail.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) router.push("/admin/products");
    else setMessage({ tone: "bad", text: t("Не удалось удалить.", "Oʻchirib boʻlmadi.") });
  };

  // ------------------------------------------------------------------ live preview: the real storefront card
  const preview: ProductCardData = useMemo(() => {
    const i = toInput(form);
    const qty = Number.isFinite(i.availableQty) ? i.availableQty : 0;
    const price = Number.isFinite(i.price) ? i.price : 0;
    const firstLocal = local.find((l) => l.state !== "error");
    return {
      id: "preview",
      slug: "",
      name: (t.lang === "ru" ? form.nameRu.trim() || form.name : form.name) || t("Название товара", "Tovar nomi"),
      article: form.article,
      brand: form.brand.trim() || null,
      price,
      oldPrice: i.oldPrice && i.oldPrice > price ? i.oldPrice : null,
      packSize: i.packSize && Number.isInteger(i.packSize) ? i.packSize : null,
      unit: form.uom || null,
      qtyStep: i.qtyStep && i.qtyStep > 0 ? i.qtyStep : 1,
      stockStatus: stockStatus(qty),
      freeStock: qty,
      imageUrl: detail?.images[0]?.medium ?? firstLocal?.url ?? null,
    };
  }, [form, detail, local, t]);
  const messages = useMemo(() => getMessages(t.lang), [t.lang]);
  const price = num(form.price) ?? 0;
  const offStore = form.hidden || price <= 0 || detail?.archived;

  return (
    <form
      className="flex flex-col gap-4 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        void save("stay");
      }}
      noValidate
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/products" className="text-small text-link hover:underline">{t("← Все товары", "← Barcha tovarlar")}</Link>
          <h1 className="text-title font-bold">{isNew && !detail ? t("Новый товар", "Yangi tovar") : form.name || t("Товар", "Tovar")}</h1>
        </div>
        {detail && !isNew ? (
          <div className="flex flex-wrap gap-2">
            {!offStore ? <a className={btn} href={`/${t.lang}/p/${detail.slug}`} target="_blank" rel="noreferrer">{t("Открыть на сайте ↗", "Saytda ochish ↗")}</a> : null}
            <button type="button" className={`${btn} text-promo`} onClick={remove} disabled={busy}>{t("Удалить товар", "Tovarni oʻchirish")}</button>
          </div>
        ) : null}
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t("Фото", "Rasmlar")}>
            <Photos
              saved={detail?.images ?? []}
              local={local}
              max={maxImages}
              disabled={busy}
              onPick={onPick}
              onMove={moveSaved}
              onDelete={deleteSaved}
              onDeleteLocal={(key) => setLocal((l) => l.filter((x) => x.key !== key))}
              onMoveLocal={moveLocal}
            />
          </Section>

          <Section title={t("Основное", "Asosiy maʼlumot")}>
            <p className="text-caption text-ink-2">
              {t(
                "Название и описание вводятся на двух языках: узбекский — для сайта /uz и Mini App на узбекском, русский — для /ru и Mini App на русском. Если русское поле пустое, там покажется узбекский текст.",
                "Nomi va tavsif ikki tilda kiritiladi: oʻzbekchasi /uz sayt va oʻzbekcha Mini App uchun, ruschasi /ru sayt va ruscha Mini App uchun. Ruscha maydon boʻsh qolsa, u yerda oʻzbekcha matn chiqadi.",
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Название (узбекский) *", "Nomi (oʻzbekcha) *")} hint={t("Так, как его ищут покупатели: что это, марка, размер/вес. Например: «Daftar 48 varaq, katak».", "Xaridorlar qanday qidirsa, shunday yozing: nima ekani, markasi, oʻlchami yoki ogʻirligi. Masalan: «Daftar 48 varaq, katak».")}>
                <input id="f-name" lang="uz" className={`${input} ${errors.name ? "border-promo" : ""}`} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus={isNew} />
                <Err text={errors.name} />
              </Field>
              <Field label={t("Название (русский)", "Nomi (ruscha)")} hint={t("Например: «Тетрадь 48 листов, клетка». Пусто — на русском сайте будет узбекское название.", "Masalan: «Тетрадь 48 листов, клетка». Boʻsh qolsa, ruscha saytda oʻzbekcha nomi chiqadi.")}>
                <input id="f-nameRu" lang="ru" className={`${input} ${errors.nameRu ? "border-promo" : ""}`} value={form.nameRu} onChange={(e) => set("nameRu", e.target.value)} maxLength={200} />
                <Err text={errors.nameRu} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 text-small">
                <label htmlFor="f-category" className="font-medium">{t("Категория", "Kategoriya")}</label>
                <CategoryPicker value={form.categoryId} onChange={(id) => set("categoryId", id)} />
              </div>
              <Field label={t("Бренд", "Brend")} hint={t("Начните вводить — подскажем из уже существующих. Новый создастся сам.", "Yoza boshlang, mavjudlaridan taklif qilamiz. Yangisi oʻzi yaratiladi.")}>
                <input id="f-brand" className={input} list="brand-list" value={form.brand} onChange={(e) => set("brand", e.target.value)} maxLength={80} />
                <datalist id="brand-list">{brands?.map((b) => <option key={b} value={b} />)}</datalist>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Описание (узбекский)", "Tavsif (oʻzbekcha)")} hint={t("Необязательно. Показывается на странице товара.", "Ixtiyoriy. Tovar sahifasida koʻrsatiladi.")}>
                <textarea id="f-description" lang="uz" className="min-h-28 rounded-control border border-line bg-card p-2.5 text-small hover:border-line-strong focus:border-action focus:outline-none" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={5000} />
                <Err text={errors.description} />
              </Field>
              <Field label={t("Описание (русский)", "Tavsif (ruscha)")} hint={t("Необязательно. Пусто — на русском сайте будет узбекское описание.", "Ixtiyoriy. Boʻsh qolsa, ruscha saytda oʻzbekcha tavsif chiqadi.")}>
                <textarea id="f-descriptionRu" lang="ru" className="min-h-28 rounded-control border border-line bg-card p-2.5 text-small hover:border-line-strong focus:border-action focus:outline-none" value={form.descriptionRu} onChange={(e) => set("descriptionRu", e.target.value)} maxLength={5000} />
                <Err text={errors.descriptionRu} />
              </Field>
            </div>
            <AiProductTools form={form} apply={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          </Section>

          <Section title={t("Цена и наличие", "Narx va qoldiq")}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("Цена *", "Narx *")}>
                <MoneyInput id="f-price" value={form.price} onChange={(v) => set("price", v)} invalid={!!errors.price} placeholder="0" />
                <Err text={errors.price} />
              </Field>
              <Field label={t("Старая цена", "Eski narx")} hint={t("Для скидки: будет зачёркнута.", "Chegirma uchun: ustidan chiziladi.")}>
                <MoneyInput id="f-oldPrice" value={form.oldPrice} onChange={(v) => set("oldPrice", v)} invalid={!!errors.oldPrice} />
                <Err text={errors.oldPrice} />
              </Field>
              <Field label={t("Остаток *", "Qoldiq *")} hint={t("Заказ уменьшает, отмена заказа возвращает.", "Buyurtma kamaytiradi, bekor qilinsa qaytadi.")}>
                <input id="f-availableQty" className={`${input} tnum ${errors.availableQty ? "border-promo" : ""}`} inputMode="decimal" value={form.availableQty} onChange={(e) => set("availableQty", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" />
                <Err text={errors.availableQty} />
              </Field>
            </div>
            {price > 0 && num(form.oldPrice) && (num(form.oldPrice) ?? 0) > price ? (
              <p className="text-caption text-ok">{t("Скидка", "Chegirma")} {Math.round((1 - price / (num(form.oldPrice) ?? 1)) * 100)}%: {fmtMoney(num(form.oldPrice) ?? 0, t.lang)} → {fmtMoney(price, t.lang)}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("Единица", "Birlik")} hint="dona, kg, l, pachka…">
                <input id="f-uom" className={input} list="unit-list" value={form.uom} onChange={(e) => set("uom", e.target.value)} maxLength={16} />
                <datalist id="unit-list">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
              </Field>
              <Field label={t("Шаг количества", "Miqdor qadami")} hint={t("Пусто = авто (кг и л — дробно, остальное по 1).", "Boʻsh = avto (kg va l kasr bilan, qolganlari 1 tadan).")}>
                <input id="f-qtyStep" className={`${input} tnum`} inputMode="decimal" value={form.qtyStep} onChange={(e) => set("qtyStep", e.target.value.replace(/[^\d.,]/g, ""))} placeholder={t("авто", "avto")} />
                <Err text={errors.qtyStep} />
              </Field>
              <Field label={t("Штук в упаковке", "Qadoqdagi soni")} hint={t("Необязательно, для подписи «12 dona/pachka».", "Ixtiyoriy, «12 dona/pachka» yozuvi uchun.")}>
                <input id="f-packSize" className={`${input} tnum`} inputMode="numeric" value={form.packSize} onChange={(e) => set("packSize", e.target.value.replace(/\D/g, ""))} />
                <Err text={errors.packSize} />
              </Field>
            </div>
          </Section>

          <Section title={t("Коды", "Kodlar")} hint={t("Необязательно. По артикулу и штрихкоду товар находится в поиске.", "Ixtiyoriy. Tovarni artikul va shtrixkod orqali qidirib topish mumkin.")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Артикул", "Artikul")}>
                <input id="f-article" className={`${input} font-mono`} value={form.article} onChange={(e) => set("article", e.target.value)} maxLength={64} />
                <Err text={errors.article} />
              </Field>
              <Field label={t("Штрихкоды", "Shtrixkodlar")} hint={t("Через запятую, если несколько.", "Bir nechta boʻlsa, vergul bilan.")}>
                <input id="f-barcodes" className={`${input} font-mono`} inputMode="numeric" value={form.barcodes} onChange={(e) => set("barcodes", e.target.value)} />
                <Err text={errors.barcodes} />
              </Field>
            </div>
          </Section>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-16">
          <Card>
            <p className="mb-2 text-small font-semibold">{t("Так увидят покупатели", "Xaridorlar shunday koʻradi")}</p>
            <p className="mb-3 text-caption text-ink-2">{t("Сайт и Telegram Mini App — одна и та же карточка.", "Sayt va Telegram Mini App'da bir xil kartochka.")}</p>
            <div className="mx-auto max-w-[13rem]">
              <ProductCard product={preview} locale={t.lang} messages={messages} quantity={0} onQuantityChange={() => undefined} />
            </div>
          </Card>
          <Card>
            <label className="flex items-start gap-2 text-small">
              <input type="checkbox" className="mt-0.5 size-4" checked={!form.hidden} onChange={(e) => set("hidden", !e.target.checked)} />
              <span>
                <span className="font-medium">{t("Показывать в магазине", "Doʻkonda koʻrsatish")}</span>
                <span className="block text-caption text-ink-2">{t("Снимите галочку, чтобы временно скрыть товар.", "Tovarni vaqtincha yashirish uchun belgini olib tashlang.")}</span>
              </span>
            </label>
            <div className="mt-3">
              {offStore ? (
                <Badge tone="warn">{form.hidden ? t("Скрыт", "Yashirilgan") : price <= 0 ? t("Не виден: нет цены", "Koʻrinmaydi: narx yoʻq") : t("В архиве", "Arxivda")}</Badge>
              ) : (
                <Badge tone="ok">{(num(form.availableQty) ?? 0) > 0 ? t("Виден и продаётся", "Koʻrinadi va sotilmoqda") : t("Виден, но нет в наличии", "Koʻrinadi, lekin qoldiq yoʻq")}</Badge>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 px-4 py-3 backdrop-blur lg:left-56">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <button type="submit" className={`${btnPrimary} h-11 px-5`} disabled={busy}>{busy ? t("Сохранение…", "Saqlanmoqda…") : t("Сохранить", "Saqlash")}</button>
          <button type="button" className={`${btn} h-11`} disabled={busy} onClick={() => void save("another")}>{t("Сохранить и добавить ещё", "Saqlash va yana qoʻshish")}</button>
          <span className="ml-auto text-caption text-ink-2">{dirty ? t("Есть несохранённые изменения · Ctrl+S", "Saqlanmagan oʻzgarishlar bor · Ctrl+S") : detail ? t("Всё сохранено", "Hammasi saqlangan") : ""}</span>
        </div>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ MoySklad product: read-only

export function MoyskladProductView({ detail, onChanged }: { detail: AdminProductDetail; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Link href="/admin/products" className="text-small text-link hover:underline">{t("← Все товары", "← Barcha tovarlar")}</Link>
      <h1 className="text-title font-bold">{detail.name}</h1>
      <Notice tone="ok">{t("Этот товар приходит из МойСклад: название, цена, остаток и фото меняются там и подтягиваются сюда автоматически. Здесь его можно только скрыть с витрины.", "Bu tovar MoySklad'dan keladi: nomi, narxi, qoldigʻi va rasmlari oʻsha yerda oʻzgartiriladi va bu yerga avtomatik tortiladi. Bu yerda uni faqat saytdan yashirish mumkin.")}</Notice>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
          <dt className="text-ink-2">{t("Цена", "Narx")}</dt><dd className="tnum">{detail.price > 0 ? fmtMoney(detail.price, t.lang) : t("нет цены", "narx yoʻq")}{detail.oldPrice ? <s className="ml-2 text-ink-2">{fmtMoney(detail.oldPrice, t.lang)}</s> : null}</dd>
          <dt className="text-ink-2">{t("Остаток", "Qoldiq")}</dt><dd className="tnum">{detail.availableQty} {detail.uom}</dd>
          <dt className="text-ink-2">{t("Артикул", "Artikul")}</dt><dd className="font-mono">{detail.article || "—"}</dd>
          <dt className="text-ink-2">{t("Бренд", "Brend")}</dt><dd>{detail.brand || "—"}</dd>
        </dl>
        {detail.images.length ? (
          <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {detail.images.map((i) => (
              <li key={i.id} className="aspect-square overflow-hidden rounded-control border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.medium ? <img src={i.medium} alt="" className="size-full object-contain" /> : <span className="flex size-full items-center justify-center text-caption text-ink-2">{i.status}</span>}
              </li>
            ))}
          </ul>
        ) : null}
        <button
          className={`${btn} mt-4`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await adminFetch(`/products/${detail.id}`, { method: "PATCH", body: { hidden: !detail.hidden } });
            setBusy(false);
            onChanged();
          }}
        >
          {detail.hidden ? t("Показать на витрине", "Saytda koʻrsatish") : t("Скрыть с витрины", "Saytdan yashirish")}
        </button>
      </Card>
    </div>
  );
}
