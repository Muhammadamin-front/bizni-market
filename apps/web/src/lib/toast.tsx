"use client";

import { Toast, ToastRegion } from "@shop/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";

interface Item {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const Ctx = createContext<{ show: (message: string, action?: { label: string; run: () => void }) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { messages } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (message: string, action?: { label: string; run: () => void }) => {
      const id = next.current++;
      setItems((list) => [...list.slice(-2), { id, message, actionLabel: action?.label, onAction: action?.run }]);
      timers.current.set(id, setTimeout(() => dismiss(id), 3500));
    },
    [dismiss],
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastRegion>
        {items.map((i) => (
          <Toast key={i.id} message={i.message} actionLabel={i.actionLabel} onAction={i.onAction} onDismiss={() => dismiss(i.id)} dismissLabel={messages.states.close} />
        ))}
      </ToastRegion>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}
