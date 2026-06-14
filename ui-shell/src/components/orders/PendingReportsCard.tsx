"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";

type ReportSummary = {
  id: string;
  report_number: number;
  report_date: string;
  warehouse_name: string;
  total_revenue: number;
  salary_cash_from_change: number;
  checked_at?: string | null;
  created_by_name?: string;
  created_by_uuid?: string | null;
  created_at: string;
};

type ReportListResponse = {
  items: ReportSummary[];
};

function parseJwtPayload(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 ? "=".repeat(4 - (payload.length % 4)) : "";
    return JSON.parse(window.atob(payload + pad));
  } catch {
    return null;
  }
}

function isAdminToken(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload) return false;
  const realmRoles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
  if (realmRoles.includes("superadmin") || realmRoles.includes("admin")) return true;
  const resourceAccess = payload?.resource_access || {};
  return Object.values(resourceAccess).some(
    (obj: any) => Array.isArray(obj?.roles) && (obj.roles.includes("superadmin") || obj.roles.includes("admin"))
  );
}

function formatMoney(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

export default function PendingReportsCard() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<ReportSummary[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});

  const authHeaders = useCallback(async () => {
    let token = String((window as any).__hubcrmAccessToken || "").trim();
    if (!token) {
      const kc = await getKeycloak();
      await kc.updateToken(30).catch(() => undefined);
      token = String(kc.token || "").trim();
      if (token) (window as any).__hubcrmAccessToken = token;
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: "1", page_size: "10", checked: "false" });
      const resp = await fetch(`${base}/orders/report/reports?${qs.toString()}`, {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Не удалось загрузить отчёты: ${resp.status} ${body}`);
      }
      const payload = (await resp.json()) as ReportListResponse;
      setItems((Array.isArray(payload.items) ? payload.items : []).filter((item) => !item.checked_at));
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить отчёты.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, base]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const headers = await authHeaders().catch(() => ({}));
      const token = String(headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!alive) return;
      const nextIsAdmin = isAdminToken(token);
      setIsAdmin(nextIsAdmin);
      setAccessReady(true);
      if (nextIsAdmin) void load();
    })();
    return () => {
      alive = false;
    };
  }, [authHeaders, load]);

  const markChecked = async (reportId: string) => {
    setSavingById((prev) => ({ ...prev, [reportId]: true }));
    setError("");
    try {
      const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/check`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({ checked: true }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Не удалось отметить отчёт: ${resp.status} ${body}`);
      }
      setItems((prev) => prev.filter((item) => item.id !== reportId));
    } catch (e: any) {
      setError(e?.message || "Не удалось отметить отчёт.");
    } finally {
      setSavingById((prev) => ({ ...prev, [reportId]: false }));
    }
  };

  if (!accessReady || !isAdmin) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Отчеты</h3>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">Непроверенные отчёты без галочки.</div>
        </div>
        <Link href="/modules/orders/report/list" className="text-sm font-medium text-brand-500 hover:text-brand-600">
          Все отчёты
        </Link>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
      ) : error ? (
        <div className="py-10 text-center text-sm text-red-500">Ошибка: {error}</div>
      ) : !items.length ? (
        <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Непроверенных отчётов нет.</div>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <Table>
            <TableHeader className="border-gray-100 dark:border-gray-800 border-y">
              <TableRow>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Отчёт
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Склад
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Мастер
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Выручка
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Создан
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-end text-theme-xs dark:text-gray-400">
                  Действие
                </TableCell>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="py-3 text-start text-theme-sm text-gray-800 dark:text-white/90">
                    <Link href={`/modules/orders/report/list?open_report_id=${encodeURIComponent(item.id)}`} className="font-medium text-brand-500 hover:text-brand-600">
                      #{item.report_number} от {item.report_date}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                    {item.warehouse_name || "-"}
                  </TableCell>
                  <TableCell className="py-3 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                    {item.created_by_name || item.created_by_uuid || "-"}
                  </TableCell>
                  <TableCell className="py-3 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                    {formatMoney(item.total_revenue)}
                  </TableCell>
                  <TableCell className="py-3 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                    {formatDateTime(item.created_at)}
                  </TableCell>
                  <TableCell className="py-3 text-end text-theme-sm">
                    <button
                      type="button"
                      disabled={!!savingById[item.id]}
                      onClick={() => void markChecked(item.id)}
                      className="rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-60 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
                    >
                      Проверено
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
