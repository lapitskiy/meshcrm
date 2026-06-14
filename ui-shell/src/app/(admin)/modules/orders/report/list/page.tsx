"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import DatePicker from "@/components/form/date-picker";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";
import { ChevronDownIcon } from "@/icons/index";
import { useSearchParams } from "next/navigation";

type WarehouseOption = {
  id: string;
  name: string;
  address?: string;
  point_phone?: string;
  qr_site_svg?: string;
  qr_yandex_svg?: string;
  qr_vk_svg?: string;
  qr_telegram_svg?: string;
};

type UserLite = {
  user_uuid: string;
  username: string;
  email: string;
  full_name: string;
};

type ReportSummary = {
  id: string;
  report_number: number;
  report_date: string;
  warehouse_id: string;
  warehouse_name: string;
  total_revenue: number;
  total_master_salary: number;
  total_cash_remainder: number;
  salary_cash_from_change: number;
  salary_cash_from_revenue: number;
  checked_by_admin_uuid?: string | null;
  checked_at?: string | null;
  created_by_uuid?: string | null;
  created_by_name?: string;
  issue_kind?: string | null;
  created_at: string;
};

type ReportLine = {
  id: string;
  order_id: string;
  order_number: number | null;
  service_name: string;
  service_object_name: string;
  work_type_name: string;
  revenue: number;
  cost_price: number;
  comment: string;
  profit_percent: number;
  is_old_order: boolean;
  sort_order: number;
};

type OrderItem = {
  id: string;
  order_number?: number | null;
  status: string;
  order_kind: string;
  service_category_id: string | null;
  service_object_id: string | null;
  serial_model: string;
  work_type_ids: string[];
  warehouse_id: string | null;
  contact_uuid: string | null;
  created_at: string;
};

type OrdersPage = {
  items: OrderItem[];
};

type FinanceLine = {
  id: string;
  work_type_uuid: string;
  amount: number;
  prepayment?: number | null;
  currency: string;
  payment_method: "card" | "cash" | null;
  is_paid: boolean;
};

type ContactInfo = {
  name?: string;
  phone?: string;
  email?: string;
};

type MissingReportOrder = {
  order_id: string;
  order_number: number | null;
};

type ReportDetail = ReportSummary & {
  lines: ReportLine[];
  day_orders_total_count: number;
  day_report_orders_count: number;
  missing_day_orders: MissingReportOrder[];
};

