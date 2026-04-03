"use client";

import React, { useMemo, useState } from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";
import Button from "@/components/ui/button/Button";
import DatePicker from "@/components/form/date-picker";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";

type BuybackDealItem = {
  id: string;
  deal_number?: number | null;
  status?: string;
  warehouse_id?: string | null;
  created_at: string;
};

type BuybackFinanceLine = {
  id: string;
  deal_uuid: string;
  amount: number;
  currency: string;
  payment_method: "cashbox" | "online_transfer";
  updated_at: string;
};

type BuybackFinanceHistoryItem = {
  id: string;
  deal_uuid: string;
  old_amount: number | null;
  new_amount: number | null;
  old_payment_method: string | null;
  new_payment_method: string | null;
  changed_by_name: string;
  changed_at: string;
};

type WarehouseOption = {
  id: string;
  name: string;
};

type Filters = {
  amount: string;
  warehouse_id: string;
  created_from: string;
  created_to: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function toYmdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function FinanceMoneySkupkaPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [deals, setDeals] = useState<BuybackDealItem[]>([]);
  const [lineByDealId, setLineByDealId] = useState<Record<string, BuybackFinanceLine>>({});
  const [lineDraftByDealId, setLineDraftByDealId] = useState<Record<string, string>>({});
  const [lineSavingByDealId, setLineSavingByDealId] = useState<Record<string, boolean>>({});
  const [historyByDealId, setHistoryByDealId] = useState<Record<string, BuybackFinanceHistoryItem[]>>({});
  const [historyLoadingByDealId, setHistoryLoadingByDealId] = useState<Record<string, boolean>>({});
  const [historyErrorByDealId, setHistoryErrorByDealId] = useState<Record<string, string>>({});
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseNameById, setWarehouseNameById] = useState<Record<string, string>>({});
  const [moneyVisibleRelatedModules, setMoneyVisibleRelatedModules] = useState<string[]>([]);
  const [draftFilters, setDraftFilters] = useState<Filters>({
    amount: "",
    warehouse_id: "",
    created_from: "",
    created_to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<Filters>({
    amount: "",
    warehouse_id: "",
    created_from: "",
    created_to: "",
  });

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dealsResp, linesResp, warehousesResp, settingsResp] = await Promise.all([
        fetch(`${base}/skupka/skupka/deals?limit=500`, { cache: "no-store", headers: authHeaders() }),
        fetch(`${base}/finance/finance/buyback-lines?limit=2000`, { cache: "no-store", headers: authHeaders() }),
        fetch(`${base}/warehouses/warehouses/accessible`, { cache: "no-store", headers: authHeaders() }),
        fetch(`${base}/finance/finance/settings`, { cache: "no-store", headers: authHeaders() }),
      ]);
      if (!dealsResp.ok) throw new Error(`skupka deals failed: ${dealsResp.status}`);
      if (!linesResp.ok) throw new Error(`buyback lines failed: ${linesResp.status}`);
      if (!warehousesResp.ok) throw new Error(`warehouses failed: ${warehousesResp.status}`);
      if (!settingsResp.ok) throw new Error(`finance settings failed: ${settingsResp.status}`);

      const dealsData = (await dealsResp.json()) as BuybackDealItem[];
      const linesData = (await linesResp.json()) as BuybackFinanceLine[];
      const warehousesData = (await warehousesResp.json()) as WarehouseOption[];
      const settingsData = (await settingsResp.json()) as { money_visible_related_modules?: string[] };

      const nextLineByDealId: Record<string, BuybackFinanceLine> = {};
      for (const line of linesData || []) {
        const key = String(line.deal_uuid || "");
        if (!key || nextLineByDealId[key]) continue;
        nextLineByDealId[key] = line;
      }
      const nextLineDraftByDealId: Record<string, string> = {};
      for (const [dealId, line] of Object.entries(nextLineByDealId)) {
        nextLineDraftByDealId[dealId] = String(line.amount ?? "");
      }
      const nextWarehouseMap: Record<string, string> = {};
      for (const row of warehousesData || []) nextWarehouseMap[String(row.id)] = String(row.name || "");

      setDeals(dealsData || []);
      setLineByDealId(nextLineByDealId);
      setLineDraftByDealId(nextLineDraftByDealId);
      setWarehouseOptions(warehousesData || []);
      setWarehouseNameById(nextWarehouseMap);
      setMoneyVisibleRelatedModules(
        Array.from(new Set((settingsData.money_visible_related_modules || []).map((x) => String(x || "").toLowerCase())))
      );
    } catch (e: any) {
      setError(e?.message || "failed to load buyback finance");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistoryForDeal = async (dealId: string) => {
    if (historyByDealId[dealId]) return;
    setHistoryLoadingByDealId((prev) => ({ ...prev, [dealId]: true }));
    setHistoryErrorByDealId((prev) => ({ ...prev, [dealId]: "" }));
    try {
      const resp = await fetch(`${base}/finance/finance/buyback-lines/${encodeURIComponent(dealId)}/history?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`buyback history failed: ${resp.status} ${body}`);
      }
      const rows = (await resp.json()) as BuybackFinanceHistoryItem[];
      setHistoryByDealId((prev) => ({ ...prev, [dealId]: rows || [] }));
    } catch (e: any) {
      setHistoryErrorByDealId((prev) => ({ ...prev, [dealId]: e?.message || "failed to load history" }));
    } finally {
      setHistoryLoadingByDealId((prev) => ({ ...prev, [dealId]: false }));
    }
  };

  const onToggleDeal = (dealId: string) => {
    setOpenDealId((prev) => (prev === dealId ? null : dealId));
    if (openDealId !== dealId) void loadHistoryForDeal(dealId);
  };

  const onSaveLine = async (dealId: string) => {
    const line = lineByDealId[dealId];
    if (!line) return;
    const amount = Number(String(lineDraftByDealId[dealId] || "").replace(",", "."));
    if (!Number.isFinite(amount)) {
      setError("Сумма должна быть числом");
      return;
    }
    setLineSavingByDealId((prev) => ({ ...prev, [dealId]: true }));
    setError(null);
    try {
      const resp = await fetch(`${base}/finance/finance/buyback-lines`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          deal_uuid: dealId,
          amount,
          currency: line.currency,
          payment_method: line.payment_method,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`save failed: ${resp.status} ${body}`);
      }
      const updated = (await resp.json()) as BuybackFinanceLine;
      setLineByDealId((prev) => ({ ...prev, [dealId]: updated }));
      setLineDraftByDealId((prev) => ({ ...prev, [dealId]: String(updated.amount) }));
      setHistoryByDealId((prev) => {
        const next = { ...prev };
        delete next[dealId];
        return next;
      });
      await loadHistoryForDeal(dealId);
    } catch (e: any) {
      setError(e?.message || "failed to save line");
    } finally {
      setLineSavingByDealId((prev) => ({ ...prev, [dealId]: false }));
    }
  };

  const visibleDeals = React.useMemo(() => {
    if (moneyVisibleRelatedModules.length > 0 && !moneyVisibleRelatedModules.includes("skupka")) return [];
    const amountMin = Number(String(appliedFilters.amount || "").replace(",", "."));
    const hasAmount = String(appliedFilters.amount || "").trim().length > 0 && Number.isFinite(amountMin);
    const fromTs = appliedFilters.created_from ? new Date(`${appliedFilters.created_from}T00:00:00`).getTime() : null;
    const toTs = appliedFilters.created_to ? new Date(`${appliedFilters.created_to}T23:59:59`).getTime() : null;
    return (deals || []).filter((deal) => {
      const line = lineByDealId[deal.id];
      if (!line) return false;
      if (hasAmount && !(Number(line.amount || 0) >= amountMin)) return false;
      if (appliedFilters.warehouse_id && String(deal.warehouse_id || "") !== appliedFilters.warehouse_id) return false;
      const createdTs = new Date(deal.created_at).getTime();
      if (fromTs !== null && createdTs < fromTs) return false;
      if (toTs !== null && createdTs > toTs) return false;
      return true;
    });
  }, [deals, lineByDealId, appliedFilters, moneyVisibleRelatedModules]);

  const totalPages = React.useMemo(() => {
    const total = visibleDeals.length;
    const size = Math.max(1, pageSize);
    return Math.max(1, Math.ceil(total / size));
  }, [visibleDeals.length, pageSize]);

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  const pagedVisibleDeals = React.useMemo(() => {
    const size = Math.max(1, pageSize);
    const start = (page - 1) * size;
    return visibleDeals.slice(start, start + size);
  }, [visibleDeals, page, pageSize]);

  const visibleTotalAmount = React.useMemo(() => {
    return visibleDeals.reduce((acc, deal) => {
      const line = lineByDealId[deal.id];
      return acc + Number(line?.amount || 0);
    }, 0);
  }, [visibleDeals, lineByDealId]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Приход денег по скупке</h3>
        <div className="mb-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
            <input
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.amount}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder="Сумма (от)"
            />
            <select
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.warehouse_id}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, warehouse_id: e.target.value }))}
            >
              <option value="">Склад</option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <DatePicker
              id="finance-money-skupka-date-range"
              mode="range"
              placeholder="Дата (от - до)"
              onChange={(dates) => {
                const list = Array.isArray(dates) ? dates : [];
                const from = list[0] ? toYmdLocal(list[0] as Date) : "";
                const to = list[1] ? toYmdLocal(list[1] as Date) : from;
                setDraftFilters((prev) => ({ ...prev, created_from: from, created_to: to }));
              }}
            />
            <Button
              size="sm"
              onClick={() => {
                setPage(1);
                setAppliedFilters({
                  amount: String(draftFilters.amount || "").trim(),
                  warehouse_id: draftFilters.warehouse_id,
                  created_from: draftFilters.created_from,
                  created_to: draftFilters.created_to,
                });
              }}
              disabled={loading}
            >
              Отфильтровать
            </Button>
          </div>
        </div>
        {error && <div className="mb-3 text-sm text-red-600">Ошибка: {error}</div>}
        {!visibleDeals.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Данных пока нет.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Номер сделки
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Статус
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Дата создания
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Сумма
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {pagedVisibleDeals.map((deal) => {
                    const line = lineByDealId[deal.id];
                    if (!line) return null;
                    return (
                      <React.Fragment key={deal.id}>
                        <tr className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]" onClick={() => onToggleDeal(deal.id)}>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">{deal.deal_number ?? "-"}</td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">{deal.status || "-"}</td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {new Date(deal.created_at).toLocaleString()}
                            {deal.warehouse_id ? (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                Склад: {warehouseNameById[deal.warehouse_id] || deal.warehouse_id}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            {Number(line.amount || 0).toFixed(2)} {line.currency}
                          </td>
                        </tr>
                        {openDealId === deal.id ? (
                          <tr>
                            <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300" colSpan={4}>
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    className="h-9 w-28 rounded-lg border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                    value={lineDraftByDealId[deal.id] ?? String(line.amount)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setLineDraftByDealId((prev) => ({ ...prev, [deal.id]: e.target.value }))}
                                  />
                                  <span>{line.currency}</span>
                                  <span>| {line.payment_method === "cashbox" ? "Касса" : "Онлайн перевод"} |</span>
                                  <button
                                    type="button"
                                    className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void onSaveLine(deal.id);
                                    }}
                                    disabled={!!lineSavingByDealId[deal.id]}
                                  >
                                    Сохранить
                                  </button>
                                </div>
                                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                                  <div className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    История изменений
                                  </div>
                                  {historyLoadingByDealId[deal.id] ? (
                                    <div>Загрузка истории...</div>
                                  ) : historyErrorByDealId[deal.id] ? (
                                    <div className="text-red-600">Ошибка: {historyErrorByDealId[deal.id]}</div>
                                  ) : !(historyByDealId[deal.id] || []).length ? (
                                    <div>История изменений пуста.</div>
                                  ) : (
                                    <div className="space-y-1">
                                      {(historyByDealId[deal.id] || []).map((h) => (
                                        <div key={h.id} className="text-sm">
                                          {new Date(h.changed_at).toLocaleString()} | сумма: {h.old_amount ?? "-"} -&gt;{" "}
                                          {h.new_amount ?? "-"} | {h.changed_by_name || "Неизвестно"}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        <div className="mt-4 rounded-lg border border-gray-200 px-4 py-3 text-sm dark:border-gray-800">
          <span className="text-gray-500 dark:text-gray-400">Сводка по отображаемым сделкам:</span>{" "}
          <span className="font-medium text-gray-800 dark:text-white/90">{visibleTotalAmount.toFixed(2)} RUB</span>
        </div>
        {!!visibleDeals.length && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Страница {page} из {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-lg border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={String(pageSize)}
                onChange={(e) => {
                  const nextSize = Number(e.target.value);
                  if (!Number.isFinite(nextSize) || nextSize <= 0) return;
                  setPageSize(nextSize);
                  setPage(1);
                }}
                disabled={loading}
                title="Сделок на странице"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={loading || page <= 1}
              >
                Назад
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={loading || page >= totalPages}
              >
                Дальше
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
