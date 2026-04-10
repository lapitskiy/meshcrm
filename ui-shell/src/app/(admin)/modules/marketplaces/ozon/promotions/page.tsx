"use client";

import React from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

type PromoItem = {
  offer_id: string;
  product_id?: number;
  sale_qty: number;
  opt_price: number;
  marketing_seller_price: number;
  price: number;
  min_price: number;
  fbs_delivery_total: number;
  fbo_delivery_total: number;
  profit_price_fbs: number;
  profit_percent_fbs: number;
  profit_price_fbo: number;
  profit_percent_fbo: number;
  color: "red" | "yellow" | "green";
  settings?: any;
  avg_list?: any[];
};

const PAGE_SIZE = 50;

const pickPositiveOr = (value: any, fallback: number): number => {
  const n = Number(value ?? 0);
  return n > 0 ? n : Number(fallback ?? 0);
};

export default function OzonPromotionsPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [color, setColor] = React.useState<"" | "green" | "yellow" | "red">("");
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<PromoItem[]>([]);
  const [savingOfferId, setSavingOfferId] = React.useState<string>("");
  const [timerUpdating, setTimerUpdating] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, any>>({});

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const url = new URL(`${getGatewayBaseUrl()}/marketplaces/ozon/promotions`);
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
    // sync key price fields from backend on every load
    setDraft((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const s = it.settings || {};
        const current = next[it.offer_id] || {};
        const fallbackPrice = Number(it.price ?? 0);
        const fallbackMinPrice = Number(it.min_price ?? 0);
        next[it.offer_id] = {
          ...current,
          yourprice: pickPositiveOr(s.yourprice, fallbackPrice),
          minprice: pickPositiveOr(s.minprice, fallbackMinPrice),
          min_price_fbs: pickPositiveOr(s.min_price_fbs, Number(current.min_price_fbs ?? fallbackMinPrice)),
          min_price_promo: pickPositiveOr(s.min_price_promo, Number(current.min_price_promo ?? fallbackMinPrice)),
          min_price_discount: pickPositiveOr(s.min_price_discount, Number(current.min_price_discount ?? fallbackMinPrice)),
          limit_count_value: s.limit_count_value ?? current.limit_count_value ?? 1,
          use_fbs: s.use_fbs ?? current.use_fbs ?? false,
          use_limit_count: s.use_limit_count ?? current.use_limit_count ?? false,
          use_promo: s.use_promo ?? current.use_promo ?? false,
          autoupdate_promo: s.autoupdate_promo ?? current.autoupdate_promo ?? false,
          auto_update_days_limit_promo:
            s.auto_update_days_limit_promo ?? current.auto_update_days_limit_promo ?? false,
          use_discount: s.use_discount ?? current.use_discount ?? false,
        };
      }
      return next;
    });
  }, [items]);

  const filtered = query
    ? items.filter((x) => x.offer_id.toLowerCase().includes(query.toLowerCase()))
    : items;

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

  const saveRow = async (offerId: string, patch: any) => {
    setSavingOfferId(offerId);
    setError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/ozon/promotions/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ offer_id: offerId, ...patch }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        return;
      }
      setItems((prev) =>
        prev.map((it) =>
          it.offer_id === offerId
            ? {
                ...it,
                price: Number(patch.yourprice || it.price),
                min_price: Number(patch.minprice || it.min_price),
                settings: { ...(it.settings || {}), ...patch },
              }
            : it
        )
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSavingOfferId("");
    }
  };

  const setDraftField = (offerId: string, patch: any) => {
    setDraft((prev) => ({ ...prev, [offerId]: { ...(prev[offerId] || {}), ...patch } }));
  };

  const saveOffer = async (it: PromoItem) => {
    const d = draft[it.offer_id] || {};
    await saveRow(it.offer_id, {
      yourprice: Number(d.yourprice || 0),
      minprice: Number(d.minprice || 0),
      min_price_fbs: Number(d.min_price_fbs || 0),
      min_price_promo: Number(d.min_price_promo || 0),
      min_price_discount: Number(d.min_price_discount || 0),
      limit_count_value: Number(d.limit_count_value || 1),
      use_fbs: Boolean(d.use_fbs),
      use_limit_count: Boolean(d.use_limit_count),
      use_promo: Boolean(d.use_promo),
      autoupdate_promo: Boolean(d.autoupdate_promo),
      auto_update_days_limit_promo: Boolean(d.auto_update_days_limit_promo),
      use_discount: Boolean(d.use_discount),
    });
  };

  const forceTimerUpdate = async () => {
    setTimerUpdating(true);
    setError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/ozon/promotions/timer-autoupdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setTimerUpdating(false);
    }
  };

  const OzonLinkIcon = ({ className }: { className?: string }) => (
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

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-2">Ozon → Акции</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          type="button"
          className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
          disabled={loading}
          onClick={load}
        >
          {loading ? "Загружаю..." : "Обновить"}
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-amber-500 text-white disabled:opacity-50"
          disabled={timerUpdating}
          onClick={forceTimerUpdate}
        >
          {timerUpdating ? "Обновляю 30 дней..." : "Принудительно обновить 30 дней"}
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
              • показано {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}-
              {Math.min(page * PAGE_SIZE, filtered.length)}
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
                продано за месяц: {it.sale_qty} • опт: {it.opt_price} • FBS: {it.profit_price_fbs} ({it.profit_percent_fbs}%) • FBO: {it.profit_price_fbo} ({it.profit_percent_fbo}%)
              </span>
            </summary>

            {Array.isArray(it.avg_list) && it.avg_list.length > 0 && (
              <div className="mt-3 space-y-2">
                {it.avg_list.map((a: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.03]">
                    Продано {a.count} по средней цене {a.avg_price} • Комиссия FBS: {a.fbs_delivery_total} / FBO: {a.fbo_delivery_total} •
                    прибыль FBS: {a.profit_price_fbs} ({a.profit_percent_fbs}%) / FBO: {a.profit_price_fbo} ({a.profit_percent_fbo}%)
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Текущая акция (marketing_seller_price)</div>
                <div className="font-medium">{it.marketing_seller_price}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Комиссия</div>
                <div className="font-medium">FBS: {it.fbs_delivery_total} / FBO: {it.fbo_delivery_total}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
                <div className="text-gray-500 mb-1">Прибыль</div>
                <div className="font-medium">
                  FBS: {it.profit_price_fbs} ({it.profit_percent_fbs}%) / FBO: {it.profit_price_fbo} ({it.profit_percent_fbo}%)
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
                disabled={savingOfferId === it.offer_id}
                onClick={() => saveOffer(it)}
              >
                {savingOfferId === it.offer_id ? "Сохраняю..." : "Сохранить в Ozon"}
              </button>
              {it.product_id ? (
                <a
                  href={`https://seller.ozon.ru/app/prices/manager/${it.product_id}/prices`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-brand-600 hover:underline"
                  title="Посмотреть цену товара в личном кабинете Ozon"
                >
                  <OzonLinkIcon className="w-5 h-5" />
                  <span>Кабинет Ozon</span>
                </a>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="text-gray-600 mb-1">Ваша цена без акций</div>
                <input
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={String(
                    draft[it.offer_id]?.yourprice ??
                      pickPositiveOr(it.settings?.yourprice, Number(it.price ?? 0))
                  )}
                  onChange={(e) => setDraftField(it.offer_id, { yourprice: e.target.value })}
                  disabled={savingOfferId === it.offer_id}
                />
              </label>
              <label className="text-sm">
                <div className="text-gray-600 mb-1">Минимальная цена в Ozon</div>
                <input
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={String(
                    draft[it.offer_id]?.minprice ??
                      pickPositiveOr(it.settings?.minprice, Number(it.min_price ?? 0))
                  )}
                  onChange={(e) => setDraftField(it.offer_id, { minprice: e.target.value })}
                  disabled={savingOfferId === it.offer_id}
                />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="text-gray-600 mb-1">Минимальная цена FBS</div>
                <input
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={String(draft[it.offer_id]?.min_price_fbs ?? "")}
                  onChange={(e) => setDraftField(it.offer_id, { min_price_fbs: e.target.value })}
                  disabled={savingOfferId === it.offer_id}
                />
              </label>
              <label className="text-sm">
                <div className="text-gray-600 mb-1">Мин. цена для исключения из акций</div>
                <input
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={String(draft[it.offer_id]?.min_price_promo ?? "")}
                  onChange={(e) => setDraftField(it.offer_id, { min_price_promo: e.target.value })}
                  disabled={savingOfferId === it.offer_id}
                />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="font-semibold mb-2">Автоматическое принятие скидки</div>
              <div className="text-sm text-gray-600 mb-3">
                Используйте, если хотите чтобы скидки принимались с минимальным процентом. Если минимальная скидка (3%)
                больше указаной цены — скидка отменяется; если цена входит — выставляется 3% и одобряется.
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[it.offer_id]?.use_discount)}
                    onChange={(e) => setDraftField(it.offer_id, { use_discount: e.target.checked })}
                    disabled={savingOfferId === it.offer_id}
                  />
                  Включить
                </label>
                <label className="text-sm">
                  <span className="text-gray-600 mr-2">Мин. цена</span>
                  <input
                    className="h-11 w-[180px] rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                    value={String(draft[it.offer_id]?.min_price_discount ?? "")}
                    onChange={(e) => setDraftField(it.offer_id, { min_price_discount: e.target.value })}
                    disabled={savingOfferId === it.offer_id}
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="font-semibold mb-2">Обновление 30-дневного срока когда осталось 10 дней до конца</div>
              <div className="text-sm text-gray-600 mb-3">
                Если до конца акции осталось 10 дней, срок действия акции продлевается на 30 дней.
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(draft[it.offer_id]?.auto_update_days_limit_promo)}
                  onChange={(e) => setDraftField(it.offer_id, { auto_update_days_limit_promo: e.target.checked })}
                  disabled={savingOfferId === it.offer_id}
                />
                Включить
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(draft[it.offer_id]?.use_fbs)}
                  onChange={(e) => setDraftField(it.offer_id, { use_fbs: e.target.checked })}
                  disabled={savingOfferId === it.offer_id}
                />
                use_fbs
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(draft[it.offer_id]?.use_promo)}
                  onChange={(e) => setDraftField(it.offer_id, { use_promo: e.target.checked })}
                  disabled={savingOfferId === it.offer_id}
                />
                use_promo
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(draft[it.offer_id]?.use_limit_count)}
                  onChange={(e) => setDraftField(it.offer_id, { use_limit_count: e.target.checked })}
                  disabled={savingOfferId === it.offer_id}
                />
                use_limit_count
              </label>
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

