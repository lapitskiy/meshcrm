"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/button/Button";
import DatePicker from "@/components/form/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type OrderItem = {
  id: string;
  order_number?: number | null;
  status?: string;
  warehouse_id?: string | null;
  related_modules?: Record<string, Record<string, string>>;
  created_at: string;
};

type OrdersPage = {
  items: OrderItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type FinanceLine = {
  id: string;
  work_type_uuid: string;
  amount: number;
  currency: string;
  payment_method: "card" | "cash";
  is_paid: boolean;
};

type FinanceHistoryItem = {
  id: string;
  order_uuid: string;
  work_type_uuid: string;
  old_amount: number | null;
  new_amount: number | null;
  old_is_paid: boolean | null;
  new_is_paid: boolean | null;
  old_payment_method: string | null;
  new_payment_method: string | null;
  changed_by_name: string;
  changed_at: string;
};

type MoneyFilters = {
  amount: string;
  paid: "" | "paid" | "unpaid";
  warehouse_id: string;
  created_from: string;
  created_to: string;
};

type WarehouseOption = {
  id: string;
  name: string;
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

export default function FinanceMoneyPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const searchParams = useSearchParams();
  const initialSearch = String(searchParams.get("search") || "").trim();
  const initialOpenOrderId = String(searchParams.get("open_order_id") || "").trim();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [pendingOpenOrderId, setPendingOpenOrderId] = useState(initialOpenOrderId);
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  const [financeByOrder, setFinanceByOrder] = useState<Record<string, FinanceLine[]>>({});
  const [financeTotalByOrder, setFinanceTotalByOrder] = useState<Record<string, number>>({});
  const [historyByOrder, setHistoryByOrder] = useState<Record<string, FinanceHistoryItem[]>>({});
  const [historyLoadingByOrder, setHistoryLoadingByOrder] = useState<Record<string, boolean>>({});
  const [historyErrorByOrder, setHistoryErrorByOrder] = useState<Record<string, string>>({});
  const [lineDraftById, setLineDraftById] = useState<Record<string, { amount: string; is_paid: "yes" | "no" }>>({});
  const [lineSavingById, setLineSavingById] = useState<Record<string, boolean>>({});
  const [workTypeNameById, setWorkTypeNameById] = useState<Record<string, string>>({});
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseNameById, setWarehouseNameById] = useState<Record<string, string>>({});
  const [moneyVisibleRelatedModules, setMoneyVisibleRelatedModules] = useState<string[]>([]);
  const [draftFilters, setDraftFilters] = useState<MoneyFilters>({
    amount: "",
    paid: "",
    warehouse_id: "",
    created_from: "",
    created_to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<MoneyFilters>({
    amount: "",
    paid: "",
    warehouse_id: "",
    created_from: "",
    created_to: "",
  });

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const fetchFinanceLines = async (orderId: string): Promise<FinanceLine[]> => {
    const resp = await fetch(`${base}/finance/finance/orders/${encodeURIComponent(orderId)}/lines`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`finance lines failed: ${resp.status} ${body}`);
    }
    return ((await resp.json()) as FinanceLine[]) || [];
  };

  const fetchHistory = async (orderId: string): Promise<FinanceHistoryItem[]> => {
    const resp = await fetch(`${base}/finance/finance/orders/${encodeURIComponent(orderId)}/history?limit=100`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`finance history failed: ${resp.status} ${body}`);
    }
    return ((await resp.json()) as FinanceHistoryItem[]) || [];
  };

  const hydrateLineDrafts = (nextFinanceByOrder: Record<string, FinanceLine[]>) => {
    const nextDrafts: Record<string, { amount: string; is_paid: "yes" | "no" }> = {};
    for (const lines of Object.values(nextFinanceByOrder)) {
      for (const line of lines) {
        nextDrafts[line.id] = {
          amount: String(line.amount),
          is_paid: line.is_paid ? "yes" : "no",
        };
      }
    }
    setLineDraftById(nextDrafts);
  };

  const load = async (targetPage: number, searchArg?: string, filtersArg?: MoneyFilters, pageSizeArg?: number) => {
    setLoading(true);
    setError(null);
    try {
      const f = filtersArg || appliedFilters;
      const effectivePageSize = pageSizeArg || pageSize;
      const qs = new URLSearchParams();
      qs.set("page", String(targetPage));
      qs.set("page_size", String(effectivePageSize));
      const s = String(searchArg ?? appliedSearch).trim();
      if (s) qs.set("search", s);
      if (f.warehouse_id) qs.set("warehouse_id", f.warehouse_id);
      if (f.created_from) qs.set("created_from", f.created_from);
      if (f.created_to) qs.set("created_to", f.created_to);
      const resp = await fetch(`${base}/orders/orders?${qs.toString()}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`orders list failed: ${resp.status} ${body}`);
      }
      const data = (await resp.json()) as OrdersPage;
      const rows = data.items || [];
      setItems(rows);
      setPage(data.page || targetPage);
      if (Number.isFinite(Number(data.page_size)) && Number(data.page_size) > 0) {
        setPageSize(Number(data.page_size));
      }
      setTotalPages(data.total_pages || 1);
      if (pendingOpenOrderId && rows.some((x) => x.id === pendingOpenOrderId)) {
        setOpenOrderId(pendingOpenOrderId);
        void loadHistoryForOrder(pendingOpenOrderId);
        setPendingOpenOrderId("");
      } else {
        setOpenOrderId(null);
      }

      const financePairs = await Promise.all(
        rows.map(async (order) => {
          try {
            const lines = await fetchFinanceLines(order.id);
            return [order.id, lines] as const;
          } catch {
            return [order.id, []] as const;
          }
        })
      );
      const nextFinanceByOrder: Record<string, FinanceLine[]> = {};
      const nextTotals: Record<string, number> = {};
      for (const [orderId, lines] of financePairs) {
        nextFinanceByOrder[orderId] = lines;
        nextTotals[orderId] = lines.reduce((acc, line) => acc + Number(line.amount || 0), 0);
      }
      setFinanceByOrder(nextFinanceByOrder);
      setFinanceTotalByOrder(nextTotals);
      hydrateLineDrafts(nextFinanceByOrder);
    } catch (e: any) {
      setError(e?.message || "failed to load finance orders");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load(1, appliedSearch, appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/orders/settings/work-types?limit=500`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        const rows = (await resp.json()) as Array<{ id: string; name: string }>;
        const map: Record<string, string> = {};
        for (const row of rows || []) map[row.id] = row.name;
        setWorkTypeNameById(map);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/warehouses/warehouses/accessible`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        const rows = (await resp.json()) as WarehouseOption[];
        const nextMap: Record<string, string> = {};
        for (const row of rows || []) nextMap[String(row.id)] = String(row.name || "");
        setWarehouseOptions(rows || []);
        setWarehouseNameById(nextMap);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/finance/finance/settings`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        const payload = (await resp.json()) as { money_visible_related_modules?: string[] };
        const normalized = Array.from(
          new Set((payload.money_visible_related_modules || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))
        );
        setMoneyVisibleRelatedModules(normalized);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistoryForOrder = async (orderId: string) => {
    if (historyByOrder[orderId]) return;
    setHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const rows = await fetchHistory(orderId);
      setHistoryByOrder((prev) => ({ ...prev, [orderId]: rows }));
    } catch (e: any) {
      setHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load history" }));
    } finally {
      setHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onToggleOrder = (orderId: string) => {
    setOpenOrderId((prev) => (prev === orderId ? null : orderId));
    if (openOrderId !== orderId) {
      void loadHistoryForOrder(orderId);
    }
  };

  const onSaveLine = async (orderId: string, line: FinanceLine) => {
    const draft = lineDraftById[line.id];
    if (!draft) return;
    const amount = Number(String(draft.amount || "").replace(",", "."));
    if (!Number.isFinite(amount)) {
      setError("Сумма должна быть числом");
      return;
    }
    setLineSavingById((prev) => ({ ...prev, [line.id]: true }));
    setError(null);
    try {
      const resp = await fetch(`${base}/finance/finance/order-lines`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          order_uuid: orderId,
          work_type_uuid: line.work_type_uuid,
          amount,
          currency: line.currency,
          payment_method: line.payment_method,
          is_paid: draft.is_paid === "yes",
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`save failed: ${resp.status} ${body}`);
      }
      const updated = (await resp.json()) as FinanceLine;
      setFinanceByOrder((prev) => {
        const next = { ...prev };
        next[orderId] = (prev[orderId] || []).map((x) => (x.id === line.id ? updated : x));
        return next;
      });
      setFinanceTotalByOrder((prev) => {
        const list = (financeByOrder[orderId] || []).map((x) => (x.id === line.id ? updated : x));
        return { ...prev, [orderId]: list.reduce((acc, x) => acc + Number(x.amount || 0), 0) };
      });
      setLineDraftById((prev) => ({
        ...prev,
        [line.id]: { amount: String(updated.amount), is_paid: updated.is_paid ? "yes" : "no" },
      }));
      setHistoryByOrder((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      void loadHistoryForOrder(orderId);
    } catch (e: any) {
      setError(e?.message || "failed to save line");
    } finally {
      setLineSavingById((prev) => ({ ...prev, [line.id]: false }));
    }
  };

  const visibleItems = React.useMemo(() => {
    const amountMin = Number(String(appliedFilters.amount || "").replace(",", "."));
    const hasAmount = String(appliedFilters.amount || "").trim().length > 0 && Number.isFinite(amountMin);
    return (items || []).filter((order) => {
      const total = Number(financeTotalByOrder[order.id] || 0);
      if (hasAmount && !(total >= amountMin)) return false;
      if (moneyVisibleRelatedModules.length > 0 && !moneyVisibleRelatedModules.includes("orders")) return false;
      if (!appliedFilters.paid) return true;
      const lines = financeByOrder[order.id] || [];
      const allPaid = !!lines.length && lines.every((l) => !!l.is_paid);
      if (appliedFilters.paid === "paid") return allPaid;
      return !allPaid;
    });
  }, [
    items,
    appliedFilters.amount,
    appliedFilters.paid,
    financeTotalByOrder,
    financeByOrder,
    moneyVisibleRelatedModules,
  ]);

  const onApplyFilters = async () => {
    const next: MoneyFilters = {
      amount: String(draftFilters.amount || "").trim(),
      paid: draftFilters.paid,
      warehouse_id: draftFilters.warehouse_id,
      created_from: draftFilters.created_from,
      created_to: draftFilters.created_to,
    };
    setAppliedFilters(next);
    await load(1, appliedSearch, next);
  };

  const visibleTotalAmount = React.useMemo(() => {
    return visibleItems.reduce((acc, order) => acc + Number(financeTotalByOrder[order.id] || 0), 0);
  }, [visibleItems, financeTotalByOrder]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Приход денег по заказам</h3>
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
              id="finance-money-date-range"
              mode="range"
              placeholder="Дата (от - до)"
              onChange={(dates) => {
                const list = Array.isArray(dates) ? dates : [];
                const from = list[0] ? toYmdLocal(list[0] as Date) : "";
                const to = list[1] ? toYmdLocal(list[1] as Date) : from;
                setDraftFilters((prev) => ({ ...prev, created_from: from, created_to: to }));
              }}
            />
            <select
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.paid}
              onChange={(e) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  paid: (e.target.value as any) || "",
                }))
              }
            >
              <option value="">Статус оплаты</option>
              <option value="paid">Оплачен</option>
              <option value="unpaid">Не оплачен</option>
            </select>
            <Button size="sm" onClick={() => void onApplyFilters()} disabled={loading}>
              Отфильтровать
            </Button>
          </div>
        </div>
        {error && <div className="mb-3 text-sm text-red-600">Ошибка: {error}</div>}
        {!visibleItems.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Данных пока нет.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Номер заказа
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Статус
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Дата создания
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Приход
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {visibleItems.map((order) => (
                    <React.Fragment key={order.id}>
                      <tr className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]" onClick={() => onToggleOrder(order.id)}>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                          {order.order_number ?? "-"}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">
                          {order.status || "-"}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                          {new Date(order.created_at).toLocaleString()}
                          {order.warehouse_id ? (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Склад: {warehouseNameById[order.warehouse_id] || order.warehouse_id}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                          {(financeTotalByOrder[order.id] || 0).toFixed(2)} RUB
                        </td>
                      </tr>
                      {openOrderId === order.id && (
                        <tr>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300" colSpan={4}>
                            <div className="mb-3">
                              <a
                                href={`/modules/orders/list?search=${encodeURIComponent(
                                  String(order.order_number || "")
                                )}&open_order_id=${encodeURIComponent(order.id)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brand-600 hover:underline dark:text-brand-400"
                              >
                                Открыть заказ
                              </a>
                            </div>
                            {!(financeByOrder[order.id] || []).length ? (
                              <div>Финансовые строки отсутствуют.</div>
                            ) : (
                              <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                                {(financeByOrder[order.id] || []).map((line) => (
                                  <div key={line.id} className="py-3">
                                    <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                                      {workTypeNameById[line.work_type_uuid] || "Вид работы не найден"}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <input
                                        className="h-9 w-28 rounded-lg border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                        value={lineDraftById[line.id]?.amount ?? String(line.amount)}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) =>
                                          setLineDraftById((prev) => ({
                                            ...prev,
                                            [line.id]: {
                                              amount: e.target.value,
                                              is_paid: prev[line.id]?.is_paid ?? (line.is_paid ? "yes" : "no"),
                                            },
                                          }))
                                        }
                                      />
                                      <span>{line.currency}</span>
                                      <span>| {line.payment_method === "card" ? "Оплата по карте" : "Наличкой"} |</span>
                                      <select
                                        className="h-9 rounded-lg border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                        value={lineDraftById[line.id]?.is_paid ?? (line.is_paid ? "yes" : "no")}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) =>
                                          setLineDraftById((prev) => ({
                                            ...prev,
                                            [line.id]: {
                                              amount: prev[line.id]?.amount ?? String(line.amount),
                                              is_paid: e.target.value === "yes" ? "yes" : "no",
                                            },
                                          }))
                                        }
                                      >
                                        <option value="yes">Оплачен</option>
                                        <option value="no">Не оплачен</option>
                                      </select>
                                      <button
                                        type="button"
                                        className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void onSaveLine(order.id, line);
                                        }}
                                        disabled={!!lineSavingById[line.id]}
                                      >
                                        Сохранить
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                              <div className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                История изменений
                              </div>
                              {historyLoadingByOrder[order.id] ? (
                                <div>Загрузка истории...</div>
                              ) : historyErrorByOrder[order.id] ? (
                                <div className="text-red-600">Ошибка: {historyErrorByOrder[order.id]}</div>
                              ) : !(historyByOrder[order.id] || []).length ? (
                                <div>История изменений пуста.</div>
                              ) : (
                                <div className="space-y-1">
                                  {(historyByOrder[order.id] || []).map((h) => (
                                    <div key={h.id} className="text-sm">
                                      {new Date(h.changed_at).toLocaleString()} |{" "}
                                      {workTypeNameById[h.work_type_uuid] || "Вид работы не найден"} | сумма:{" "}
                                      {h.old_amount ?? "-"} -&gt; {h.new_amount ?? "-"} | оплата:{" "}
                                      {h.old_is_paid === null ? "-" : h.old_is_paid ? "Оплачен" : "Не оплачен"} -&gt;{" "}
                                      {h.new_is_paid === null ? "-" : h.new_is_paid ? "Оплачен" : "Не оплачен"} |{" "}
                                      {h.changed_by_name || "Неизвестно"}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        <div className="mt-4 rounded-lg border border-gray-200 px-4 py-3 text-sm dark:border-gray-800">
          <span className="text-gray-500 dark:text-gray-400">Сводка по отображаемым заказам:</span>{" "}
          <span className="font-medium text-gray-800 dark:text-white/90">{visibleTotalAmount.toFixed(2)} RUB</span>
        </div>
        {!!items.length && (
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
                  void load(1, appliedSearch, appliedFilters, nextSize);
                }}
                disabled={loading}
                title="Заказов на странице"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
                onClick={() => void load(page - 1)}
                disabled={loading || page <= 1}
              >
                Назад
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
                onClick={() => void load(page + 1)}
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
