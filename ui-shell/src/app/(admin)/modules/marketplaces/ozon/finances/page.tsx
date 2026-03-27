"use client";

import React from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

export default function OzonFinancesPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<any>(null);
  const [monthsAgo, setMonthsAgo] = React.useState(1);

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  const load = async (mAgo: number) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `${getGatewayBaseUrl()}/marketplaces/ozon/finances?months_ago=${encodeURIComponent(String(mAgo))}`,
        {
        headers: { Authorization: `Bearer ${getToken()}` },
        }
      );
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        setData(null);
        return;
      }
      setData(j);
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load(monthsAgo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsAgo]);

  const reportEntries = (data?.report && typeof data.report === "object") ? Object.entries<any>(data.report) : [];
  const filtered = query
    ? reportEntries.filter(([offerId]) => String(offerId).toLowerCase().includes(query.toLowerCase()))
    : reportEntries;

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-2">Ozon → Финансы</h1>
      <div className="text-sm text-gray-600 mb-4">
        Отчет за {data?.header_data?.month || "месяц"} ({data?.header_data?.start_date} — {data?.header_data?.stop_date})
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
          disabled={loading}
          onClick={() => load(monthsAgo)}
        >
          {loading ? "Загружаю..." : "Обновить"}
        </button>
        <select
          className="h-11 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          value={monthsAgo}
          onChange={(e) => setMonthsAgo(Number(e.target.value))}
          disabled={loading}
        >
          {Array.from({ length: 24 }).map((_, i) => {
            const v = i + 1;
            return (
              <option key={v} value={v}>
                {v === 1 ? "Прошлый месяц" : `${v} месяца назад`}
              </option>
            );
          })}
        </select>
        <input
          className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
          placeholder="Фильтр по offer_id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 whitespace-pre-line">
          {error}
        </div>
      )}

      {data?.all_totals && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs text-gray-500 mb-1">Денег к выплате</div>
            <div className="text-lg font-semibold">₽{data.all_totals.all_total_price_sum}</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs text-gray-500 mb-1">Чистая без опта</div>
            <div className="text-lg font-semibold">₽{data.all_totals.all_net_profit_sum}</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs text-gray-500 mb-1">После 6% налог</div>
            <div className="text-lg font-semibold">₽{data.all_totals.all_posttax_profit_sum}</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-xs text-gray-500 mb-1">Продано товара</div>
            <div className="text-lg font-semibold">{data.all_totals.all_quantity}</div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(([offerId, entries]) => {
          const totals = data?.summed_totals?.[offerId];
          return (
            <details key={offerId} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <summary className="cursor-pointer select-none">
                <span className="font-semibold">{offerId}</span>
                {totals ? (
                  <span className="ml-2 text-sm text-gray-600">
                    ₽{totals.posttax_profit_sum} ({totals.average_percent_posttax}%)
                    {totals.total_quantity < 3 ? "  ⚠ мало продаж" : ""}
                  </span>
                ) : null}
              </summary>
              <div className="mt-3 space-y-2">
                {Array.isArray(entries) &&
                  entries.map((e: any, idx: number) => (
                    <div key={idx} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                      <div className="font-medium">Выплата за {e.quantity} шт: {e.name}</div>
                      <div className="text-gray-700 dark:text-gray-300">
                        Зачислено: <span className="font-semibold">₽{e.payoff}</span>, опт: ₽{e.opt}, комиссии: ₽{e.fees}
                      </div>
                      <div className="text-gray-700 dark:text-gray-300">
                        Цена продажи: ₽{e.sale_price}
                      </div>
                      <div className="text-gray-700 dark:text-gray-300">
                        Прибыль: ₽{e.net_profit} ({e.net_profit_perc}%), после налога: ₽{e.posttax_profit} ({e.posttax_profit_perc}%)
                      </div>
                    </div>
                  ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

