"use client";

import React from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

type StockWarehouse = {
  warehouse_id: number;
  warehouse_name: string;
  region_name: string;
  quantity: number;
  in_way_to_client: number;
  in_way_from_client: number;
};

type StockItem = {
  offer_id: string;
  nm_id: number;
  total_quantity: number;
  warehouses?: StockWarehouse[];
};

export default function WbFboStocksPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<StockItem[]>([]);
  const [withoutStocks, setWithoutStocks] = React.useState<StockItem[]>([]);
  const [updatedAt, setUpdatedAt] = React.useState("");
  const loadedRef = React.useRef(false);

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  const load = async (mode: "cache" | "live" = "cache") => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fbo/stocks?mode=${mode}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        setItems([]);
        setWithoutStocks([]);
        return;
      }
      setItems(Array.isArray(j?.items) ? j.items : []);
      setWithoutStocks(Array.isArray(j?.without_stocks) ? j.without_stocks : []);
      setUpdatedAt(j?.updated_at ? String(j.updated_at) : "");
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
      setWithoutStocks([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, []);

  const matchesQuery = (item: StockItem) =>
    query
      ? item.offer_id.toLowerCase().includes(query.toLowerCase()) || String(item.nm_id).includes(query)
      : true;
  const filteredItems = items.filter(matchesQuery);
  const filteredWithoutStocks = withoutStocks.filter(matchesQuery);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-2">WB / FBO / Остатки</h1>
      <div className="mb-4 text-sm text-gray-600">
        Остатки на складах WB. Данные WB обновляются примерно раз в 30 минут.
        {updatedAt ? ` Обновлено: ${updatedAt}` : ""}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
          disabled={loading}
          onClick={() => load("live")}
        >
          {loading ? "Загружаю..." : "Обновить из WB"}
        </button>
        <input
          className="h-11 min-w-[260px] flex-1 rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
          placeholder="Поиск по offer_id или nm_id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 whitespace-pre-line">
          {error}
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">Товары с остатками: {filteredItems.length}</h2>
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <details key={item.nm_id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <summary className="cursor-pointer select-none">
                <span className="font-semibold">{item.offer_id}</span>
                <span className="ml-3 text-sm text-gray-600">
                  nm_id: {item.nm_id} • остаток: {item.total_quantity}
                </span>
              </summary>
              <div className="mt-3 space-y-2">
                {(item.warehouses || []).map((warehouse) => (
                  <div key={`${item.nm_id}-${warehouse.warehouse_id}`} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                    <div className="font-medium">{warehouse.warehouse_name || `Склад ${warehouse.warehouse_id}`}</div>
                    <div className="text-gray-600">
                      {warehouse.region_name || "Регион не указан"} • остаток: {warehouse.quantity} • к клиенту: {warehouse.in_way_to_client} • от клиента: {warehouse.in_way_from_client}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Товары без остатков: {filteredWithoutStocks.length}</h2>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800">
          {filteredWithoutStocks.map((item) => (
            <div key={item.nm_id} className="flex items-center justify-between border-b border-gray-100 p-3 text-sm last:border-b-0 dark:border-gray-800">
              <span className="font-medium">{item.offer_id}</span>
              <span className="text-gray-600">nm_id: {item.nm_id}</span>
            </div>
          ))}
          {!loading && !filteredWithoutStocks.length ? (
            <div className="p-3 text-sm text-gray-500">Товаров без остатков нет</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
