import {
  BookOpen,
  Cable,
  Cpu,
  Headphones,
  Laptop,
  Monitor,
  Package,
  PenLine,
  Printer,
  Smartphone,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Name keywords (uz + ru) → the pictures that say what the category is. First match wins. */
const RULES: [RegExp, LucideIcon[]][] = [
  [/kompyuter|компьютер|noutbuk|ноутбук|laptop/i, [Laptop, Wrench]],
  [/xizmat|услуг|taʻmir|ta'mir|tamir|ремонт|servis|сервис/i, [Wrench, Laptop]],
  [/monitor|монитор|ekran|экран/i, [Monitor]],
  [/telefon|телефон|smartfon|смартфон/i, [Smartphone]],
  [/printer|принтер|skaner|сканер/i, [Printer]],
  [/elektron|электрон|ehtiyot|комплект|protsessor|процессор/i, [Cpu]],
  [/quloqchin|наушник|audio|аудио/i, [Headphones]],
  [/kabel|кабел|aksessuar|аксессуар|zaryad|заряд/i, [Cable]],
  [/kanselyar|канцеляр|ruchka|ручк|qalam|карандаш|flomaster|фломастер/i, [PenLine]],
  [/daftar|тетрад|bloknot|блокнот|qogʻoz|qog'oz|qogoz|бумаг|kitob|книг|maktab|школ/i, [BookOpen]],
];

export function categoryIcons(name: string): LucideIcon[] {
  return RULES.find(([re]) => re.test(name))?.[1] ?? [Package];
}

/**
 * The default picture of a category that has neither its own uploaded picture nor product photos yet:
 * a soft tinted panel with one or two line icons chosen from the category name. Fills its (relative) parent.
 */
export function CategoryArt({ name, size = "lg" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const [Main, Second] = categoryIcons(name);
  const main = { sm: "size-5", md: "size-9", lg: "size-16" }[size];
  const second = { sm: "hidden", md: "size-5", lg: "size-8" }[size];
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#e8eefc_0%,#f4f6fb_55%,#eef1f7_100%)]"
    >
      <span className="absolute -top-1/4 -right-1/4 size-3/4 rounded-full bg-[#dfe7fb]" />
      <span className="absolute -bottom-1/3 -left-1/5 size-2/3 rounded-full bg-[#e9edf8]" />
      <span className="relative flex items-end gap-1">
        {Main ? <Main className={`${main} text-[#3b5bdb]`} strokeWidth={1.25} /> : null}
        {Second ? <Second className={`${second} text-[#3b5bdb]/60`} strokeWidth={1.5} /> : null}
      </span>
    </span>
  );
}
