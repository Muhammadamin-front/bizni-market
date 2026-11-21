import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-title font-bold">404</h1>
      <p className="max-w-sm text-ink-2">Sahifa topilmadi / Страница не найдена</p>
      <Link href="/" className="inline-flex h-11 items-center rounded-control bg-action px-5 font-semibold text-white hover:bg-action-press">Bosh sahifa / Главная</Link>
    </div>
  );
}
