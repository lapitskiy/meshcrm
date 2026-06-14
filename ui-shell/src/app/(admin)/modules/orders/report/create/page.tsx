"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import DatePicker from "@/components/form/date-picker";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";
import { CloseIcon } from "@/icons";

type WarehouseOption = {
  id: string;
  name: string;
};

type ServiceCategory = {
  id: string;
  name: string;
};

type ServiceObject = {
  id: string;
  name: string;
};

type WorkType = {
  id: string;
  name: string;
};

type OrderItem = {
  id: string;
  order_number?: number | null;
  created_by_uuid?: string | null;
  created_by_name?: string;
  service_category_id?: string | null;
  service_object_id?: string | null;
  work_type_ids?: string[] | null;
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
  amount: number;
  cost_price?: number | null;
  currency: string;
};

type ReportRow = {
  orderId: string;
  orderNumber: number | null;
  acceptedByName: string;
  serviceName: string;
  serviceObjectName: string;
  workTypeName: string;
  revenue: number;
  costPrice: number;
  comment: string;
  profitPercent: number;
};

type ChangedOrderItem = {
  order_uuid: string;
  changed_at: string;
};

type SavedReportResponse = {
  id: string;
  report_number: number;
};

const profitOptions = [0, 10, 30, 50] as const;

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

function parseJwtPayload(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 ? "=".repeat(4 - (payload.length % 4)) : "";
    return JSON.parse(atob(payload + pad));
  } catch {
    return null;
  }
}

function currentUserUuidFromToken(): string {
  return String(parseJwtPayload(getToken())?.sub || "").trim().toLowerCase();
}

function orderNumberLabel(row: ReportRow): string {
  const base = row.orderNumber ? `#${row.orderNumber}` : "Без номера";
  return row.acceptedByName ? `${base} (${row.acceptedByName})` : base;
}