type ReportIssueHistoryItem = {
  id: string;
  issue_kind: string;
  reason: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type ReportCommentHistoryItem = {
  id: string;
  comment: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type ReportFeedItem =
  | {
      id: string;
      kind: "issue";
      title: string;
      description: string;
      created_at: string;
      created_by_name: string;
    }
  | {
      id: string;
      kind: "comment";
      title: string;
      created_at: string;
      created_by_name: string;
    }
  | {
      id: string;
      kind: "missing_orders";
      title: string;
      orders: MissingReportOrder[];
      created_at: string;
      created_by_name: string;
    };

type PrintFormListItem = {
  id: string;
  title: string;
  category_id?: string | null;
  category_name?: string;
  page_width_mm: number;
  page_height_mm: number;
  page_margin_mm: number;
  page_auto_height: boolean;
  page_offset_x_mm?: number | null;
  page_offset_y_mm?: number | null;
  page_rotation_deg?: number | null;
  updated_at: string;
};

type ReportListResponse = {
  items: ReportSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type ListFilters = {
  report_date: string;
  warehouse_id: string;
  created_by_uuid: string;
};

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

function pageSizeMm(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(2000, Math.round(parsed)));
}

function optionalPrintNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function printTransformCss(form: any): string {
  const x = optionalPrintNumber(form?.page_offset_x_mm);
  const y = optionalPrintNumber(form?.page_offset_y_mm);
  const rotation = optionalPrintNumber(form?.page_rotation_deg);
  const parts: string[] = [];
  if (x !== null || y !== null) parts.push(`translate(${x ?? 0}mm, ${y ?? 0}mm)`);
  if (rotation === 90) parts.push("rotate(90deg) translateY(-100%)");
  if (rotation === 180) parts.push("rotate(180deg) translate(-100%, -100%)");
  if (rotation === 270) parts.push("rotate(270deg) translateX(-100%)");
  return parts.length ? `transform:${parts.join(" ")};transform-origin:top left;` : "";
}

function formatMoney(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} RUB`;
}

function creatorDisplayName(item: UserLite | null | undefined): string {
  if (!item) return "-";
  return String(item.full_name || "").trim() || String(item.username || "").trim() || String(item.email || "").trim() || "-";
}

function formatOrderDateAndTime(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: value, time: "" };
  return { date: parsed.toLocaleDateString("ru-RU"), time: parsed.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) };
}

function orderKindLabel(kind: string): string {
  if (kind === "onsite") return "Выездной";
  if (kind === "remote") return "Дистанционный";
  return "В мастерской";
}

export default function OrdersReportListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const searchParams = useSearchParams();
  const initialOpenReportId = String(searchParams.get("open_report_id") || "").trim();
  const [items, setItems] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [pendingOpenReportId, setPendingOpenReportId] = useState(initialOpenReportId);
  const [detailById, setDetailById] = useState<Record<string, ReportDetail | undefined>>({});
  const [detailLoadingById, setDetailLoadingById] = useState<Record<string, boolean>>({});
  const [detailErrorById, setDetailErrorById] = useState<Record<string, string>>({});
  const [issueHistoryByReport, setIssueHistoryByReport] = useState<Record<string, ReportIssueHistoryItem[]>>({});
  const [issueHistoryLoadingByReport, setIssueHistoryLoadingByReport] = useState<Record<string, boolean>>({});
  const [issueHistoryErrorByReport, setIssueHistoryErrorByReport] = useState<Record<string, string>>({});
  const [issueDraftOpenByReport, setIssueDraftOpenByReport] = useState<Record<string, boolean>>({});
  const [issueDraftTextByReport, setIssueDraftTextByReport] = useState<Record<string, string>>({});
  const [issueSavingByReport, setIssueSavingByReport] = useState<Record<string, boolean>>({});
  const [commentHistoryByReport, setCommentHistoryByReport] = useState<Record<string, ReportCommentHistoryItem[]>>({});
  const [commentHistoryLoadingByReport, setCommentHistoryLoadingByReport] = useState<Record<string, boolean>>({});
  const [commentHistoryErrorByReport, setCommentHistoryErrorByReport] = useState<Record<string, string>>({});
  const [commentDraftOpenByReport, setCommentDraftOpenByReport] = useState<Record<string, boolean>>({});
  const [commentDraftTextByReport, setCommentDraftTextByReport] = useState<Record<string, string>>({});
  const [commentSavingByReport, setCommentSavingByReport] = useState<Record<string, boolean>>({});
  const [printForms, setPrintForms] = useState<PrintFormListItem[]>([]);
  const [printFormsLoading, setPrintFormsLoading] = useState(false);
  const [printFormsError, setPrintFormsError] = useState("");
  const [printDropdownReportId, setPrintDropdownReportId] = useState<string | null>(null);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseById, setWarehouseById] = useState<Record<string, WarehouseOption>>({});
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmClearProblemByReport, setConfirmClearProblemByReport] = useState<Record<string, boolean>>({});
  const [checkMenuOpenByReport, setCheckMenuOpenByReport] = useState<Record<string, boolean>>({});
  const [checkSavingByReport, setCheckSavingByReport] = useState<Record<string, boolean>>({});
  const [checkErrorByReport, setCheckErrorByReport] = useState<Record<string, string>>({});
  const [confirmDeleteByReport, setConfirmDeleteByReport] = useState<Record<string, boolean>>({});
  const [deleteSavingByReport, setDeleteSavingByReport] = useState<Record<string, boolean>>({});
  const [deleteErrorByReport, setDeleteErrorByReport] = useState<Record<string, string>>({});
  const [creatorFilterQuery, setCreatorFilterQuery] = useState("");
  const [creatorFilterOptions, setCreatorFilterOptions] = useState<UserLite[]>([]);
  const [creatorFilterOpen, setCreatorFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<ListFilters>({
    report_date: "",
    warehouse_id: "",
    created_by_uuid: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<ListFilters>({
    report_date: "",
    warehouse_id: "",
    created_by_uuid: "",
  });

  const parseJwtPayload = (token: string): any => {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return null;
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = payload.length % 4 ? "=".repeat(4 - (payload.length % 4)) : "";
      return JSON.parse(atob(payload + pad));
    } catch {
      return null;
    }
  };

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
        // Keep empty token; request will fail with a clear error.
      }
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    const payload = parseJwtPayload(getToken());
    const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
    setIsSuperadmin(roles.includes("superadmin"));
    setIsAdmin(roles.includes("admin") || roles.includes("superadmin"));
  }, []);

  useEffect(() => {
    (async () => {
      setPrintFormsLoading(true);
      setPrintFormsError("");
      try {
        const formsResp = await fetch(`${base}/documents/print/forms?limit=500`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!formsResp.ok) {
          const body = await formsResp.text().catch(() => "");
          throw new Error(`Не удалось загрузить формы печати: ${formsResp.status} ${body}`);
        }
        setPrintForms(((await formsResp.json()) as PrintFormListItem[]) || []);

        const resp = await fetch(`${base}/warehouses/warehouses/accessible`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) return;
        const warehouses = ((await resp.json()) as WarehouseOption[]) || [];
        setWarehouseOptions(warehouses);
        setWarehouseById(
          warehouses.reduce<Record<string, WarehouseOption>>((acc, row) => {
            if (row.id) acc[row.id] = row;
            return acc;
          }, {})
        );
      } catch (e: any) {
        setPrintFormsError(e?.message || "Не удалось загрузить формы печати.");
      } finally {
        setPrintFormsLoading(false);
      }
    })();
  }, [authHeaders, base]);

  useEffect(() => {
    if (!isSuperadmin) return;
    const term = creatorFilterQuery.trim();
    if (!creatorFilterOpen && term.length < 2) {
      setCreatorFilterOptions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const resp = await fetch(`${base}/orders/report/creators/options?q=${encodeURIComponent(term)}`, {
            cache: "no-store",
            headers: await authHeaders(),
          });
          if (!resp.ok) return;
          setCreatorFilterOptions(((await resp.json()) as UserLite[]) || []);
        } catch {
          setCreatorFilterOptions([]);
        }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [authHeaders, base, creatorFilterOpen, creatorFilterQuery, isSuperadmin]);

  const load = useCallback(
    async (targetPage: number, filtersArg?: ListFilters) => {
      setLoading(true);
      setError("");
      try {
        const filters = filtersArg || appliedFilters;
        const qs = new URLSearchParams();
        qs.set("page", String(targetPage));
        qs.set("page_size", "20");
        if (filters.report_date) qs.set("report_date", filters.report_date);
        if (filters.warehouse_id) qs.set("warehouse_id", filters.warehouse_id);
        if (filters.created_by_uuid) qs.set("created_by_uuid", filters.created_by_uuid);
        const resp = await fetch(`${base}/orders/report/reports?${qs.toString()}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить отчёты: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as ReportListResponse;
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setPage(Number(payload.page || targetPage));
        setTotalPages(Math.max(1, Number(payload.total_pages || 1)));
        if (pendingOpenReportId && (payload.items || []).some((item) => item.id === pendingOpenReportId)) {
          setOpenReportId(pendingOpenReportId);
          setPendingOpenReportId("");
        } else if (!pendingOpenReportId) {
          setOpenReportId(null);
        }
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить отчёты.");
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters, authHeaders, base, pendingOpenReportId]
  );

  useEffect(() => {
    void load(1, appliedFilters);
  }, [appliedFilters, load]);

  const loadDetail = useCallback(
    async (reportId: string) => {
      if (detailById[reportId]) return;
      setDetailLoadingById((prev) => ({ ...prev, [reportId]: true }));
      setDetailErrorById((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить детали отчёта: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as ReportDetail;
        setDetailById((prev) => ({ ...prev, [reportId]: payload }));
      } catch (e: any) {
        setDetailErrorById((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось загрузить детали отчёта." }));
      } finally {
        setDetailLoadingById((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base, detailById]
  );

  const loadIssueHistory = useCallback(
    async (reportId: string, force = false) => {
      if (!force && issueHistoryByReport[reportId]) return;
      setIssueHistoryLoadingByReport((prev) => ({ ...prev, [reportId]: true }));
      setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/issues?limit=100`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить проблемы отчёта: ${resp.status} ${body}`);
        }
        const payload = ((await resp.json()) as ReportIssueHistoryItem[]) || [];
        setIssueHistoryByReport((prev) => ({ ...prev, [reportId]: payload }));
      } catch (e: any) {
        setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось загрузить проблемы отчёта." }));
      } finally {
        setIssueHistoryLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base, issueHistoryByReport]
  );

  const loadCommentHistory = useCallback(
    async (reportId: string, force = false) => {
      if (!force && commentHistoryByReport[reportId]) return;
      setCommentHistoryLoadingByReport((prev) => ({ ...prev, [reportId]: true }));
      setCommentHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/comments?limit=100`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить комментарии отчёта: ${resp.status} ${body}`);
        }
        const payload = ((await resp.json()) as ReportCommentHistoryItem[]) || [];
        setCommentHistoryByReport((prev) => ({ ...prev, [reportId]: payload }));
      } catch (e: any) {
        setCommentHistoryErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось загрузить комментарии отчёта." }));
      } finally {
        setCommentHistoryLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base, commentHistoryByReport]
  );

  useEffect(() => {
    if (!openReportId) return;
    if (detailById[openReportId]) return;
    void loadDetail(openReportId);
  }, [detailById, loadDetail, openReportId]);

  useEffect(() => {
    if (!openReportId) return;
    void loadIssueHistory(openReportId);
    void loadCommentHistory(openReportId);
  }, [loadCommentHistory, loadIssueHistory, openReportId]);

  const onToggleOpen = useCallback(
    (reportId: string) => {
      setOpenReportId((prev) => (prev === reportId ? null : reportId));
      if (openReportId !== reportId) {
        void loadDetail(reportId);
        void loadIssueHistory(reportId);
        void loadCommentHistory(reportId);
      }
    },
    [loadCommentHistory, loadDetail, loadIssueHistory, openReportId]
  );

  const onApplyFilters = useCallback(async () => {
    setAppliedFilters(draftFilters);
    await load(1, draftFilters);
  }, [draftFilters, load]);

  const renderTemplate = (html: string, ctx: Record<string, string>) => {
    const source = String(html || "");
    const ctxLower: Record<string, string> = {};
    const unknown = new Set<string>();
    for (const [k, v] of Object.entries(ctx)) ctxLower[k.toLowerCase()] = String(v ?? "");
    const rendered = source.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, keyRaw: string) => {
      const key = String(keyRaw || "").replace(/\u00a0/g, " ").trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(ctxLower, key)) return ctxLower[key];
      const sizedQr = key.match(/^warehouse_qr_(site|yandex|vk|telegram)_svg_(\d{1,4})$/i);
      if (sizedQr) {
        const channel = String(sizedQr[1] || "").toLowerCase();
        const px = Math.max(32, Math.min(600, Number.parseInt(String(sizedQr[2] || "100"), 10) || 100));
        return fitSvgForPrint(String(ctxLower[`warehouse_qr_${channel}_svg_raw`] || ""), px);
      }
      unknown.add(String(keyRaw || "").replace(/\u00a0/g, " ").trim());
      return "";
    });
    if (unknown.size) throw new Error(`В форме печати неизвестные переменные: ${[...unknown].join(", ")}`);
    return rendered;
  };

  const formatPrintLines = (lines: ReportLine[], lineToText: (line: ReportLine) => string) =>
    lines
      .map((line) => `- ${lineToText(line)}`)
      .join('<br/><div style="border-top:1px dashed #9ca3af; margin:6px 0;"></div>');

  const fitSvgForPrint = (rawSvg: string, targetPx = 100): string => {
    const source = String(rawSvg || "").trim();
    if (!source || !source.toLowerCase().includes("<svg")) return source;
    const asBase64 = (() => {
      try {
        return window.btoa(unescape(encodeURIComponent(source)));
      } catch {
        return "";
      }
    })();
    if (!asBase64) return source;
    return `<img src="data:image/svg+xml;base64,${asBase64}" width="${targetPx}" height="${targetPx}" style="display:block; width:${targetPx}px; height:${targetPx}px; object-fit:contain;" />`;
  };

  const fetchWithRetry = async (url: string, init?: RequestInit, retries = 1, delayMs = 350): Promise<Response> => {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (retries <= 0) throw err;
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      return fetchWithRetry(url, init, retries - 1, delayMs);
    }
  };

  const templateUsesOrderContext = (html: string): boolean => {
    const orderKeys = new Set([
      "contact_name",
      "contact_phone",
      "contact_email",
      "order_id",
      "order_number",
      "order_status",
      "order_kind",
      "order_created_at",
      "order_created_time",
      "user_name",
      "user_login",
      "service_category_name",
      "service_object_name",
      "serial_model",
      "work_types",
      "payment_method",
      "is_paid",
      "total_amount",
      "lines_text",
    ]);
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(String(html || ""))) !== null) {
      const key = String(match[1] || "").replace(/\u00a0/g, " ").trim().toLowerCase();
      if (orderKeys.has(key) || /^warehouse_qr_(site|yandex|vk|telegram)_svg/i.test(key)) return true;
    }
    return false;
  };

  const buildReportPrintCtx = (detail: ReportDetail, lineToText: (line: ReportLine) => string): Record<string, string> => {
    const dayLines = (detail.lines || []).filter((line) => !line.is_old_order);
    const oldLines = (detail.lines || []).filter((line) => !!line.is_old_order);
    return {
      report_number: String(detail.report_number ?? ""),
      report_date: String(detail.report_date || ""),
      warehouse_name: String(detail.warehouse_name || "-"),
      created_by_name: String(detail.created_by_name || detail.created_by_uuid || "-"),
      created_at: detail.created_at ? new Date(detail.created_at).toLocaleString("ru-RU") : "",
      total_revenue: formatMoney(detail.total_revenue),
      total_master_salary: formatMoney(detail.total_master_salary),
      total_cash_remainder: formatMoney(detail.total_cash_remainder),
      salary_cash_from_change: formatMoney(detail.salary_cash_from_change),
      salary_cash_from_revenue: formatMoney(detail.salary_cash_from_revenue),
      issue_kind: detail.issue_kind === "problem" ? "Проблема" : "",
      day_lines_text: formatPrintLines(dayLines, lineToText),
      old_lines_text: formatPrintLines(oldLines, lineToText),
      all_lines_text: formatPrintLines(detail.lines || [], lineToText),
    };
  };

  const loadOrdersByIds = async (orderIds: string[]): Promise<OrderItem[]> => {
    const result: OrderItem[] = [];
    for (let i = 0; i < orderIds.length; i += 100) {
      const chunk = orderIds.slice(i, i + 100);
      const resp = await fetchWithRetry(`${base}/orders/orders?page_size=100&order_ids=${encodeURIComponent(chunk.join(","))}`, {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (!resp.ok) throw new Error(`orders load failed: ${resp.status} ${await resp.text().catch(() => "")}`);
      result.push(...(((await resp.json()) as OrdersPage).items || []));
    }
    return result;
  };

  const buildOrderPrintCtx = async (
    order: OrderItem,
    reportLines: ReportLine[],
    reportCtx: Record<string, string>
  ): Promise<Record<string, string>> => {
    const [financeResp, contactResp, creatorResp] = await Promise.all([
      fetchWithRetry(`${base}/finance/finance/orders/${encodeURIComponent(order.id)}/lines`, {
        cache: "no-store",
        headers: await authHeaders(),
      }),
      order.contact_uuid
        ? fetchWithRetry(`${base}/contacts/contacts/${encodeURIComponent(order.contact_uuid)}`, {
            cache: "no-store",
            headers: await authHeaders(),
          })
        : Promise.resolve(null as any),
      fetchWithRetry(`${base}/orders/orders/${encodeURIComponent(order.id)}/creator`, {
        cache: "no-store",
        headers: await authHeaders(),
      }),
    ]);
    if (!financeResp.ok) throw new Error(`finance load failed: ${financeResp.status} ${await financeResp.text().catch(() => "")}`);
    if (contactResp && !contactResp.ok) throw new Error(`contact load failed: ${contactResp.status} ${await contactResp.text().catch(() => "")}`);
    if (!creatorResp.ok) throw new Error(`creator load failed: ${creatorResp.status} ${await creatorResp.text().catch(() => "")}`);

    const financeLines = (await financeResp.json()) as FinanceLine[];
    const contact = contactResp ? ((await contactResp.json()) as ContactInfo) : null;
    const creator = (await creatorResp.json()) as UserLite;
    const warehouse = warehouseById[order.warehouse_id || ""];
    const names = reportLines.map((line) => line.work_type_name || line.service_name || line.service_object_name || "Работа");
    const linesTextHtml = (financeLines || [])
      .map((line, idx) => `${names[idx] || line.work_type_uuid}: ${line.amount} ${line.currency || "RUB"}`)
      .join("<br/>");
    const totalAmount = (financeLines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const created = formatOrderDateAndTime(order.created_at);

    return {
      ...reportCtx,
      contact_name: String(contact?.name || "-"),
      contact_phone: String(contact?.phone || "-"),
      contact_email: String(contact?.email || ""),
      order_id: String(order.id || ""),
      order_number: String(order.order_number ?? reportLines[0]?.order_number ?? ""),
      order_status: String(order.status || ""),
      order_kind: orderKindLabel(order.order_kind),
      order_created_at: created.date,
      order_created_time: created.time,
      user_name: creatorDisplayName(creator),
      user_login: String(creator?.username || creator?.email || "-"),
      service_category_name: String(reportLines[0]?.service_name || "-"),
      service_object_name: String(reportLines[0]?.service_object_name || "-"),
      serial_model: String(order.serial_model || ""),
      work_types: names.filter(Boolean).join(", ") || "-",
      warehouse_name: String(warehouse?.name || reportCtx.warehouse_name || "-"),
      warehouse_address: String(warehouse?.address || "-"),
      warehouse_point_phone: String(warehouse?.point_phone || "-"),
      warehouse_qr_site_svg_raw: String(warehouse?.qr_site_svg || ""),
      warehouse_qr_yandex_svg_raw: String(warehouse?.qr_yandex_svg || ""),
      warehouse_qr_vk_svg_raw: String(warehouse?.qr_vk_svg || ""),
      warehouse_qr_telegram_svg_raw: String(warehouse?.qr_telegram_svg || ""),
      payment_method: financeLines?.[0]?.payment_method === "card" ? "Оплата по карте" : financeLines?.[0]?.payment_method === "cash" ? "Наличкой" : "",
      is_paid: financeLines?.some((line) => line.is_paid) ? "Да" : "Нет",
      total_amount: String(totalAmount),
      lines_text: linesTextHtml,
    };
  };

  const buildFeedItems = useCallback(
    (reportId: string, detail?: ReportDetail): ReportFeedItem[] => {
      const issueItems: ReportFeedItem[] = (issueHistoryByReport[reportId] || []).map((entry) => ({
        id: `issue-${entry.id}`,
        kind: "issue",
        title: entry.issue_kind === "problem" ? "Проблема" : entry.issue_kind,
        description: entry.reason,
        created_at: entry.created_at,
        created_by_name: entry.created_by_name || "",
      }));
      const commentItems: ReportFeedItem[] = (commentHistoryByReport[reportId] || []).map((entry) => ({
        id: `comment-${entry.id}`,
        kind: "comment",
        title: entry.comment,
        created_at: entry.created_at,
        created_by_name: entry.created_by_name || "",
      }));
      const missingItems: ReportFeedItem[] = detail?.missing_day_orders?.length
        ? [
            {
              id: `missing-orders-${reportId}`,
              kind: "missing_orders",
              title: "Не добавлены в отчет",
              orders: detail.missing_day_orders,
              created_at: detail.created_at,
              created_by_name: "",
            },
          ]
        : [];
      return [...missingItems, ...issueItems, ...commentItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    [commentHistoryByReport, issueHistoryByReport]
  );

  const onStartComment = useCallback((reportId: string) => {
    setCommentDraftOpenByReport((prev) => ({ ...prev, [reportId]: true }));
    setIssueDraftOpenByReport((prev) => ({ ...prev, [reportId]: false }));
  }, []);

  const onCancelComment = useCallback((reportId: string) => {
    setCommentDraftOpenByReport((prev) => ({ ...prev, [reportId]: false }));
    setCommentDraftTextByReport((prev) => ({ ...prev, [reportId]: "" }));
  }, []);

  const onSaveComment = useCallback(
    async (reportId: string) => {
      const comment = String(commentDraftTextByReport[reportId] || "").trim();
      if (!comment) {
        setCommentHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "Комментарий не должен быть пустым." }));
        return;
      }
      setCommentSavingByReport((prev) => ({ ...prev, [reportId]: true }));
      setCommentHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(await authHeaders()),
          },
          body: JSON.stringify({ comment }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось сохранить комментарий: ${resp.status} ${body}`);
        }
        await loadCommentHistory(reportId, true);
        onCancelComment(reportId);
      } catch (e: any) {
        setCommentHistoryErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось сохранить комментарий." }));
      } finally {
        setCommentSavingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base, commentDraftTextByReport, loadCommentHistory, onCancelComment]
  );

  const onStartIssue = useCallback((reportId: string) => {
    setIssueDraftOpenByReport((prev) => ({ ...prev, [reportId]: true }));
    setCommentDraftOpenByReport((prev) => ({ ...prev, [reportId]: false }));
  }, []);

  const onCancelIssue = useCallback((reportId: string) => {
    setIssueDraftOpenByReport((prev) => ({ ...prev, [reportId]: false }));
    setIssueDraftTextByReport((prev) => ({ ...prev, [reportId]: "" }));
  }, []);

  const onSaveIssue = useCallback(
    async (reportId: string) => {
      const reason = String(issueDraftTextByReport[reportId] || "").trim();
      if (!reason) {
        setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "Описание проблемы не должно быть пустым." }));
        return;
      }
      setIssueSavingByReport((prev) => ({ ...prev, [reportId]: true }));
      setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/issues`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(await authHeaders()),
          },
          body: JSON.stringify({ issue_kind: "problem", reason }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось сохранить проблему: ${resp.status} ${body}`);
        }
        setItems((prev) => prev.map((item) => (item.id === reportId ? { ...item, issue_kind: "problem" } : item)));
        setDetailById((prev) =>
          prev[reportId] ? { ...prev, [reportId]: { ...prev[reportId]!, issue_kind: "problem" } } : prev
        );
        await loadIssueHistory(reportId, true);
        onCancelIssue(reportId);
      } catch (e: any) {
        setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось сохранить проблему." }));
      } finally {
        setIssueSavingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base, issueDraftTextByReport, loadIssueHistory, onCancelIssue]
  );

  const onClearProblem = useCallback(
    async (reportId: string) => {
      setIssueSavingByReport((prev) => ({ ...prev, [reportId]: true }));
      setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/issue-kind`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(await authHeaders()),
          },
          body: JSON.stringify({ issue_kind: null }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось снять проблему: ${resp.status} ${body}`);
        }
        setItems((prev) => prev.map((item) => (item.id === reportId ? { ...item, issue_kind: null } : item)));
        setDetailById((prev) =>
          prev[reportId] ? { ...prev, [reportId]: { ...prev[reportId]!, issue_kind: null } } : prev
        );
        setConfirmClearProblemByReport((prev) => ({ ...prev, [reportId]: false }));
      } catch (e: any) {
        setIssueHistoryErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось снять проблему." }));
      } finally {
        setIssueSavingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base]
  );

  const onSetChecked = useCallback(
    async (reportId: string, checked: boolean) => {
      setCheckSavingByReport((prev) => ({ ...prev, [reportId]: true }));
      setCheckErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}/check`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(await authHeaders()),
          },
          body: JSON.stringify({ checked }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось обновить проверку: ${resp.status} ${body}`);
        }
        const updated = (await resp.json()) as ReportSummary;
        setItems((prev) => prev.map((item) => (item.id === reportId ? { ...item, ...updated } : item)));
        setDetailById((prev) =>
          prev[reportId] ? { ...prev, [reportId]: { ...prev[reportId]!, ...updated } } : prev
        );
        setCheckMenuOpenByReport((prev) => ({ ...prev, [reportId]: false }));
      } catch (e: any) {
        setCheckErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось обновить проверку." }));
      } finally {
        setCheckSavingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base]
  );

  const onDeleteReport = useCallback(
    async (reportId: string) => {
      setDeleteSavingByReport((prev) => ({ ...prev, [reportId]: true }));
      setDeleteErrorByReport((prev) => ({ ...prev, [reportId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/report/reports/${encodeURIComponent(reportId)}`, {
          method: "DELETE",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось удалить отчёт: ${resp.status} ${body}`);
        }
        setItems((prev) => prev.filter((item) => item.id !== reportId));
        setDetailById((prev) => {
          const next = { ...prev };
          delete next[reportId];
          return next;
        });
        setOpenReportId((prev) => (prev === reportId ? null : prev));
      } catch (e: any) {
        setDeleteErrorByReport((prev) => ({ ...prev, [reportId]: e?.message || "Не удалось удалить отчёт." }));
      } finally {
        setDeleteSavingByReport((prev) => ({ ...prev, [reportId]: false }));
      }
    },
    [authHeaders, base]
  );

  const onPrintWithForm = async (report: ReportSummary, formId: string) => {
      setError("");
      setPrintDropdownReportId(null);
      const w = window.open("about:blank", "_blank");
      try {
        if (!w) throw new Error("popup blocked");
        w.document.open();
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Документ</title></head><body>Loading...</body></html>`);
        w.document.close();

        const [formResp, detailResp] = await Promise.all([
          fetchWithRetry(`${base}/documents/print/forms/${encodeURIComponent(formId)}`, {
            cache: "no-store",
            headers: await authHeaders(),
          }),
          fetchWithRetry(`${base}/orders/report/reports/${encodeURIComponent(report.id)}`, {
            cache: "no-store",
            headers: await authHeaders(),
          }),
        ]);

        if (!formResp.ok) {
          const body = await formResp.text().catch(() => "");
          throw new Error(`form load failed: ${formResp.status} ${body}`);
        }
        if (!detailResp.ok) {
          const body = await detailResp.text().catch(() => "");
          throw new Error(`report load failed: ${detailResp.status} ${body}`);
        }

        const form = await formResp.json();
        const detail = (await detailResp.json()) as ReportDetail;
        const printTitle = String(form?.title || "Документ").trim() || "Документ";
        const widthMm = pageSizeMm(form?.page_width_mm, 200);
        const heightMm = pageSizeMm(form?.page_height_mm, 300);
        const marginMm = pageSizeMm(form?.page_margin_mm, 0);
        const autoHeight = Boolean(form?.page_auto_height);
        const pageHeight = autoHeight ? "auto" : `${heightMm}mm`;
        const transformCss = printTransformCss(form);
        const lineToText = (line: ReportLine) => {
          const revenue = Number(line.revenue || 0).toLocaleString("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
          const costPrice = Number(line.cost_price || 0).toLocaleString("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
          const title = [line.service_object_name, line.work_type_name, line.service_name]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(" / ") || "-";
          return [
            line.order_number ? `#${line.order_number}` : "Без номера",
            title,
            revenue,
            `(${costPrice})`,
            `${line.profit_percent}%`,
          ]
            .filter(Boolean)
            .join(" ");
        };
        const templateHtml = String(form?.content_html || "");
        const reportCtx = buildReportPrintCtx(detail, lineToText);
        let bodyHtml = "";
        if (templateUsesOrderContext(templateHtml)) {
          const linesByOrder = (detail.lines || []).reduce<Record<string, ReportLine[]>>((acc, line) => {
            if (line.order_id) (acc[line.order_id] ||= []).push(line);
            return acc;
          }, {});
          const orders = await loadOrdersByIds(Object.keys(linesByOrder));
          if (!orders.length) throw new Error("В отчете нет заказов для печати чека.");
          const pages = await Promise.all(
            orders.map(async (order) => `<div class="print-root print-page">${renderTemplate(templateHtml, await buildOrderPrintCtx(order, linesByOrder[order.id] || [], reportCtx))}</div>`)
          );
          bodyHtml = pages.join("");
        } else {
          bodyHtml = `<div class="print-root">${renderTemplate(templateHtml, reportCtx)}</div>`;
        }
        w.document.open();
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${printTitle}</title>
          <style>
            body{font-family:Arial, sans-serif; margin:0; padding:0;}
            .print-root{width:100%; margin:0; padding:0;${transformCss}}
            .print-page{page-break-after:always;break-after:page;}
            .print-page:last-child{page-break-after:auto;break-after:auto;}
            .print-root table{width:100% !important; table-layout:fixed !important; border-collapse:collapse !important;}
            .print-root td,.print-root th{overflow:hidden; vertical-align:top; word-break:break-word;}
            .print-root p{margin:0;}
            .print-root img{
              display:block;
              max-width:100%;
              height:auto;
            }
            .print-root svg{
              display:block;
              width:100% !important;
              max-width:100% !important;
              height:auto !important;
            }
            @page { size: ${widthMm}mm ${pageHeight}; margin: ${marginMm}mm; }
            @media print {
              html, body { margin: 0 !important; padding: 0 !important; }
              .print-root { width: 100%; margin: 0 !important; padding: 0 !important; }
            }
            @media screen { html, body, .print-root { width: ${widthMm}mm; ${autoHeight ? "" : `min-height: ${heightMm}mm;`} } }
          </style>
        </head><body>${bodyHtml}</body></html>`);
        w.document.close();
        try {
          w.history.replaceState({}, "", "/print-preview");
        } catch {
          // ignore
        }
        w.focus();
        window.setTimeout(() => w.print(), 300);
      } catch (e: any) {
        setError(e?.message || "print failed");
        if (w) {
          try {
            w.document.open();
            w.document.write(
              `<!doctype html><html><head><meta charset="utf-8"/><title>Документ</title></head><body>Error: ${String(
                e?.message || "print failed"
              )}</body></html>`
            );
            w.document.close();
          } catch {
            // ignore
          }
        }
      }
  };

  const renderLinesTable = (lines: ReportLine[], dayCoverage?: { inReport: number; total: number }) => {
    const linesTotals = lines.reduce(
      (acc, line) => ({
        revenue: acc.revenue + Number(line.revenue || 0),
        costPrice: acc.costPrice + Number(line.cost_price || 0),
      }),
      { revenue: 0, costPrice: 0 }
    );

    return (
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
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                  <a
                    href={`/modules/orders/list?order_ids=${encodeURIComponent(line.order_id)}&open_order_id=${encodeURIComponent(line.order_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-500 hover:text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {line.order_number ? `#${line.order_number}` : "Без номера"}
                  </a>
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {line.service_name || "-"}
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {line.service_object_name || "-"}
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {line.work_type_name || "-"}
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {formatMoney(line.revenue)}
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {formatMoney(line.cost_price)}
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {line.comment || "-"}
                </TableCell>
                <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                  {line.profit_percent}%
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-gray-50 font-semibold dark:bg-gray-900">
              <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                Итого: {dayCoverage ? `${dayCoverage.inReport}/${dayCoverage.total}` : lines.length}
              </TableCell>
              <TableCell className="px-5 py-4" />
              <TableCell className="px-5 py-4" />
              <TableCell className="px-5 py-4" />
              <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                {formatMoney(linesTotals.revenue)}
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                {formatMoney(linesTotals.costPrice)}
              </TableCell>
              <TableCell className="px-5 py-4" />
              <TableCell className="px-5 py-4" />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
    );
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Заказы · Отчет · Список отчетов" />
      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">Список отчётов</h1>
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Фильтрация по дате, мастеру и складу.</div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {warehouseOptions.length ? (
              <select
                className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={draftFilters.warehouse_id}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, warehouse_id: event.target.value }))}
              >
                <option value="">Склад</option>
                {warehouseOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            ) : null}

            {isSuperadmin ? (
              <div className="relative">
                <input
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  value={creatorFilterQuery}
                  onFocus={() => setCreatorFilterOpen(true)}
                  onBlur={() => setTimeout(() => setCreatorFilterOpen(false), 120)}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCreatorFilterQuery(next);
                    setDraftFilters((prev) => ({ ...prev, created_by_uuid: "" }));
                  }}
                  placeholder="Мастер"
                />
                {creatorFilterOpen ? (
                  <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
                    {!creatorFilterOptions.length ? (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                    ) : (
                      creatorFilterOptions.map((item) => (
                        <button
                          key={item.user_uuid}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                          onClick={() => {
                            setDraftFilters((prev) => ({ ...prev, created_by_uuid: item.user_uuid }));
                            setCreatorFilterQuery(creatorDisplayName(item));
                            setCreatorFilterOpen(false);
                          }}
                        >
                          {creatorDisplayName(item)}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="min-w-[220px]">
              <DatePicker
                id="orders-report-list-date"
                mode="single"
                placeholder="Дата отчёта"
                onChange={(dates) => {
                  const selected = dates?.[0];
                  if (!selected) {
                    setDraftFilters((prev) => ({ ...prev, report_date: "" }));
                    return;
                  }
                  const yyyy = selected.getFullYear();
                  const mm = String(selected.getMonth() + 1).padStart(2, "0");
                  const dd = String(selected.getDate()).padStart(2, "0");
                  setDraftFilters((prev) => ({ ...prev, report_date: `${yyyy}-${mm}-${dd}` }));
                }}
              />
            </div>

            <Button size="sm" onClick={() => void onApplyFilters()} disabled={loading}>
              Отфильтровать
            </Button>
          </div>
        </div>

        {error ? <div className="text-sm text-red-600">Ошибка: {error}</div> : null}

        {!items.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">{loading ? "Загрузка..." : "Отчётов пока нет."}</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Номер отчёта
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Склад
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Дата отчёта
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Мастер
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Из размена на ЗП
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Создан
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {items.map((item, index) => {
                    const isOpen = openReportId === item.id;
                    const detail = detailById[item.id];
                    const dayLines = (detail?.lines || []).filter((line) => !line.is_old_order);
                    const oldLines = (detail?.lines || []).filter((line) => !!line.is_old_order);
                    const feedItems = buildFeedItems(item.id, detail);
                    const issueKind = item.issue_kind || null;
                    const hasProblemMark = issueKind === "problem";
                    const isCheckedByAdmin = !!item.checked_at;
                    const confirmClearProblem = !!confirmClearProblemByReport[item.id];
                    const canClearProblem = isAdmin;
                    const reportToneClass =
                      index % 2 === 0 ? "bg-white dark:bg-white/[0.03]" : "bg-gray-50 dark:bg-white/[0.06]";
                    return (
                      <React.Fragment key={item.id}>
                        <tr
                          className={`cursor-pointer ${
                            hasProblemMark
                              ? "bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/15"
                              : `${reportToneClass} hover:bg-gray-100 dark:hover:bg-white/[0.10]`
                          }`}
                          onClick={() => onToggleOpen(item.id)}
                        >
                          <td className="px-5 py-4 text-start text-theme-sm font-medium text-gray-800 dark:text-white/90">
                            <div className="inline-flex items-center gap-2">
                              <span>#{item.report_number}</span>
                              {isCheckedByAdmin ? (
                                <span
                                  title="Проверено админом"
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                >
                                  ✓
                                </span>
                              ) : null}
                              {hasProblemMark ? (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                  Проблема
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {item.warehouse_name || "-"}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {item.report_date || "-"}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {item.created_by_name || item.created_by_uuid || "-"}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {formatMoney(item.salary_cash_from_change)}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {new Date(item.created_at).toLocaleString("ru-RU")}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className={hasProblemMark ? "bg-red-50 dark:bg-red-500/10" : reportToneClass}>
                            <td colSpan={6} className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">
                              {detailLoadingById[item.id] ? (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка деталей...</div>
                              ) : detailErrorById[item.id] ? (
                                <div className="text-sm text-red-600">Ошибка: {detailErrorById[item.id]}</div>
                              ) : detail ? (
                                <div className="space-y-6">
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Выручка</div>
                                      <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">
                                        {formatMoney(detail.total_revenue)}
                                      </div>
                                    </div>
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">ЗП мастера</div>
                                      <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">
                                        {formatMoney(detail.total_master_salary)}
                                      </div>
                                    </div>
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Остаток в кассе</div>
                                      <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">
                                        {formatMoney(detail.total_cash_remainder)}
                                      </div>
                                    </div>
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
                                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        Из размена на ЗП
                                      </div>
                                      <div className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">
                                        {formatMoney(detail.salary_cash_from_change)}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Печать</div>
                                    <div className="relative inline-block">
                                      <button
                                        className="dropdown-toggle inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                        onClick={() => setPrintDropdownReportId((prev) => (prev === item.id ? null : item.id))}
                                      >
                                        Выбрать форму
                                        <ChevronDownIcon className="w-4 h-4" />
                                      </button>
                                      <Dropdown
                                        isOpen={printDropdownReportId === item.id}
                                        onClose={() => setPrintDropdownReportId(null)}
                                        className="left-0 right-auto w-72 p-2"
                                      >
                                        {printFormsLoading ? (
                                          <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
                                        ) : printFormsError ? (
                                          <div className="px-4 py-2 text-sm text-red-600">Ошибка: {printFormsError}</div>
                                        ) : !printForms.length ? (
                                          <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">Форм нет.</div>
                                        ) : (
                                          <div className="max-h-96 overflow-auto">
                                            {Object.entries(
                                              printForms.reduce<Record<string, PrintFormListItem[]>>((acc, f) => {
                                                const k = String(f.category_name || "").trim() || "Без категории";
                                                (acc[k] ||= []).push(f);
                                                return acc;
                                              }, {})
                                            )
                                              .sort(([a], [b]) => a.localeCompare(b))
                                              .map(([catName, forms]) => (
                                                <div key={catName} className="mb-2">
                                                  <div className="px-4 py-1 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                    {catName}
                                                  </div>
                                                  {forms.map((f) => (
                                                    <DropdownItem
                                                      key={f.id}
                                                      onClick={() => void onPrintWithForm(item, f.id)}
                                                      className="flex w-full rounded-lg text-left font-normal text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-100"
                                                      onItemClick={() => setPrintDropdownReportId(null)}
                                                    >
                                                      {f.title}
                                                    </DropdownItem>
                                                  ))}
                                                </div>
                                              ))}
                                          </div>
                                        )}
                                      </Dropdown>
                                    </div>
                                  </div>

                                  <div className="space-y-3">
                                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Заказы за день</div>
                                    {!dayLines.length ? (
                                      <div className="text-sm text-gray-500 dark:text-gray-400">Нет строк.</div>
                                    ) : (
                                      renderLinesTable(dayLines, {
                                        inReport: detail.day_report_orders_count,
                                        total: detail.day_orders_total_count,
                                      })
                                    )}
                                  </div>

                                  {oldLines.length ? (
                                    <div className="space-y-3">
                                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                        Старые заказы, по которым оплата была внесена в день отчёта.
                                      </div>
                                      {renderLinesTable(oldLines)}
                                    </div>
                                  ) : null}

                                  <div className="flex justify-end">
                                    <div className="w-full max-w-xl space-y-3">
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => onStartComment(item.id)}
                                          className={`rounded-lg border px-3 py-1.5 text-sm ${
                                            commentDraftOpenByReport[item.id]
                                              ? "border-gray-400 bg-gray-100 text-gray-800 dark:border-gray-500/40 dark:bg-white/10 dark:text-gray-100"
                                              : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                          }`}
                                        >
                                          Комментарий
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (issueKind === "problem" && canClearProblem) {
                                              setConfirmClearProblemByReport((prev) => ({ ...prev, [item.id]: true }));
                                              setIssueDraftOpenByReport((prev) => ({ ...prev, [item.id]: false }));
                                              return;
                                            }
                                            setConfirmClearProblemByReport((prev) => ({ ...prev, [item.id]: false }));
                                            onStartIssue(item.id);
                                          }}
                                          className={`rounded-lg border px-3 py-1.5 text-sm ${
                                            issueDraftOpenByReport[item.id] || issueKind === "problem"
                                              ? "border-red-300 bg-red-100 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                              : "border-gray-300 text-gray-700 hover:bg-red-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-red-500/10"
                                          }`}
                                        >
                                          Проблема
                                        </button>
                                        {isAdmin ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setCheckMenuOpenByReport((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                            }
                                            className={`rounded-lg border px-3 py-1.5 text-sm ${
                                              isCheckedByAdmin
                                                ? "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
                                                : "border-gray-300 text-gray-700 hover:bg-emerald-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-emerald-500/10"
                                            }`}
                                          >
                                            Проверить
                                          </button>
                                        ) : null}
                                        {isAdmin ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setConfirmDeleteByReport((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                            }
                                            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                                          >
                                            Удалить
                                          </button>
                                        ) : null}
                                      </div>

                                      {isAdmin && confirmDeleteByReport[item.id] ? (
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            disabled={!!deleteSavingByReport[item.id]}
                                            onClick={() => void onDeleteReport(item.id)}
                                            className="rounded-lg border border-red-300 bg-red-100 px-3 py-1.5 text-sm text-red-700 disabled:opacity-60 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                          >
                                            Да, удалить
                                          </button>
                                          <button
                                            type="button"
                                            disabled={!!deleteSavingByReport[item.id]}
                                            onClick={() => setConfirmDeleteByReport((prev) => ({ ...prev, [item.id]: false }))}
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                          >
                                            Нет
                                          </button>
                                        </div>
                                      ) : null}

                                      {deleteErrorByReport[item.id] ? (
                                        <div className="text-right text-sm text-red-600">Ошибка: {deleteErrorByReport[item.id]}</div>
                                      ) : null}

                                      {isAdmin && checkMenuOpenByReport[item.id] ? (
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            disabled={!!checkSavingByReport[item.id]}
                                            onClick={() => void onSetChecked(item.id, true)}
                                            className="rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-60 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
                                          >
                                            Проверено
                                          </button>
                                          <button
                                            type="button"
                                            disabled={!!checkSavingByReport[item.id]}
                                            onClick={() => void onSetChecked(item.id, false)}
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                          >
                                            Нет
                                          </button>
                                        </div>
                                      ) : null}

                                      {checkErrorByReport[item.id] ? (
                                        <div className="text-right text-sm text-red-600">Ошибка: {checkErrorByReport[item.id]}</div>
                                      ) : null}

                                      {issueKind === "problem" && canClearProblem && confirmClearProblem ? (
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => void onClearProblem(item.id)}
                                            className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                                          >
                                            Снять проблему
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setConfirmClearProblemByReport((prev) => ({ ...prev, [item.id]: false }))}
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                          >
                                            Нет
                                          </button>
                                        </div>
                                      ) : null}

                                      {issueDraftOpenByReport[item.id] ? (
                                        <div className="flex justify-end">
                                          <div className="w-[280px] rounded-lg border border-red-200 bg-white/80 p-3 dark:border-red-500/20 dark:bg-white/[0.03]">
                                            <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Описание проблемы</div>
                                            <textarea
                                              value={issueDraftTextByReport[item.id] || ""}
                                              onChange={(event) =>
                                                setIssueDraftTextByReport((prev) => ({ ...prev, [item.id]: event.target.value }))
                                              }
                                              placeholder="Опишите проблему"
                                              rows={3}
                                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                            />
                                            <div className="mt-2 space-y-2">
                                              {issueHistoryErrorByReport[item.id] ? (
                                                <div className="text-sm text-red-600">Ошибка: {issueHistoryErrorByReport[item.id]}</div>
                                              ) : null}
                                              <div className="flex justify-end gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => onCancelIssue(item.id)}
                                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                                >
                                                  Отмена
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => void onSaveIssue(item.id)}
                                                  disabled={!!issueSavingByReport[item.id]}
                                                  className="rounded-lg border border-red-300 bg-red-100 px-3 py-1.5 text-sm text-red-700 disabled:opacity-60 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                                >
                                                  Сохранить
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}

                                      {commentDraftOpenByReport[item.id] ? (
                                        <div className="flex justify-end">
                                          <div className="w-[280px] rounded-lg border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-white/[0.03]">
                                            <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Комментарий</div>
                                            <textarea
                                              value={commentDraftTextByReport[item.id] || ""}
                                              onChange={(event) =>
                                                setCommentDraftTextByReport((prev) => ({ ...prev, [item.id]: event.target.value }))
                                              }
                                              placeholder="Введите комментарий"
                                              rows={3}
                                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                            />
                                            <div className="mt-2 space-y-2">
                                              {commentHistoryErrorByReport[item.id] ? (
                                                <div className="text-sm text-red-600">Ошибка: {commentHistoryErrorByReport[item.id]}</div>
                                              ) : null}
                                              <div className="flex justify-end gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => onCancelComment(item.id)}
                                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                                >
                                                  Отмена
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => void onSaveComment(item.id)}
                                                  disabled={!!commentSavingByReport[item.id]}
                                                  className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-60 dark:border-gray-700 dark:bg-white/10 dark:text-gray-100"
                                                >
                                                  Сохранить
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}

                                      {(issueHistoryLoadingByReport[item.id] ||
                                        commentHistoryLoadingByReport[item.id] ||
                                        (issueHistoryErrorByReport[item.id] && !issueDraftOpenByReport[item.id]) ||
                                        (commentHistoryErrorByReport[item.id] && !commentDraftOpenByReport[item.id]) ||
                                        feedItems.length > 0) ? (
                                        <div className="space-y-2">
                                          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Лента</div>
                                          {issueHistoryLoadingByReport[item.id] || commentHistoryLoadingByReport[item.id] ? (
                                            <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
                                          ) : issueHistoryErrorByReport[item.id] && !issueDraftOpenByReport[item.id] ? (
                                            <div className="text-sm text-red-600">Ошибка: {issueHistoryErrorByReport[item.id]}</div>
                                          ) : commentHistoryErrorByReport[item.id] && !commentDraftOpenByReport[item.id] ? (
                                            <div className="text-sm text-red-600">Ошибка: {commentHistoryErrorByReport[item.id]}</div>
                                          ) : (
                                            <div className="space-y-2">
                                              {feedItems.map((entry) => (
                                                <div
                                                  key={entry.id}
                                                  className="rounded-lg border border-red-100 bg-white/80 px-3 py-2 dark:border-red-500/20 dark:bg-white/[0.03]"
                                                >
                                                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                    {entry.kind === "issue" ? (
                                                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                                        {entry.title}
                                                      </span>
                                                    ) : entry.kind === "missing_orders" ? (
                                                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                                        Комментарий
                                                      </span>
                                                    ) : (
                                                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-white/10 dark:text-gray-300">
                                                        Комментарий
                                                      </span>
                                                    )}
                                                    <span>{new Date(entry.created_at).toLocaleString("ru-RU")}</span>
                                                    {entry.created_by_name ? <span>{entry.created_by_name}</span> : null}
                                                  </div>
                                                  {entry.kind === "missing_orders" ? (
                                                    <div className="mt-1 text-sm text-gray-800 dark:text-white/90">
                                                      {entry.title}:{" "}
                                                      {entry.orders.map((order, orderIndex) => (
                                                        <React.Fragment key={order.order_id}>
                                                          {orderIndex ? ", " : ""}
                                                          <a
                                                            href={`/modules/orders/list?order_ids=${encodeURIComponent(order.order_id)}&open_order_id=${encodeURIComponent(order.order_id)}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-brand-500 hover:text-brand-600 hover:underline dark:text-brand-400"
                                                          >
                                                            {order.order_number ? `#${order.order_number}` : "Без номера"}
                                                          </a>
                                                        </React.Fragment>
                                                      ))}
                                                    </div>
                                                  ) : (
                                                    <div className="mt-1 text-sm text-gray-800 dark:text-white/90">
                                                      {entry.kind === "issue" ? entry.description : entry.title}
                                                    </div>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Нет данных.</div>
                              )}
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

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Страница {page} из {totalPages}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load(Math.max(1, page - 1))} disabled={loading || page <= 1}>
              Назад
            </Button>
            <Button size="sm" variant="outline" onClick={() => void load(Math.min(totalPages, page + 1))} disabled={loading || page >= totalPages}>
              Дальше
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
