"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";

type CallbackReminder = {
  id: string;
  order_id: string;
  order_number: number | null;
  serial_model: string;
  callback_date: string;
};

export default function CallbackReminderBanner() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<CallbackReminder[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>({});

  const authHeaders = useCallback(async () => {
    let token = String((window as any).__hubcrmAccessToken || "").trim();
    if (!token) {
      const kc = await getKeycloak();
      await kc.updateToken(30).catch(() => undefined);
      token = kc.token || "";
      if (token) (window as any).__hubcrmAccessToken = token;
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    const resp = await fetch(`${base}/orders/orders/callback-reminders/due?limit=5`, { cache: "no-store", headers });
    if (!resp.ok) return;
    setItems((await resp.json()) as CallbackReminder[]);
  }, [authHeaders, base]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = items.find((item) => !hiddenIds[item.id]);
  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[320px] rounded-xl border border-orange-200 bg-white p-4 shadow-lg dark:border-orange-500/30 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800 dark:text-white/90">Нужно отзвониться</div>
        <button
          type="button"
          onClick={() => setHiddenIds((prev) => ({ ...prev, [visible.id]: true }))}
          className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          Скрыть
        </button>
      </div>
      <div className="text-sm text-gray-700 dark:text-gray-200">
        {visible.order_number ? `Заказ #${visible.order_number}` : "Заказ без номера"}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Дата звонка: {new Date(`${visible.callback_date}T00:00:00`).toLocaleDateString("ru-RU")}
      </div>
      <Link
        href={`/modules/orders/list?order_ids=${encodeURIComponent(visible.order_id)}&open_order_id=${encodeURIComponent(visible.order_id)}`}
        className="mt-3 inline-flex rounded-lg border border-orange-300 bg-orange-100 px-3 py-1.5 text-sm text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300"
      >
        Открыть заказ
      </Link>
    </div>
  );
}
