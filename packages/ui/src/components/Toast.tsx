"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";

/** Live region that announces toasts to screen readers. Mount once near the app root, above the tab bar. */
export function ToastRegion({ children }: { children?: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {children}
    </div>
  );
}

export interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  dismissLabel: string;
}

export function Toast({ message, actionLabel, onAction, onDismiss, dismissLabel }: ToastProps) {
  return (
    <div className="pointer-events-auto flex w-full max-w-sm animate-toast items-center gap-1 rounded-card bg-ink py-1 pr-1 pl-4 text-small text-on-ink">
      <p className="flex-1 py-2">{message}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="h-10 rounded-control px-3 font-semibold text-on-ink underline underline-offset-4 hover:bg-on-ink/10">
          {actionLabel}
        </button>
      ) : null}
      <IconButton aria-label={dismissLabel} onClick={onDismiss} className="text-on-ink hover:bg-on-ink/10" icon={<X aria-hidden className="size-5" />} />
    </div>
  );
}