function formatMoney(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} RUB`;
}

function parseNumberInput(value: string): number {
  const normalized = String(value || "").replace(",", ".").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function responseDetail(resp: Response): Promise<string> {
  const body = await resp.text().catch(() => "");
  if (!body) return "";
  try {
    return String(JSON.parse(body)?.detail || body);
  } catch {
    return body;
  }
}

export default function OrdersReportCreatePage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [serviceNameById, setServiceNameById] = useState<Record<string, string>>({});
  const [serviceObjectNameById, setServiceObjectNameById] = useState<Record<string, string>>({});
  const [workTypeNameById, setWorkTypeNameById] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [oldMoneyRows, setOldMoneyRows] = useState<ReportRow[]>([]);
  const [minimumSalary, setMinimumSalary] = useState("1000");
  const [salaryCashFromChange, setSalaryCashFromChange] = useState("0");
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(false);

  const selectedWarehouse = warehouses.find((item) => item.id === warehouseId) || null;

  const authHeaders = useCallback(async () => {
    let token = getToken();
    if (!token) {
      try {
        const kc = await getKeycloak();
        try {
          await kc.updateToken(30);
        } catch {
          // API will return 401 if refresh fails.
        }
        token = kc.token || "";
        if (token) {
          (window as any).__hubcrmAccessToken = token;
        }
      } catch {
        // Keep empty token; clear API error will be shown below.
      }
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingLookups(true);
      setError("");
      try {
        const headers = await authHeaders();
        const [warehousesResp, categoriesResp, serviceObjectsResp, workTypesResp] = await Promise.all([
          fetch(`${base}/warehouses/warehouses/accessible`, { cache: "no-store", headers }),
          fetch(`${base}/orders/settings/service-categories/accessible`, { cache: "no-store", headers }),
          fetch(`${base}/orders/settings/service-objects?limit=500`, { cache: "no-store", headers }),
          fetch(`${base}/orders/settings/work-types?limit=500`, { cache: "no-store", headers }),
        ]);
        if (!warehousesResp.ok) {
          const body = await warehousesResp.text().catch(() => "");
          throw new Error(`Не удалось загрузить склады: ${warehousesResp.status} ${body}`);
        }
        if (!categoriesResp.ok) {
          const body = await categoriesResp.text().catch(() => "");
          throw new Error(`Не удалось загрузить услуги: ${categoriesResp.status} ${body}`);
        }
        if (!serviceObjectsResp.ok) {
          const body = await serviceObjectsResp.text().catch(() => "");
          throw new Error(`Не удалось загрузить объекты ремонта: ${serviceObjectsResp.status} ${body}`);
        }
        if (!workTypesResp.ok) {
          const body = await workTypesResp.text().catch(() => "");
          throw new Error(`Не удалось загрузить виды работ: ${workTypesResp.status} ${body}`);
        }
        const warehouseRows = (await warehousesResp.json()) as WarehouseOption[];
        const categoryRows = (await categoriesResp.json()) as ServiceCategory[];
        const serviceObjectRows = (await serviceObjectsResp.json()) as ServiceObject[];
        const workTypeRows = (await workTypesResp.json()) as WorkType[];
        const nextServiceMap: Record<string, string> = {};
        const nextServiceObjectMap: Record<string, string> = {};
        const nextWorkTypeMap: Record<string, string> = {};
        for (const item of categoryRows || []) {
          nextServiceMap[String(item.id)] = String(item.name || "");
        }
        for (const item of serviceObjectRows || []) {
          nextServiceObjectMap[String(item.id)] = String(item.name || "");
        }
        for (const item of workTypeRows || []) {
          nextWorkTypeMap[String(item.id)] = String(item.name || "");
        }
        setWarehouses(Array.isArray(warehouseRows) ? warehouseRows : []);
        setServiceNameById(nextServiceMap);
        setServiceObjectNameById(nextServiceObjectMap);
        setWorkTypeNameById(nextWorkTypeMap);
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить данные формы.");
        setWarehouses([]);
        setServiceNameById({});
        setServiceObjectNameById({});
        setWorkTypeNameById({});
      } finally {
        setLoadingLookups(false);
      }
    })();
  }, [authHeaders, base]);

  useEffect(() => {
    setGenerated(false);
    setRows([]);
    setOldMoneyRows([]);
    setMinimumSalary("1000");
    setSalaryCashFromChange("0");
  }, [warehouseId, reportDate]);

  const loadOrdersForDay = useCallback(async () => {
    const headers = await authHeaders();
    const allItems: OrderItem[] = [];
    let currentPage = 1;
    let totalPages = 1;

    do {
      const resp = await fetch(
        `${base}/orders/orders?page=${currentPage}&page_size=100&warehouse_id=${encodeURIComponent(
          warehouseId
        )}&created_from=${encodeURIComponent(reportDate)}&created_to=${encodeURIComponent(reportDate)}`,
        {
          cache: "no-store",
          headers,
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Не удалось загрузить заказы: ${resp.status} ${body}`);
      }
      const payload = (await resp.json()) as OrdersPage;
      allItems.push(...(Array.isArray(payload.items) ? payload.items : []));
      totalPages = Math.max(1, Number(payload.total_pages || 1));
      currentPage += 1;
    } while (currentPage <= totalPages);

    return allItems;
  }, [authHeaders, base, reportDate, warehouseId]);

  const loadFinanceLines = useCallback(
    async (orderId: string) => {
      const resp = await fetch(`${base}/finance/finance/orders/${encodeURIComponent(orderId)}/lines`, {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Не удалось загрузить финансы заказа: ${resp.status} ${body}`);
      }
      return ((await resp.json()) as FinanceLine[]) || [];
    },
    [authHeaders, base]
  );

  const loadChangedOrdersForDay = useCallback(async () => {
    const resp = await fetch(
      `${base}/finance/finance/orders/changed-by-date?changed_from=${encodeURIComponent(reportDate)}&changed_to=${encodeURIComponent(
        reportDate
      )}`,
      {
        cache: "no-store",
        headers: await authHeaders(),
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Не удалось загрузить изменения по деньгам: ${resp.status} ${body}`);
    }
    return ((await resp.json()) as ChangedOrderItem[]) || [];
  }, [authHeaders, base, reportDate]);

  const loadOrdersByIds = useCallback(
    async (orderIds: string[]) => {
      if (!orderIds.length) return [];
      const allItems: OrderItem[] = [];
      let currentPage = 1;
      let totalPages = 1;
      const headers = await authHeaders();
      do {
        const resp = await fetch(
          `${base}/orders/orders?page=${currentPage}&page_size=100&warehouse_id=${encodeURIComponent(
            warehouseId
          )}&order_ids=${encodeURIComponent(orderIds.join(","))}`,
          {
            cache: "no-store",
            headers,
          }
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить старые заказы: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as OrdersPage;
        allItems.push(...(Array.isArray(payload.items) ? payload.items : []));
        totalPages = Math.max(1, Number(payload.total_pages || 1));
        currentPage += 1;
      } while (currentPage <= totalPages);
      return allItems;
    },
    [authHeaders, base, warehouseId]
  );

  const buildReportRows = useCallback(
    async (orderItems: OrderItem[]) => {
      const currentUserUuid = currentUserUuidFromToken();
      const financeByOrder = await Promise.all(
        orderItems.map(async (order) => ({
          order,
          lines: await loadFinanceLines(order.id),
        }))
      );
      return financeByOrder
        .map(({ order, lines }) => {
          const revenue = (lines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0);
          const costPrice = (lines || []).reduce((sum, line) => sum + Number(line.cost_price || 0), 0);
          const creatorUuid = String(order.created_by_uuid || "").trim().toLowerCase();
          const acceptedByName =
            creatorUuid && creatorUuid !== currentUserUuid ? String(order.created_by_name || "").trim() : "";
          return {
            orderId: order.id,
            orderNumber: order.order_number ?? null,
            acceptedByName,
            serviceName: serviceNameById[String(order.service_category_id || "")] || "-",
            serviceObjectName: serviceObjectNameById[String(order.service_object_id || "")] || "-",
            workTypeName:
              (order.work_type_ids || [])
                .map((id) => workTypeNameById[String(id)] || String(id))
                .filter(Boolean)
                .join(", ") || "-",
            revenue,
            costPrice,
            comment: "",
            profitPercent: 30,
          } satisfies ReportRow;
        })
        .sort((a, b) => Number(a.orderNumber || 0) - Number(b.orderNumber || 0));
    },
    [loadFinanceLines, serviceNameById, serviceObjectNameById, workTypeNameById]
  );

  const onCreateReport = useCallback(async () => {
    if (!warehouseId) {
      setError("Выберите склад.");
      return;
    }
    if (!reportDate) {
      setError("Выберите дату отчёта.");
      return;
    }
    setLoadingReport(true);
    setError("");
    try {
      const orderItems = await loadOrdersForDay();
      const nextRows = await buildReportRows(orderItems);
      const currentOrderIds = new Set(orderItems.map((item) => item.id));
      const changedOrders = await loadChangedOrdersForDay();
      const extraOrderIds = Array.from(
        new Set(
          changedOrders
            .map((item) => String(item.order_uuid || "").trim())
            .filter((id) => !!id && !currentOrderIds.has(id))
        )
      );
      const extraOrders = await loadOrdersByIds(extraOrderIds);
      const extraRows = await buildReportRows(extraOrders);
      setRows(nextRows);
      setOldMoneyRows(extraRows);
      setGenerated(true);
    } catch (e: any) {
      setRows([]);
      setOldMoneyRows([]);
      setGenerated(false);
      setError(e?.message || "Не удалось сформировать отчёт.");
    } finally {
      setLoadingReport(false);
    }
  }, [buildReportRows, loadChangedOrdersForDay, loadOrdersByIds, loadOrdersForDay, reportDate, warehouseId]);

  useEffect(() => {
    if (!warehouseId || !reportDate) return;
    void onCreateReport();
  }, [warehouseId, reportDate, onCreateReport]);

  const totals = useMemo(() => {
    const minimumSalaryValue = parseNumberInput(minimumSalary);
    const salaryFromChangeValue = parseNumberInput(salaryCashFromChange);
    const baseTotals = [...rows, ...oldMoneyRows].reduce(
      (acc, row) => {
        const profit = row.revenue - row.costPrice;
        const masterSalary = Math.max(0, (profit * row.profitPercent) / 100);
        const cashRemainder = row.revenue - masterSalary;
        acc.revenue += row.revenue;
        acc.masterSalary += masterSalary;
        acc.cashRemainder += cashRemainder;
        return acc;
      },
      { revenue: 0, masterSalary: 0, cashRemainder: 0 }
    );
    const masterSalaryBeforeMinimum = baseTotals.masterSalary;
    const minimumSalaryDelta = Math.max(0, minimumSalaryValue - masterSalaryBeforeMinimum);
    const masterSalary = masterSalaryBeforeMinimum + minimumSalaryDelta;
    const salaryCashTotalTooHigh = salaryFromChangeValue > masterSalary;
    const salaryFromChangeApplied = salaryCashTotalTooHigh ? 0 : salaryFromChangeValue;
    return {
      ...baseTotals,
      masterSalary,
      cashRemainder:
        baseTotals.cashRemainder +
        salaryFromChangeApplied -
        minimumSalaryDelta,
      salaryCashTotalTooHigh,
      salaryFromChangeApplied,
    };
  }, [minimumSalary, oldMoneyRows, rows, salaryCashFromChange]);

  const salaryCashFromChangeValue = parseNumberInput(salaryCashFromChange);
  const salaryCashTotalTooHigh = totals.salaryCashTotalTooHigh;
  const dayRowsTotals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          revenue: acc.revenue + Number(row.revenue || 0),
          costPrice: acc.costPrice + Number(row.costPrice || 0),
        }),
        { revenue: 0, costPrice: 0 }
      ),
    [rows]
  );
  const oldMoneyRowsTotals = useMemo(
    () =>
      oldMoneyRows.reduce(
        (acc, row) => ({
          revenue: acc.revenue + Number(row.revenue || 0),
          costPrice: acc.costPrice + Number(row.costPrice || 0),
        }),
        { revenue: 0, costPrice: 0 }
      ),
    [oldMoneyRows]
  );

  const updateComment = useCallback((orderId: string, value: string) => {
    setRows((prev) =>
      prev.map((row) => (row.orderId === orderId ? { ...row, comment: value } : row))
    );
    setOldMoneyRows((prev) =>
      prev.map((row) => (row.orderId === orderId ? { ...row, comment: value } : row))
    );
  }, []);

  const updateProfitPercent = useCallback((orderId: string, value: number) => {
    setRows((prev) =>
      prev.map((row) => (row.orderId === orderId ? { ...row, profitPercent: value } : row))
    );
    setOldMoneyRows((prev) =>
      prev.map((row) => (row.orderId === orderId ? { ...row, profitPercent: value } : row))
    );
  }, []);

  const removeDayRow = useCallback((orderId: string) => {
    setRows((prev) => prev.filter((row) => row.orderId !== orderId));
  }, []);

  const removeOldMoneyRow = useCallback((orderId: string) => {
    setOldMoneyRows((prev) => prev.filter((row) => row.orderId !== orderId));
  }, []);

  const onSaveReport = useCallback(async () => {
    if (!warehouseId || !reportDate) {
      setError("Выберите склад и дату отчёта.");
      return;
    }
    if (!rows.length && !oldMoneyRows.length) {
      setError("Нет данных для сохранения отчёта.");
      return;
    }
    if (salaryCashTotalTooHigh) {
      setError("Нельзя взять из размена на зарплату больше суммы зарплаты.");
      return;
    }
    setSaveBusy(true);
    setError("");
    try {
      const resp = await fetch(`${base}/orders/report/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          report_date: reportDate,
          warehouse_id: warehouseId,
          warehouse_name: selectedWarehouse?.name || "",
          minimum_salary: parseNumberInput(minimumSalary),
          salary_cash_from_change: parseNumberInput(salaryCashFromChange),
          salary_cash_from_revenue: 0,
          day_rows: rows.map((row) => ({
            order_id: row.orderId,
            order_number: row.orderNumber,
            service_name: row.serviceName,
            service_object_name: row.serviceObjectName,
            work_type_name: row.workTypeName,
            revenue: row.revenue,
            cost_price: row.costPrice,
            comment: row.comment,
            profit_percent: row.profitPercent,
            is_old_order: false,
          })),
          old_money_rows: oldMoneyRows.map((row) => ({
            order_id: row.orderId,
            order_number: row.orderNumber,
            service_name: row.serviceName,
            service_object_name: row.serviceObjectName,
            work_type_name: row.workTypeName,
            revenue: row.revenue,
            cost_price: row.costPrice,
            comment: row.comment,
            profit_percent: row.profitPercent,
            is_old_order: true,
          })),
        }),
      });
      if (!resp.ok) {
        const detail = await responseDetail(resp);
        throw new Error(detail || `Не удалось сохранить отчёт: ${resp.status}`);
      }
      const payload = (await resp.json()) as SavedReportResponse;
      router.push(`/modules/orders/report/list?open_report_id=${encodeURIComponent(payload.id)}`);
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить отчёт.");
    } finally {
      setSaveBusy(false);
    }
  }, [authHeaders, base, minimumSalary, oldMoneyRows, reportDate, router, rows, salaryCashFromChange, salaryCashTotalTooHigh, selectedWarehouse?.name, warehouseId]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Заказы · Отчет · Создать отчет" />
      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">Создание дневного отчёта</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Выберите склад и дату, затем сформируйте отчёт за день.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Склад</label>
            <select
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              disabled={loadingLookups}
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">{loadingLookups ? "Загрузка..." : "Выберите склад"}</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </div>

          {warehouseId ? (
            <div>
              <DatePicker
                id="orders-report-date"
                mode="single"
                label="Дата отчёта"
                defaultDate={reportDate || undefined}
                placeholder="Выберите дату"
                onChange={(dates) => {
                  const selected = dates?.[0];
                  if (!selected) {
                    setReportDate("");
                    return;
                  }
                  const year = selected.getFullYear();
                  const month = `${selected.getMonth() + 1}`.padStart(2, "0");
                  const day = `${selected.getDate()}`.padStart(2, "0");
                  setReportDate(`${year}-${month}-${day}`);
                }}
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        {generated ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              Склад: <span className="font-medium">{selectedWarehouse?.name || "-"}</span> | Дата:{" "}
              <span className="font-medium">{reportDate || "-"}</span>
            </div>

            {!rows.length ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {oldMoneyRows.length
                  ? "За выбранную дату новых заказов по этому складу нет, но есть оплаты по старым заказам."
                  : "За выбранную дату заказов по этому складу нет."}
              </div>
            ) : null}

            {rows.length ? (
              <>
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
                  <div className="max-w-full overflow-x-auto">
                    <Table>
                      <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                        <TableRow>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Номер заказа
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Услуга
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Объект ремонта
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Вид работы
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Стоимость
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Себестоимость
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Комментарий
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Процент прибыли
                          </TableCell>
                          <TableCell isHeader className="w-14 px-3 py-3 text-end text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            <span className="sr-only">Убрать из отчёта</span>
                          </TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                        {rows.map((row) => (
                          <TableRow key={row.orderId}>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                              {orderNumberLabel(row)}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {row.serviceName}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {row.serviceObjectName}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {row.workTypeName}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {formatMoney(row.revenue)}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {formatMoney(row.costPrice)}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              <input
                                value={row.comment}
                                onChange={(event) => updateComment(row.orderId, event.target.value)}
                                placeholder="Комментарий"
                                className="h-9 w-full min-w-[180px] rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              />
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              <select
                                value={String(row.profitPercent)}
                                onChange={(event) => updateProfitPercent(row.orderId, Number(event.target.value))}
                                className="h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              >
                                {profitOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}%
                                  </option>
                                ))}
                              </select>
                            </TableCell>
                            <TableCell className="px-3 py-4 text-end align-middle">
                              <button
                                type="button"
                                title="Убрать из отчёта"
                                aria-label="Убрать заказ из отчёта"
                                onClick={() => removeDayRow(row.orderId)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-500 transition hover:border-gray-200 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white"
                              >
                                <CloseIcon className="h-4 w-4 fill-current" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50 font-semibold dark:bg-gray-900">
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            Итого: {rows.length}
                          </TableCell>
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            {formatMoney(dayRowsTotals.revenue)}
                          </TableCell>
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            {formatMoney(dayRowsTotals.costPrice)}
                          </TableCell>
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-3 py-4" />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>

              </>
            ) : null}

            {oldMoneyRows.length ? (
              <div className="space-y-6">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  Старые заказы: деньги были внесены в кассу в этот день по выбранному складу, хотя сами заказы созданы раньше.
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
                  <div className="max-w-full overflow-x-auto">
                    <Table>
                      <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                        <TableRow>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Номер заказа
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Услуга
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Объект ремонта
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Вид работы
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Стоимость
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Себестоимость
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Комментарий
                          </TableCell>
                          <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            Процент прибыли
                          </TableCell>
                          <TableCell isHeader className="w-14 px-3 py-3 text-end text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                            <span className="sr-only">Убрать из отчёта</span>
                          </TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                        {oldMoneyRows.map((row) => (
                          <TableRow key={`old-${row.orderId}`}>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                              {orderNumberLabel(row)}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {row.serviceName}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {row.serviceObjectName}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {row.workTypeName}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {formatMoney(row.revenue)}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              {formatMoney(row.costPrice)}
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              <input
                                value={row.comment}
                                onChange={(event) => updateComment(row.orderId, event.target.value)}
                                placeholder="Комментарий"
                                className="h-9 w-full min-w-[180px] rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              />
                            </TableCell>
                            <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                              <select
                                value={String(row.profitPercent)}
                                onChange={(event) => updateProfitPercent(row.orderId, Number(event.target.value))}
                                className="h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              >
                                {profitOptions.map((option) => (
                                  <option key={`old-${option}`} value={option}>
                                    {option}%
                                  </option>
                                ))}
                              </select>
                            </TableCell>
                            <TableCell className="px-3 py-4 text-end align-middle">
                              <button
                                type="button"
                                title="Убрать из отчёта"
                                aria-label="Убрать заказ из отчёта"
                                onClick={() => removeOldMoneyRow(row.orderId)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-500 transition hover:border-gray-200 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white"
                              >
                                <CloseIcon className="h-4 w-4 fill-current" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50 font-semibold dark:bg-gray-900">
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            Итого: {oldMoneyRows.length}
                          </TableCell>
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            {formatMoney(oldMoneyRowsTotals.revenue)}
                          </TableCell>
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            {formatMoney(oldMoneyRowsTotals.costPrice)}
                          </TableCell>
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-5 py-4" />
                          <TableCell className="px-3 py-4" />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            ) : null}

            {rows.length || oldMoneyRows.length ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 dark:border-gray-800 dark:bg-white/[0.03]">
                    <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
                      <div className="text-sm font-semibold text-gray-800 dark:text-white/90">Минимальная зарплата</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={minimumSalary}
                      onChange={(event) => setMinimumSalary(event.target.value)}
                      placeholder="1000"
                      className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                    />
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 dark:border-gray-800 dark:bg-white/[0.03]">
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        Взято денег на зарплату из размена
                      </div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={totals.masterSalary}
                      step="0.01"
                      value={salaryCashFromChange}
                      onChange={(event) => setSalaryCashFromChange(event.target.value)}
                      placeholder="0"
                      className={`h-11 w-full rounded-lg border bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:outline-hidden focus:ring-3 dark:bg-gray-900 dark:text-white/90 ${
                        salaryCashTotalTooHigh
                          ? "border-red-300 focus:border-red-300 focus:ring-red-500/10 dark:border-red-500"
                          : "border-gray-300 focus:border-brand-300 focus:ring-brand-500/10 dark:border-gray-700"
                      }`}
                    />
                    {salaryCashTotalTooHigh ? (
                      <div className="mt-2 text-sm text-red-600">
                        Нельзя взять больше зарплаты: {formatMoney(totals.masterSalary)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Выручка</div>
                  <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">{formatMoney(totals.revenue)}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">ЗП мастера</div>
                  <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">{formatMoney(totals.masterSalary)}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Остаток в кассе</div>
                  <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">{formatMoney(totals.cashRemainder)}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Из размена на ЗП</div>
                  <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">
                    {formatMoney(totals.salaryFromChangeApplied)}
                  </div>
                </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {generated ? (
          <div className="flex justify-end">
            <Button
              onClick={() => void onSaveReport()}
              disabled={
                !warehouseId ||
                !reportDate ||
                loadingReport ||
                loadingLookups ||
                saveBusy ||
                salaryCashTotalTooHigh ||
                (!rows.length && !oldMoneyRows.length)
              }
            >
              {saveBusy ? "Сохраняю..." : "Создать"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
