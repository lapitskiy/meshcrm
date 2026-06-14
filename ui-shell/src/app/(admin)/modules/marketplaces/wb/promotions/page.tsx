"use client";

import React from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

type PromoItem = {
  offer_id: string;
  nm_id: number;
  price: number;
  discounted_price: number;
  discount: number;
  club_discount: number;
  editable_size_price: boolean;
  is_bad_turnover: boolean;
  opt_price: number;
  sale_qty: number;
  profit_price: number;
  profit_percent: number;
  color: "red" | "yellow" | "green";
  sizes?: any[];
  settings?: any;
};

const PAGE_SIZE = 50;

export default function WbPromotionsPage() {
  const WbLinkIcon = ({ className }: { className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3h7v7" />
      <path d="M10 14L21 3" />
      <path d="M21 14v7h-7" />
      <path d="M3 10V3h7" />
      <path d="M3 21h7" />
      <path d="M3 14v7" />
    </svg>
  );

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [color, setColor] = React.useState<"" | "green" | "yellow" | "red">("");
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<PromoItem[]>([]);
  const [savingOfferId, setSavingOfferId] = React.useState<string>("");
  const [draft, setDraft] = React.useState<Record<string, any>>({});

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const url = new URL(`${getGatewayBaseUrl()}/marketplaces/wb/promotions`);
      if (color) url.searchParams.set("percent_color", color);
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        setItems([]);
        return;
      }
      setItems(Array.isArray(j?.items) ? (j.items as PromoItem[]) : []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  React.useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const current = next[it.offer_id] || {};
        next[it.offer_id] = {
          ...current,
          price: current.price ?? Number(it.price ?? 0),
          discount: current.discount ?? Number(it.discount ?? 0),
          min_price_auto: current.min_price_auto ?? Number(it.settings?.min_price_auto ?? 0),
          auto_update_price: current.auto_update_price ?? Boolean(it.settings?.auto_update_price ?? false),
        };
      }
      return next;
    });
  }, [items]);

  const filtered = query ? items.filter((x) => x.offer_id.toLowerCase().includes(query.toLowerCase())) : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedItems = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  React.useEffect(() => {
    setPage(1);
  }, [query, color]);

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const setDraftField = (offerId: string, patch: any) => {
    setDraft((prev) => ({ ...prev, [offerId]: { ...(prev[offerId] || {}), ...patch } }));
  };

  const saveOffer = async (it: PromoItem) => {
    const d = draft[it.offer_id] || {};
    setSavingOfferId(it.offer_id);
    setError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/promotions/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          nm_id: Number(it.nm_id),
          offer_id: String(it.offer_id || ""),
          price: Number(d.price || 0),
          discount: Number(d.discount || 0),
          min_price_auto: Number(d.min_price_auto || 0),
          auto_update_price: Boolean(d.auto_update_price),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        return;
      }
      setItems((prev) =>
        prev.map((row) =>
          row.offer_id === it.offer_id
            ? {
                ...row,
                price: Number(d.price || row.price),
                discount: Number(d.discount || row.discount),
                discounted_price: Math.round(Number(d.price || row.price) * (100 - Number(d.discount || row.discount)) / 100),
                settings: {
                  ...(row.settings || {}),
                  min_price_auto: Number(d.min_price_auto || 0),
                  auto_update_price: Boolean(d.auto_update_price),
                },
              }
            : row
        )
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSavingOfferId("");
    }
  };

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-2">WB → Акции</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          type="button"
          className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
          disabled={loading}
          onClick={load}
        >
          {loading ? "Загружаю..." : "Обновить"}
        </button>

        <select
          className="h-11 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          value={color}
          onChange={(e) => setColor(e.target.value as any)}
          disabled={loading}
        >
          <option value="">Все</option>
          <option value="green">Зеленый (≥60%)</option>
          <option value="yellow">Желтый (30-59%)</option>
          <option value="red">Красный (&lt;30%)</option>
        </select>

        <input
          className="h-11 w-full min-w-[240px] flex-1 rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
          placeholder="Поиск по offer_id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 whitespace-pre-line">
          {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
        <div>
          Товаров: {filtered.length}
          {filtered.length > 0 && (
            <span>
              {" "}
              • показано {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}-{Math.min(page * PAGE_SIZE, filtered.length)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded border border-gray-300 disabled:opacity-50 dark:border-gray-700"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={loading || page <= 1}
          >
            Назад
          </button>
          <span>
            Страница {page} из {totalPages}
          </span>
          <button
            type="button"
            className="px-3 py-1.5 rounded bg-brand-500 text-white disabled:opacity-50"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={loading || page >= totalPages}
          >
            Далее
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {pagedItems.map((it) => (
          <details
            key={it.offer_id}
            className="rounded-xl border border-gray-200 p-4 transition-colors open:bg-gray-100 dark:border-gray-800 dark:open:bg-white/[0.06]"
          >
            <summary className="cursor-pointer select-none">
              <span className="font-semibold text-lg">{it.offer_id}</span>
              <span className="ml-3 text-sm text-gray-600">
                продано за месяц: {it.sale_qty} • опт: {it.opt_price} • прибыль: {it.profit_price} ({it.profit_percent}%)
              </span>
            </summary>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Текущая цена</div>
                <div className="font-medium">{it.price}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Цена со скидкой</div>
                <div className="font-medium">{it.discounted_price}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Скидка продавца</div>
                <div className="font-medium">{it.discount}%</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="text-gray-600 mb-1">Цена продавца до скидки</div>
                <input
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={String(draft[it.offer_id]?.price ?? it.price ?? 0)}
                  onChange={(e) => setDraftField(it.offer_id, { price: e.target.value })}
                  disabled={savingOfferId === it.offer_id}
                />
              </label>
              <label className="text-sm">
                <div className="text-gray-600 mb-1">Скидка продавца %</div>
                <input
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={String(draft[it.offer_id]?.discount ?? it.discount ?? 0)}
                  onChange={(e) => setDraftField(it.offer_id, { discount: e.target.value })}
                  disabled={savingOfferId === it.offer_id}
                />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Артикул WB</div>
                <div className="font-medium">{it.nm_id}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">WB Club</div>
                <div className="font-medium">{it.club_discount}%</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Статус</div>
                <div className="font-medium">
                  {it.is_bad_turnover ? "Высокие остатки/ограничения" : "Обычный"}
                  {it.editable_size_price ? " • поразмерная цена" : ""}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="font-semibold mb-2">Минимальная цена</div>
              <div className="text-sm text-gray-600 mb-3">
                Если включено авто обновление цены, по расписанию будем проверять скидку и перевыставлять цену не ниже указанной.
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[it.offer_id]?.auto_update_price)}
                    onChange={(e) => setDraftField(it.offer_id, { auto_update_price: e.target.checked })}
                    disabled={savingOfferId === it.offer_id}
                  />
                  Авто обновление цены
                </label>
                <label className="text-sm">
                  <span className="text-gray-600 mr-2">Мин. цена</span>
                  <input
                    className="h-11 w-[180px] rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                    value={String(draft[it.offer_id]?.min_price_auto ?? "")}
                    onChange={(e) => setDraftField(it.offer_id, { min_price_auto: e.target.value })}
                    disabled={savingOfferId === it.offer_id}
                  />
                </label>
              </div>
            </div>

            {Array.isArray(it.sizes) && it.sizes.length > 0 && (
              <div className="mt-4 space-y-2">
                {it.sizes.map((size: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                    Размер: {size.techSizeName || "N/A"} • price: {size.price} • discountedPrice: {size.discountedPrice}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
                disabled={savingOfferId === it.offer_id}
                onClick={() => saveOffer(it)}
              >
                {savingOfferId === it.offer_id ? "Сохраняю..." : "Сохранить в WB"}
              </button>
              {it.nm_id ? (
                <a
                  href={`https://www.wildberries.ru/catalog/${it.nm_id}/detail.aspx`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-brand-600 hover:underline"
                  title="Открыть товар на Wildberries"
                >
                  <WbLinkIcon className="w-5 h-5" />
                  <span>Карточка на WB</span>
                </a>
              ) : null}
              {it.nm_id ? (
                <a
                  href={`https://seller.wildberries.ru/discount-and-prices/main-table?nmId=${it.nm_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-brand-600 hover:underline"
                  title="Открыть товар в кабинете продавца Wildberries"
                >
                  <WbLinkIcon className="w-5 h-5" />
                  <span>Товар в кабинете WB</span>
                </a>
              ) : null}
            </div>
          </details>
        ))}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={loading || page >= totalPages}
          >
            Далее
          </button>
        </div>
      )}
    </div>
  );
}
