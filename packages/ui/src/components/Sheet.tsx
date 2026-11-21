"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./IconButton";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Bottom sheet on phones, centred panel from md up. Built on the native <dialog>, so focus is trapped,
 * Escape closes it and the page behind is inert without extra code.
 */
export function Sheet({ open, onClose, title, closeLabel, children, footer }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-card border border-line bg-card p-0 text-ink backdrop:bg-ink/40 open:animate-sheet md:inset-0 md:m-auto md:h-fit md:max-w-md md:rounded-card"
    >
      <div className="flex max-h-[88dvh] flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line py-1 pr-1 pl-4">
          <h2 id={titleId} className="text-lead font-semibold">
            {title}
          </h2>
          <IconButton aria-label={closeLabel} onClick={onClose} icon={<X aria-hidden className="size-5" />} />
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </dialog>
  );
}
