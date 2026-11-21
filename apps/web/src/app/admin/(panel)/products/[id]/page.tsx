"use client";

import type { AdminProductDetail } from "@shop/shared";
import { use } from "react";
import { useAdminData } from "@/components/admin/api";
import { useT } from "@/components/admin/i18n";
import { MoyskladProductView, ProductForm } from "@/components/admin/ProductForm";
import { Notice } from "@/components/admin/ui";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const { data, loading, error, reload } = useAdminData<AdminProductDetail>(`/products/${id}`);
  if (loading && !data) return <p className="text-ink-2">{t("Загрузка…", "Yuklanmoqda…")}</p>;
  if (!data) {
    return (
      <Notice tone="bad">
        {error === 404 ? t("Товар не найден (возможно, удалён).", "Tovar topilmadi (oʻchirilgan boʻlishi mumkin).") : t(`Не удалось загрузить${error ? ` (ошибка ${error})` : ""}`, `Yuklab boʻlmadi${error ? ` (xato ${error})` : ""}`)}
      </Notice>
    );
  }
  if (data.source !== "manual") return <MoyskladProductView detail={data} onChanged={reload} />;
  // key: a different product (e.g. after "save and add another") starts from a fresh form
  return <ProductForm key={data.id} initial={data} />;
}
