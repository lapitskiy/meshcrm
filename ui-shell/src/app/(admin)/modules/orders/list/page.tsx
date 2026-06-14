"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import { connectQzTray, qzPrintRaw, qzPrintRawHex } from "@/lib/qzTray";
import {
  QZ_DEFAULT_PRINTER_NAME,
  ensureTsplPrintFooter,
  findUnknownPlaceholderKeys,
  htmlTo30x20TsplHex,
  htmlToPlainLinesForTspl,
  looksLikeTspl,
  normPrintPlaceholderKey,
  normalizeTsplPayload,
  tsplEscapeText,
} from "@/lib/printQzTspl";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/button/Button";
import DatePicker from "@/components/form/date-picker";
import Radio from "@/components/form/input/Radio";
import { ChevronDownIcon } from "@/icons/index";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { Modal } from "@/components/ui/modal";
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
  status: string;
  status_selected_manually?: boolean;
  display_status?: string | null;
  issue_kind?: OrderIssueKind | null;
  order_kind: string;
  service_category_id: string | null;
  service_object_id: string | null;
  serial_model: string;
  work_type_ids: string[];
  warehouse_id: string | null;
  contact_uuid: string | null;
  related_modules?: Record<string, Record<string, string>>;
  created_at: string;
  active_callback_date?: string | null;
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
  prepayment?: number | null;
  cost_price?: number | null;
  currency: string;
  payment_method: "card" | "cash" | null;
  is_paid: boolean;
};

type StatusOption = {
  id: string;
  name: string;
  color: string;
};

type StatusHistoryItem = {
  status: string;
  changed_at: string;
};

type ContactInfo = {
  id: string;
  name: string;
  phone: string;
};

type CreatorInfo = {
  user_uuid?: string | null;
  username?: string;
  email?: string;
  full_name?: string;
};

type UserLite = {
  user_uuid: string;
  username: string;
  email: string;
  full_name: string;
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
  qz_enabled: boolean;
  updated_at: string;
};

type WarehouseInfo = {
  name: string;
  address: string;
  point_phone: string;
  qr_site_svg: string;
  qr_yandex_svg: string;
  qr_vk_svg: string;
  qr_telegram_svg: string;
};

type WarehouseOption = {
  id: string;
  name: string;
};

type ServiceObjectOption = {
  id: string;
  name: string;
  service_category_id: string;
};

type ListFilters = {
  order_ids: string;
  order_kind: string;
  service_category_id: string;
  service_object_id: string;
  work_type_id: string;
  warehouse_id: string;
  created_by_uuid: string;
  search: string;
  created_from: string;
  created_to: string;
};

type OrderIssueKind = "return" | "problem" | "issued";
type OrderReturnType = "repair" | "money";
type OrderReturnMoneySource = "today_cash" | "order_day_cash";

type OrderIssueHistoryItem = {
  id: string;
  issue_kind: OrderIssueKind;
  reason: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type OrderCommentHistoryItem = {
  id: string;
  comment: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type OrderCallbackCompleteResponse = {
  order: OrderItem;
  comment_entry: OrderCommentHistoryItem;
};

type OrderPhotoHistoryItem = {
  id: string;
  mime_type: string;
  data_url: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type OrderFeedItem =
  | {
      kind: "status";
      id: string;
      title: string;
      created_at: string;
    }
  | {
      kind: "issue";
      id: string;
      issue_kind: OrderIssueKind;
      title: string;
      reason: string;
      created_at: string;
      created_by_name?: string;
    }
  | {
      kind: "comment";
      id: string;
      title: string;
      created_at: string;
      created_by_name?: string;
    }
  | {
      kind: "photo";
      id: string;
      title: string;
      image_url: string;
      created_at: string;
      created_by_name?: string;
    };

function EditButtonIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 12.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 10.5l6.5-6.5 1.5 1.5-6.5 6.5H4v-1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
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

function normalizeHexColor(value: string | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "#22c55e";
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#22c55e";
}

function textColorForBg(hexColor: string): string {
  const hex = normalizeHexColor(hexColor).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}

function orderKindLabel(kind: string): string {
  if (kind === "onsite") return "Услуга на месте";
  if (kind === "repair") return "Оставили в ремонт";
  return "Не указан";
}

function formatOrderDateAndTime(value: string): { date: string; time: string } {
  const d = new Date(value);
  const date = d.toLocaleDateString("ru-RU");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date, time: `${hh}:${mm}` };
}

function creatorDisplayName(creator: CreatorInfo | null | undefined): string {
  if (!creator) return "-";
  const fullName = String(creator.full_name || "").trim();
  if (fullName) return fullName;
  const username = String(creator.username || "").trim();
  if (username) return username;
  const email = String(creator.email || "").trim();
  if (email) return email;
  return "-";
}

function toYmdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getReturnRefundDate(createdAt: string, source: OrderReturnMoneySource | undefined): string {
  if (!source) return "";
  if (source === "today_cash") return toYmdLocal(new Date());
  return toYmdLocal(new Date(createdAt));
}

export default function OrdersListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const cameraVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const cameraToastTimerRef = React.useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const searchParams = useSearchParams();
  const initialSearch = String(searchParams.get("search") || "").trim();
  const initialOpenOrderId = String(searchParams.get("open_order_id") || "").trim();
  const initialOrderIds = String(searchParams.get("order_ids") || "").trim();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [financeByOrder, setFinanceByOrder] = useState<Record<string, FinanceLine[]>>({});
  const [financeLoadingByOrder, setFinanceLoadingByOrder] = useState<Record<string, boolean>>({});
  const [financeErrorByOrder, setFinanceErrorByOrder] = useState<Record<string, string>>({});
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseNameById, setWarehouseNameById] = useState<Record<string, string>>({});
  const [warehouseById, setWarehouseById] = useState<Record<string, WarehouseInfo>>({});
  const [categoryNameById, setCategoryNameById] = useState<Record<string, string>>({});
  const [serviceObjectOptions, setServiceObjectOptions] = useState<ServiceObjectOption[]>([]);
  const [serviceObjectNameById, setServiceObjectNameById] = useState<Record<string, string>>({});
  const [workTypeNameById, setWorkTypeNameById] = useState<Record<string, string>>({});
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [statusSavingByOrder, setStatusSavingByOrder] = useState<Record<string, boolean>>({});
  const [serviceObjectEditOpenByOrder, setServiceObjectEditOpenByOrder] = useState<Record<string, boolean>>({});
  const [serviceObjectQueryByOrder, setServiceObjectQueryByOrder] = useState<Record<string, string>>({});
  const [serviceObjectSavingByOrder, setServiceObjectSavingByOrder] = useState<Record<string, boolean>>({});
  const [warehouseEditOpenByOrder, setWarehouseEditOpenByOrder] = useState<Record<string, boolean>>({});
  const [warehouseDraftByOrder, setWarehouseDraftByOrder] = useState<Record<string, string>>({});
  const [warehouseSavingByOrder, setWarehouseSavingByOrder] = useState<Record<string, boolean>>({});
  const [statusHistoryByOrder, setStatusHistoryByOrder] = useState<Record<string, StatusHistoryItem[]>>({});
  const [statusHistoryLoadingByOrder, setStatusHistoryLoadingByOrder] = useState<Record<string, boolean>>({});
  const [statusHistoryErrorByOrder, setStatusHistoryErrorByOrder] = useState<Record<string, string>>({});
  const [contactByOrder, setContactByOrder] = useState<Record<string, ContactInfo | null>>({});
  const [contactLoadingByOrder, setContactLoadingByOrder] = useState<Record<string, boolean>>({});
  const [contactErrorByOrder, setContactErrorByOrder] = useState<Record<string, string>>({});
  const [creatorByOrder, setCreatorByOrder] = useState<Record<string, CreatorInfo | null>>({});
  const [creatorLoadingByOrder, setCreatorLoadingByOrder] = useState<Record<string, boolean>>({});
  const [creatorErrorByOrder, setCreatorErrorByOrder] = useState<Record<string, string>>({});
  const [printForms, setPrintForms] = useState<PrintFormListItem[]>([]);
  const [printFormsError, setPrintFormsError] = useState<string>("");
  const [printFormsLoading, setPrintFormsLoading] = useState(false);
  const [printDropdownOrderId, setPrintDropdownOrderId] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [creatorFilterQuery, setCreatorFilterQuery] = useState("");
  const [creatorFilterOptions, setCreatorFilterOptions] = useState<UserLite[]>([]);
  const [creatorFilterOpen, setCreatorFilterOpen] = useState(false);
  const [issueHistoryByOrder, setIssueHistoryByOrder] = useState<Record<string, OrderIssueHistoryItem[]>>({});
  const [issueHistoryLoadingByOrder, setIssueHistoryLoadingByOrder] = useState<Record<string, boolean>>({});
  const [issueHistoryErrorByOrder, setIssueHistoryErrorByOrder] = useState<Record<string, string>>({});
  const [issueDraftKindByOrder, setIssueDraftKindByOrder] = useState<Record<string, OrderIssueKind | undefined>>({});
  const [issueDraftReasonByOrder, setIssueDraftReasonByOrder] = useState<Record<string, string>>({});
  const [issueReturnTypeByOrder, setIssueReturnTypeByOrder] = useState<Record<string, OrderReturnType | undefined>>({});
  const [issueReturnMoneySourceByOrder, setIssueReturnMoneySourceByOrder] = useState<
    Record<string, OrderReturnMoneySource | undefined>
  >({});
  const [issueReturnAmountByOrder, setIssueReturnAmountByOrder] = useState<Record<string, string>>({});
  const [issueSavingByOrder, setIssueSavingByOrder] = useState<Record<string, boolean>>({});
  const [commentHistoryByOrder, setCommentHistoryByOrder] = useState<Record<string, OrderCommentHistoryItem[]>>({});
  const [commentHistoryLoadingByOrder, setCommentHistoryLoadingByOrder] = useState<Record<string, boolean>>({});
  const [commentHistoryErrorByOrder, setCommentHistoryErrorByOrder] = useState<Record<string, string>>({});
  const [commentDraftOpenByOrder, setCommentDraftOpenByOrder] = useState<Record<string, boolean>>({});
  const [commentDraftTextByOrder, setCommentDraftTextByOrder] = useState<Record<string, string>>({});
  const [commentSavingByOrder, setCommentSavingByOrder] = useState<Record<string, boolean>>({});
  const [callbackDraftOpenByOrder, setCallbackDraftOpenByOrder] = useState<Record<string, boolean>>({});
  const [callbackDateByOrder, setCallbackDateByOrder] = useState<Record<string, string>>({});
  const [callbackCommentByOrder, setCallbackCommentByOrder] = useState<Record<string, string>>({});
  const [callbackNeedDateByOrder, setCallbackNeedDateByOrder] = useState<Record<string, boolean>>({});
  const [callbackSavingByOrder, setCallbackSavingByOrder] = useState<Record<string, boolean>>({});
  const [activeCallbackOrderId, setActiveCallbackOrderId] = useState<string | null>(null);
  const [photoHistoryByOrder, setPhotoHistoryByOrder] = useState<Record<string, OrderPhotoHistoryItem[]>>({});
  const [photoHistoryLoadingByOrder, setPhotoHistoryLoadingByOrder] = useState<Record<string, boolean>>({});
  const [photoHistoryErrorByOrder, setPhotoHistoryErrorByOrder] = useState<Record<string, string>>({});
  const [photoSavingByOrder, setPhotoSavingByOrder] = useState<Record<string, boolean>>({});
  const [confirmIssuedByOrder, setConfirmIssuedByOrder] = useState<Record<string, boolean>>({});
  const [confirmClearProblemByOrder, setConfirmClearProblemByOrder] = useState<Record<string, boolean>>({});
  const [cameraOrderId, setCameraOrderId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraToast, setCameraToast] = useState("");
  const [capturedPhotoDataUrl, setCapturedPhotoDataUrl] = useState("");
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<ListFilters>({
    order_ids: initialOrderIds,
    order_kind: "",
    service_category_id: "",
    service_object_id: "",
    work_type_id: "",
    warehouse_id: "",
    created_by_uuid: "",
    search: initialSearch,
    created_from: "",
    created_to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<ListFilters>({
    order_ids: initialOrderIds,
    order_kind: "",
    service_category_id: "",
    service_object_id: "",
    work_type_id: "",
    warehouse_id: "",
    created_by_uuid: "",
    search: initialSearch,
    created_from: "",
    created_to: "",
  });
  const [pendingOpenOrderId, setPendingOpenOrderId] = useState(initialOpenOrderId);
  const [serviceObjectFilterQuery, setServiceObjectFilterQuery] = useState("");
  const [serviceObjectFilterOpen, setServiceObjectFilterOpen] = useState(false);
  const [workTypeFilterQuery, setWorkTypeFilterQuery] = useState("");
  const [workTypeFilterOpen, setWorkTypeFilterOpen] = useState(false);

  const statusColorByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of statusOptions) {
      map[s.name] = normalizeHexColor(s.color);
    }
    return map;
  }, [statusOptions]);

  const workTypeFilterOptions = useMemo(() => {
    const term = workTypeFilterQuery.trim().toLowerCase();
    const all = Object.entries(workTypeNameById).map(([id, name]) => ({ id, name }));
    if (!term) return all.slice(0, 50);
    return all.filter((x) => x.name.toLowerCase().includes(term)).slice(0, 50);
  }, [workTypeNameById, workTypeFilterQuery]);

  const serviceObjectFilterOptions = useMemo(() => {
    const term = serviceObjectFilterQuery.trim().toLowerCase();
    return serviceObjectOptions
      .filter((item) => !draftFilters.service_category_id || item.service_category_id === draftFilters.service_category_id)
      .filter((item) => !term || item.name.toLowerCase().includes(term))
      .slice(0, 50);
  }, [serviceObjectOptions, serviceObjectFilterQuery, draftFilters.service_category_id]);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

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

  const load = async (targetPage: number, filtersArg?: ListFilters, pageSizeArg?: number) => {
    setLoading(true);
    setError(null);
    try {
      const f = filtersArg || appliedFilters;
      const effectivePageSize = pageSizeArg || pageSize;
      const qs = new URLSearchParams();
      qs.set("page", String(targetPage));
      qs.set("page_size", String(effectivePageSize));
      if (f.order_ids.trim()) qs.set("order_ids", f.order_ids.trim());
      if (f.order_kind) qs.set("order_kind", f.order_kind);
      if (f.service_category_id) qs.set("service_category_id", f.service_category_id);
      if (f.service_object_id) qs.set("service_object_id", f.service_object_id);
      if (f.work_type_id) qs.set("work_type_id", f.work_type_id);
      if (f.warehouse_id) qs.set("warehouse_id", f.warehouse_id);
      if (f.created_by_uuid) qs.set("created_by_uuid", f.created_by_uuid);
      if (f.search.trim()) qs.set("search", f.search.trim());
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
      setItems(data.items || []);
      setPage(data.page || targetPage);
      if (Number.isFinite(Number(data.page_size)) && Number(data.page_size) > 0) {
        setPageSize(Number(data.page_size));
      }
      setTotalPages(data.total_pages || 1);
      if (pendingOpenOrderId && (data.items || []).some((x) => x.id === pendingOpenOrderId)) {
        setOpenOrderId(pendingOpenOrderId);
        void loadFinanceLines(pendingOpenOrderId);
        void loadStatusHistory(pendingOpenOrderId);
        void loadIssueHistory(pendingOpenOrderId);
        void loadPhotoHistory(pendingOpenOrderId);
        const autoOrder = (data.items || []).find((x) => x.id === pendingOpenOrderId);
        if (autoOrder?.contact_uuid) {
          void loadContactInfo(pendingOpenOrderId, autoOrder.contact_uuid);
        }
        void loadCreatorInfo(pendingOpenOrderId);
        setPendingOpenOrderId("");
      } else {
        setOpenOrderId(null);
      }
    } catch (e: any) {
      setError(e?.message || "failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const payload = parseJwtPayload(getToken());
    const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
    setIsSuperadmin(roles.includes("superadmin"));
    setIsAdmin(roles.includes("admin") || roles.includes("superadmin"));
  }, []);

  useEffect(() => {
    (async () => {
      await load(1, appliedFilters);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          const resp = await fetch(
            `${base}/orders/orders/creators/options?q=${encodeURIComponent(term)}`,
            { cache: "no-store", headers: authHeaders() }
          );
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`creator options failed: ${resp.status} ${body}`);
          }
          setCreatorFilterOptions((await resp.json()) as UserLite[]);
          setCreatorFilterOpen(true);
        } catch (e: any) {
          setError(e?.message || "failed to load creator options");
          setCreatorFilterOptions([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [creatorFilterQuery, creatorFilterOpen, isSuperadmin, base]);

  useEffect(() => {
    (async () => {
      setPrintFormsLoading(true);
      setPrintFormsError("");
      try {
        const resp = await fetch(`${base}/documents/print/forms?limit=500`, { cache: "no-store", headers: authHeaders() });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`print forms failed: ${resp.status} ${body}`);
        }
        setPrintForms((await resp.json()) as PrintFormListItem[]);
      } catch (e: any) {
        setPrintFormsError(e?.message || "failed to load print forms");
      } finally {
        setPrintFormsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/orders/settings/statuses`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        setStatusOptions((await resp.json()) as StatusOption[]);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChangeStatus = async (orderId: string, nextStatus: string) => {
    setStatusSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`status update failed: ${resp.status} ${body}`);
      }
      const updatedOrder = (await resp.json()) as OrderItem;
      setItems((prev) =>
        prev.map((it) =>
          it.id === orderId
            ? {
                ...it,
                ...updatedOrder,
                issue_kind: it.issue_kind ?? updatedOrder.issue_kind,
              }
            : it
        )
      );
      if (nextStatus) {
        setStatusHistoryByOrder((prev) => {
          const existing = prev[orderId] || [];
          return {
            ...prev,
            [orderId]: [{ status: nextStatus, changed_at: new Date().toISOString() }, ...existing],
          };
        });
      }
    } catch (e: any) {
      setError(e?.message || "failed to update status");
    } finally {
      setStatusSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const openWarehouseEditor = (order: OrderItem) => {
    setWarehouseDraftByOrder((prev) => ({ ...prev, [order.id]: order.warehouse_id || "" }));
    setWarehouseEditOpenByOrder((prev) => ({ ...prev, [order.id]: true }));
  };

  const serviceObjectOptionsForOrder = (order: OrderItem, query: string) => {
    const term = query.trim().toLowerCase();
    return serviceObjectOptions
      .filter((item) => item.service_category_id === String(order.service_category_id || ""))
      .filter((item) => !term || item.name.toLowerCase().includes(term))
      .slice(0, 5);
  };

  const openServiceObjectEditor = (order: OrderItem) => {
    const currentName = serviceObjectNameById[order.service_object_id || ""] || "";
    setServiceObjectQueryByOrder((prev) => ({ ...prev, [order.id]: currentName }));
    setServiceObjectEditOpenByOrder((prev) => ({ ...prev, [order.id]: true }));
  };

  const onChangeServiceObject = async (orderId: string, serviceObjectId: string) => {
    const nextServiceObjectId = String(serviceObjectId || "").trim();
    if (!nextServiceObjectId) return;
    setServiceObjectSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/service-object`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ service_object_id: nextServiceObjectId }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`service object update failed: ${resp.status} ${body}`);
      }
      const updatedOrder = (await resp.json()) as OrderItem;
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, ...updatedOrder } : it)));
      setServiceObjectQueryByOrder((prev) => ({
        ...prev,
        [orderId]: serviceObjectNameById[nextServiceObjectId] || "",
      }));
      setServiceObjectEditOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
    } catch (e: any) {
      setError(e?.message || "failed to update service object");
    } finally {
      setServiceObjectSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onChangeWarehouse = async (orderId: string, warehouseId: string) => {
    const nextWarehouseId = String(warehouseId || "").trim();
    if (!nextWarehouseId) return;
    setWarehouseDraftByOrder((prev) => ({ ...prev, [orderId]: nextWarehouseId }));
    setWarehouseSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/warehouse`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ warehouse_id: nextWarehouseId }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`warehouse update failed: ${resp.status} ${body}`);
      }
      const updatedOrder = (await resp.json()) as OrderItem;
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, ...updatedOrder } : it)));
      setWarehouseEditOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
    } catch (e: any) {
      setError(e?.message || "failed to update warehouse");
    } finally {
      setWarehouseSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const loadStatusHistory = async (orderId: string) => {
    if (statusHistoryByOrder[orderId]) return;
    setStatusHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setStatusHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/status-history?limit=30`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`status history failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as StatusHistoryItem[];
      setStatusHistoryByOrder((prev) => ({ ...prev, [orderId]: history }));
    } catch (e: any) {
      setStatusHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load status history" }));
    } finally {
      setStatusHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const loadIssueHistory = async (orderId: string) => {
    if (issueHistoryByOrder[orderId]) return;
    setIssueHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/issues?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order issues failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as OrderIssueHistoryItem[];
      setIssueHistoryByOrder((prev) => ({ ...prev, [orderId]: history }));
    } catch (e: any) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load issues" }));
    } finally {
      setIssueHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const loadCommentHistory = async (orderId: string) => {
    if (commentHistoryByOrder[orderId]) return;
    setCommentHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setCommentHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/comments?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order comments failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as OrderCommentHistoryItem[];
      setCommentHistoryByOrder((prev) => ({ ...prev, [orderId]: history }));
    } catch (e: any) {
      setCommentHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load comments" }));
    } finally {
      setCommentHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const loadPhotoHistory = async (orderId: string) => {
    if (photoHistoryByOrder[orderId]) return;
    setPhotoHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setPhotoHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/photos?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order photos failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as OrderPhotoHistoryItem[];
      setPhotoHistoryByOrder((prev) => ({ ...prev, [orderId]: history }));
    } catch (e: any) {
      setPhotoHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load photos" }));
    } finally {
      setPhotoHistoryLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const stopCameraStream = () => {
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  const closeCameraModal = () => {
    stopCameraStream();
    setCameraOrderId(null);
    setCameraError("");
    setCapturedPhotoDataUrl("");
  };

  const showCameraToast = (message: string) => {
    setCameraToast(message);
    if (cameraToastTimerRef.current) {
      window.clearTimeout(cameraToastTimerRef.current);
    }
    cameraToastTimerRef.current = window.setTimeout(() => {
      setCameraToast("");
      cameraToastTimerRef.current = null;
    }, 4000);
  };

  const onOpenCamera = async (orderId: string) => {
    setPhotoHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    setCameraError("");
    setCapturedPhotoDataUrl("");
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Браузер не поддерживает доступ к камере.";
      setCameraError(message);
      showCameraToast(message);
      return;
    }
    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOrderId(orderId);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        void cameraVideoRef.current.play().catch(() => {
          setCameraError("Не удалось запустить камеру.");
        });
      }
    } catch (e: any) {
      const message = e?.message ? `Не удалось открыть камеру: ${e.message}` : "Не удалось открыть камеру.";
      setCameraError(message);
      showCameraToast(message);
    }
  };

  const onCapturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) {
      setCameraError("Камера не готова.");
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError("Подождите, пока камера начнет передавать изображение.");
      return;
    }
    const maxWidth = 1600;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Не удалось подготовить снимок.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    setCapturedPhotoDataUrl(canvas.toDataURL("image/jpeg", 0.9));
    setCameraError("");
    stopCameraStream();
  };

  const onSavePhoto = async (orderId: string) => {
    if (!capturedPhotoDataUrl) {
      setCameraError("Сначала сделайте снимок.");
      return;
    }
    setPhotoSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setPhotoHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/photos`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ data_url: capturedPhotoDataUrl }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order photo save failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as OrderPhotoHistoryItem;
      setPhotoHistoryByOrder((prev) => ({ ...prev, [orderId]: [entry, ...(prev[orderId] || [])] }));
      closeCameraModal();
    } catch (e: any) {
      setPhotoHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to save photo" }));
    } finally {
      setPhotoSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const buildFeedItems = (orderId: string): OrderFeedItem[] => {
    const statusItems: OrderFeedItem[] = (statusHistoryByOrder[orderId] || []).map((entry, index) => ({
      kind: "status",
      id: `status-${orderId}-${index}-${entry.changed_at}`,
      title: entry.status,
      created_at: entry.changed_at,
    }));
    const issueItems: OrderFeedItem[] = (issueHistoryByOrder[orderId] || []).map((entry) => ({
      kind: "issue",
      id: entry.id,
      issue_kind: entry.issue_kind,
      title: entry.issue_kind === "return" ? "Возврат" : entry.issue_kind === "problem" ? "Проблема" : "Выдано",
      reason: entry.reason,
      created_at: entry.created_at,
      created_by_name: entry.created_by_name,
    }));
    const commentItems: OrderFeedItem[] = (commentHistoryByOrder[orderId] || []).map((entry) => ({
      kind: "comment",
      id: entry.id,
      title: entry.comment,
      created_at: entry.created_at,
      created_by_name: entry.created_by_name,
    }));
    const photoItems: OrderFeedItem[] = (photoHistoryByOrder[orderId] || []).map((entry) => ({
      kind: "photo",
      id: entry.id,
      title: "Фото заказа",
      image_url: entry.data_url,
      created_at: entry.created_at,
      created_by_name: entry.created_by_name,
    }));
    return [...issueItems, ...statusItems, ...commentItems, ...photoItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  };

  const onToggleOpen = (id: string) => {
    setOpenOrderId((prev) => (prev === id ? null : id));
    setActiveCallbackOrderId(null);
    if (openOrderId !== id) {
      void loadFinanceLines(id);
      void loadStatusHistory(id);
      void loadIssueHistory(id);
      void loadCommentHistory(id);
      void loadPhotoHistory(id);
      const order = items.find((x) => x.id === id);
      if (order?.contact_uuid) {
        void loadContactInfo(id, order.contact_uuid);
      }
      void loadCreatorInfo(id);
    }
  };

  const onStartIssue = (orderId: string, kind: OrderIssueKind) => {
    onCancelCallback(orderId);
    onCancelComment(orderId);
    setIssueDraftKindByOrder((prev) => ({ ...prev, [orderId]: kind }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    if (kind !== "return") {
      setIssueReturnTypeByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueReturnMoneySourceByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueReturnAmountByOrder((prev) => ({ ...prev, [orderId]: "" }));
    }
  };

  const onCancelIssue = (orderId: string) => {
    setIssueDraftKindByOrder((prev) => ({ ...prev, [orderId]: undefined }));
    setIssueDraftReasonByOrder((prev) => ({ ...prev, [orderId]: "" }));
    setIssueReturnTypeByOrder((prev) => ({ ...prev, [orderId]: undefined }));
    setIssueReturnMoneySourceByOrder((prev) => ({ ...prev, [orderId]: undefined }));
    setIssueReturnAmountByOrder((prev) => ({ ...prev, [orderId]: "" }));
  };

  const onStartComment = (orderId: string) => {
    onCancelCallback(orderId);
    setCommentDraftOpenByOrder((prev) => ({ ...prev, [orderId]: true }));
    setCommentHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
  };

  const onCancelComment = (orderId: string) => {
    setCommentDraftOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
    setCommentDraftTextByOrder((prev) => ({ ...prev, [orderId]: "" }));
  };

  const onStartCallback = (orderId: string, hasActiveCallback: boolean) => {
    onCancelComment(orderId);
    setActiveCallbackOrderId(orderId);
    setCallbackDraftOpenByOrder((prev) => ({ ...prev, [orderId]: true }));
    setCallbackNeedDateByOrder((prev) => ({ ...prev, [orderId]: !hasActiveCallback }));
    setCallbackCommentByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] || "" }));
    if (!hasActiveCallback) {
      setCallbackDateByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] || toYmdLocal(new Date()) }));
    }
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
  };

  const onCancelCallback = (orderId: string) => {
    setActiveCallbackOrderId((prev) => (prev === orderId ? null : prev));
    setCallbackDraftOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
    setCallbackDateByOrder((prev) => ({ ...prev, [orderId]: "" }));
    setCallbackCommentByOrder((prev) => ({ ...prev, [orderId]: "" }));
    setCallbackNeedDateByOrder((prev) => ({ ...prev, [orderId]: false }));
  };

  const onSaveComment = async (orderId: string) => {
    const comment = String(commentDraftTextByOrder[orderId] || "").trim();
    if (!comment) {
      setCommentHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "Укажите комментарий." }));
      return;
    }
    setCommentSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setCommentHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/comments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ comment }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order comment save failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as OrderCommentHistoryItem;
      setCommentHistoryByOrder((prev) => ({ ...prev, [orderId]: [entry, ...(prev[orderId] || [])] }));
      setCommentDraftOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
      setCommentDraftTextByOrder((prev) => ({ ...prev, [orderId]: "" }));
    } catch (e: any) {
      setCommentHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to save comment" }));
    } finally {
      setCommentSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onSaveCallback = async (orderId: string) => {
    const callbackDate = String(callbackDateByOrder[orderId] || "").trim();
    if (!callbackDate) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "Выберите дату звонка." }));
      return;
    }
    setCallbackSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/callback-reminders`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ callback_date: callbackDate }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`callback reminder save failed: ${resp.status} ${body}`);
      }
      const reminder = await resp.json();
      const reason = `Связаться: позвонить ${new Date(`${callbackDate}T00:00:00`).toLocaleDateString("ru-RU")}`;
      setItems((prev) =>
        prev.map((it) => (it.id === orderId ? { ...it, issue_kind: "problem", active_callback_date: reminder.callback_date } : it))
      );
      setIssueHistoryByOrder((prev) => ({
        ...prev,
        [orderId]: [{ id: reminder.id, issue_kind: "problem", reason, created_at: reminder.created_at }, ...(prev[orderId] || [])],
      }));
      const extraComment = String(callbackCommentByOrder[orderId] || "").trim();
      if (extraComment) {
        const commentResp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ comment: extraComment }),
        });
        if (!commentResp.ok) {
          const body = await commentResp.text().catch(() => "");
          throw new Error(`order comment save failed: ${commentResp.status} ${body}`);
        }
        const commentEntry = (await commentResp.json()) as OrderCommentHistoryItem;
        setCommentHistoryByOrder((prev) => ({ ...prev, [orderId]: [commentEntry, ...(prev[orderId] || [])] }));
      }
      setCallbackDraftOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
      setCallbackDateByOrder((prev) => ({ ...prev, [orderId]: "" }));
      setCallbackCommentByOrder((prev) => ({ ...prev, [orderId]: "" }));
      setCallbackNeedDateByOrder((prev) => ({ ...prev, [orderId]: false }));
      setActiveCallbackOrderId((prev) => (prev === orderId ? null : prev));
    } catch (e: any) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to save callback" }));
    } finally {
      setCallbackSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onCompleteCallback = async (orderId: string) => {
    const comment = String(callbackCommentByOrder[orderId] || "").trim();
    setCallbackSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/callback-complete`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ comment }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`callback complete failed: ${resp.status} ${body}`);
      }
      const payload = (await resp.json()) as OrderCallbackCompleteResponse;
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, ...payload.order, active_callback_date: null } : it)));
      setCommentHistoryByOrder((prev) => ({
        ...prev,
        [orderId]: [payload.comment_entry, ...(prev[orderId] || [])],
      }));
      setCallbackDraftOpenByOrder((prev) => ({ ...prev, [orderId]: false }));
      setCallbackCommentByOrder((prev) => ({ ...prev, [orderId]: "" }));
      setCallbackDateByOrder((prev) => ({ ...prev, [orderId]: "" }));
      setCallbackNeedDateByOrder((prev) => ({ ...prev, [orderId]: false }));
      setActiveCallbackOrderId((prev) => (prev === orderId ? null : prev));
    } catch (e: any) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to complete callback" }));
    } finally {
      setCallbackSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onSaveIssue = async (orderId: string) => {
    const issueKind = issueDraftKindByOrder[orderId];
    const reason = String(issueDraftReasonByOrder[orderId] || "").trim();
    const returnType = issueReturnTypeByOrder[orderId];
    const returnMoneySource = issueReturnMoneySourceByOrder[orderId];
    if (!issueKind) return;
    if (issueKind === "return" && !returnType) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "Выберите тип возврата." }));
      return;
    }
    if (issueKind === "return" && returnType === "money" && !returnMoneySource) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "Выберите источник возврата." }));
      return;
    }
    if (!reason) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "Укажите причину." }));
      return;
    }
    setIssueSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      if (issueKind === "return") {
        const displayResp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/display-status`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ display_status: "Принято в работу" }),
        });
        if (!displayResp.ok) {
          const body = await displayResp.text().catch(() => "");
          throw new Error(`display status save failed: ${displayResp.status} ${body}`);
        }
        const updatedOrder = (await displayResp.json()) as OrderItem;
        setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, ...updatedOrder } : it)));
      }
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/issues`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ issue_kind: issueKind, reason }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order issue save failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as OrderIssueHistoryItem;
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, issue_kind: entry.issue_kind } : it)));
      setIssueHistoryByOrder((prev) => ({ ...prev, [orderId]: [entry, ...(prev[orderId] || [])] }));
      if (issueKind === "return") {
        setStatusHistoryByOrder((prev) => ({
          ...prev,
          [orderId]: [{ status: "Принято в работу", changed_at: new Date().toISOString() }, ...(prev[orderId] || [])],
        }));
      }
      setIssueDraftKindByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueDraftReasonByOrder((prev) => ({ ...prev, [orderId]: "" }));
      setIssueReturnTypeByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueReturnMoneySourceByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueReturnAmountByOrder((prev) => ({ ...prev, [orderId]: "" }));
    } catch (e: any) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to save issue" }));
    } finally {
      setIssueSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onSetDisplayStatus = async (orderId: string, nextDisplayStatus: string) => {
    setIssueSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/display-status`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ display_status: nextDisplayStatus }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order display status save failed: ${resp.status} ${body}`);
      }
      const updatedOrder = (await resp.json()) as OrderItem;
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, ...updatedOrder } : it)));
      setStatusHistoryByOrder((prev) => ({
        ...prev,
        [orderId]: [{ status: nextDisplayStatus, changed_at: new Date().toISOString() }, ...(prev[orderId] || [])],
      }));
      setConfirmIssuedByOrder((prev) => ({ ...prev, [orderId]: false }));
      setIssueDraftKindByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueDraftReasonByOrder((prev) => ({ ...prev, [orderId]: "" }));
      setIssueReturnTypeByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueReturnMoneySourceByOrder((prev) => ({ ...prev, [orderId]: undefined }));
      setIssueReturnAmountByOrder((prev) => ({ ...prev, [orderId]: "" }));
    } catch (e: any) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to save display status" }));
    } finally {
      setIssueSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onClearProblem = async (orderId: string) => {
    setIssueSavingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/issue-kind`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ issue_kind: null }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`order problem clear failed: ${resp.status} ${body}`);
      }
      const updatedOrder = (await resp.json()) as OrderItem;
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, ...updatedOrder } : it)));
      setStatusHistoryByOrder((prev) => ({
        ...prev,
        [orderId]: [{ status: "Проблема снята", changed_at: new Date().toISOString() }, ...(prev[orderId] || [])],
      }));
      setConfirmClearProblemByOrder((prev) => ({ ...prev, [orderId]: false }));
    } catch (e: any) {
      setIssueHistoryErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to clear problem" }));
    } finally {
      setIssueSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onPrevPage = async () => {
    if (page <= 1) return;
    await load(page - 1);
  };

  const onNextPage = async () => {
    if (page >= totalPages) return;
    await load(page + 1);
  };

  const onApplyFilters = async () => {
    const next = { ...draftFilters, order_ids: "", search: draftFilters.search.trim() };
    setAppliedFilters(next);
    await load(1, next);
  };

  const loadFinanceLines = async (orderId: string) => {
    if (financeByOrder[orderId]) return;
    setFinanceLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setFinanceErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/finance/finance/orders/${encodeURIComponent(orderId)}/lines`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`finance lines failed: ${resp.status} ${body}`);
      }
      const lines = (await resp.json()) as FinanceLine[];
      setFinanceByOrder((prev) => ({ ...prev, [orderId]: lines || [] }));
    } catch (e: any) {
      setFinanceErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load finance lines" }));
    } finally {
      setFinanceLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  useEffect(() => {
    for (const order of items) {
      if (!financeByOrder[order.id] && !financeLoadingByOrder[order.id]) {
        void loadFinanceLines(order.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!cameraOrderId || !cameraVideoRef.current || !cameraStreamRef.current) return;
    const video = cameraVideoRef.current;
    video.srcObject = cameraStreamRef.current;
    void video.play().catch(() => {
      setCameraError("Не удалось запустить камеру.");
    });
    return () => {
      if (video.srcObject === cameraStreamRef.current) {
        video.srcObject = null;
      }
    };
  }, [cameraOrderId]);

  useEffect(() => {
    return () => {
      if (cameraToastTimerRef.current) {
        window.clearTimeout(cameraToastTimerRef.current);
        cameraToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  const isOrderPaid = (orderId: string): boolean => {
    const lines = financeByOrder[orderId] || [];
    if (!lines.length) return false;
    return lines.every((line) => !!line.is_paid);
  };

  const loadContactInfo = async (orderId: string, contactId: string) => {
    if (!contactId || contactByOrder[orderId] || contactLoadingByOrder[orderId]) return;
    setContactLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setContactErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/contacts/contacts/${encodeURIComponent(contactId)}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`contact load failed: ${resp.status} ${body}`);
      }
      const contact = (await resp.json()) as ContactInfo;
      setContactByOrder((prev) => ({ ...prev, [orderId]: contact }));
    } catch (e: any) {
      setContactErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load contact" }));
    } finally {
      setContactLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const renderTemplate = (html: string, ctx: Record<string, string>) => {
    const source = String(html || "");
    const ctxLower: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx)) ctxLower[normPrintPlaceholderKey(k)] = String(v ?? "");
    return source.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, keyRaw: string) => {
      const key = normPrintPlaceholderKey(String(keyRaw || ""));
      if (Object.prototype.hasOwnProperty.call(ctxLower, key)) return ctxLower[key];
      const sizedQr = key.match(/^warehouse_qr_(site|yandex|vk|telegram)_svg_(\d{1,4})$/i);
      if (sizedQr) {
        const channel = String(sizedQr[1] || "").toLowerCase();
        const px = Math.max(32, Math.min(600, Number.parseInt(String(sizedQr[2] || "100"), 10) || 100));
        const rawKey = `warehouse_qr_${channel}_svg_raw`;
        const rawSvg = String(ctxLower[rawKey] || "");
        return fitSvgForPrint(rawSvg, px);
      }
      return _m;
    });
  };

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
    const uri = `data:image/svg+xml;base64,${asBase64}`;
    return `<img src="${uri}" width="${targetPx}" height="${targetPx}" style="display:block; width:${targetPx}px; height:${targetPx}px; object-fit:contain;" />`;
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

  const onPrintWithForm = async (order: OrderItem, formBrief: PrintFormListItem) => {
    setError(null);
    setPrintDropdownOrderId(null);
    let w: Window | null = null;
    try {
      if (formBrief.qz_enabled) {
        await connectQzTray();
      }
      const [formResp, financeResp, contactResp, creatorResp] = await Promise.all([
        fetchWithRetry(`${base}/documents/print/forms/${encodeURIComponent(formBrief.id)}?_cb=${Date.now()}`, { cache: "no-store", headers: authHeaders() }),
        fetchWithRetry(`${base}/finance/finance/orders/${encodeURIComponent(order.id)}/lines`, { cache: "no-store", headers: authHeaders() }),
        order.contact_uuid
          ? fetchWithRetry(`${base}/contacts/contacts/${encodeURIComponent(order.contact_uuid)}`, {
              cache: "no-store",
              headers: authHeaders(),
            })
          : Promise.resolve(null as any),
        fetchWithRetry(`${base}/orders/orders/${encodeURIComponent(order.id)}/creator`, {
          cache: "no-store",
          headers: authHeaders(),
        }),
      ]);

      if (!formResp.ok) {
        const body = await formResp.text().catch(() => "");
        throw new Error(`form load failed: ${formResp.status} ${body}`);
      }
      if (!financeResp.ok) {
        const body = await financeResp.text().catch(() => "");
        throw new Error(`finance load failed: ${financeResp.status} ${body}`);
      }
      if (contactResp && !contactResp.ok) {
        const body = await contactResp.text().catch(() => "");
        throw new Error(`contact load failed: ${contactResp.status} ${body}`);
      }
      if (!creatorResp.ok) {
        const body = await creatorResp.text().catch(() => "");
        throw new Error(`creator load failed: ${creatorResp.status} ${body}`);
      }

      const form = await formResp.json();
      const financeLines = (await financeResp.json()) as FinanceLine[];
      const contact = contactResp ? await contactResp.json() : null;
      const creator = (await creatorResp.json()) as CreatorInfo;
      const printTitle = String(form?.title || "Документ").trim() || "Документ";
      const widthMm = pageSizeMm(form?.page_width_mm, 200);
      const heightMm = pageSizeMm(form?.page_height_mm, 300);
      const marginMm = pageSizeMm(form?.page_margin_mm, 0);
      const autoHeight = Boolean(form?.page_auto_height);
      const pageHeight = autoHeight ? "auto" : `${heightMm}mm`;
      const transformCss = printTransformCss(form);

      const workTypesText =
        (order.work_type_ids || []).map((id) => workTypeNameById[id] || id).join(", ") || "-";
      const paymentMethod = financeLines?.[0]?.payment_method ? (financeLines[0].payment_method === "card" ? "Оплата по карте" : "Наличкой") : "";
      const isPaid = financeLines?.some((x) => x.is_paid) ? "Да" : "Нет";
      const totalAmount = (financeLines || []).reduce((sum, x) => sum + Number(x.amount || 0), 0);
      const linesText = (financeLines || [])
        .map(
          (l) =>
            `${workTypeNameById[l.work_type_uuid] || l.work_type_uuid}: ${l.amount} ${l.currency || "RUB"} | предоплата: ${l.prepayment ?? "-"} ${
              l.prepayment != null ? l.currency || "RUB" : ""
            }`
        )
        .join("\n");
      const linesTextHtml = linesText.replace(/\n/g, "<br/>");

      const ctx: Record<string, string> = {
        contact_name: String(contact?.name || "-"),
        contact_phone: String(contact?.phone || "-"),
        contact_email: String(contact?.email || ""),
        order_id: String(order.id || ""),
        order_number: String(order.order_number ?? ""),
        order_status: String(order.status),
        order_kind: orderKindLabel(order.order_kind),
        order_created_at: formatOrderDateAndTime(order.created_at).date,
        user_name: String(creatorDisplayName(creator) || "-"),
        user_login: String(creator?.username || creator?.email || "-"),
        service_category_name: String(categoryNameById[order.service_category_id || ""] || "-"),
        service_object_name: String(serviceObjectNameById[order.service_object_id || ""] || "-"),
        serial_model: String(order.serial_model || ""),
        work_types: workTypesText,
        warehouse_name: String(warehouseNameById[order.warehouse_id || ""] || "-"),
        warehouse_address: String(warehouseById[order.warehouse_id || ""]?.address || "-"),
        warehouse_point_phone: String(warehouseById[order.warehouse_id || ""]?.point_phone || "-"),
        warehouse_qr_site_svg_raw: String(warehouseById[order.warehouse_id || ""]?.qr_site_svg || ""),
        warehouse_qr_yandex_svg_raw: String(warehouseById[order.warehouse_id || ""]?.qr_yandex_svg || ""),
        warehouse_qr_vk_svg_raw: String(warehouseById[order.warehouse_id || ""]?.qr_vk_svg || ""),
        warehouse_qr_telegram_svg_raw: String(warehouseById[order.warehouse_id || ""]?.qr_telegram_svg || ""),
        warehouse_qr_site_svg: fitSvgForPrint(String(warehouseById[order.warehouse_id || ""]?.qr_site_svg || ""), 100),
        warehouse_qr_yandex_svg: fitSvgForPrint(String(warehouseById[order.warehouse_id || ""]?.qr_yandex_svg || ""), 100),
        warehouse_qr_vk_svg: fitSvgForPrint(String(warehouseById[order.warehouse_id || ""]?.qr_vk_svg || ""), 100),
        warehouse_qr_telegram_svg: fitSvgForPrint(String(warehouseById[order.warehouse_id || ""]?.qr_telegram_svg || ""), 100),
        payment_method: paymentMethod,
        is_paid: isPaid,
        total_amount: String(totalAmount),
        lines_text: linesTextHtml,
      };

      if (Boolean(form?.qz_enabled ?? formBrief.qz_enabled)) {
        const tpl = String(form?.content_html || "").trim();
        if (!tpl) throw new Error("QZ: в форме пустое тело печати.");
        const qzCtx = Object.fromEntries(Object.entries(ctx).map(([key, value]) => [key, tsplEscapeText(value, 200)]));
        const unknownPh = findUnknownPlaceholderKeys(tpl, qzCtx);
        if (unknownPh.length > 0) throw new Error(`QZ: в шаблоне неизвестные имена: ${unknownPh.join(", ")}`);
        const renderedRaw = renderTemplate(tpl, qzCtx);
        const rendered = htmlToPlainLinesForTspl(renderedRaw);
        if (!rendered.trim()) throw new Error("QZ: после очистки HTML шаблон пуст.");
        const commands = looksLikeTspl(rendered) ? [ensureTsplPrintFooter(normalizeTsplPayload(rendered))] : null;
        if (commands) await qzPrintRaw(QZ_DEFAULT_PRINTER_NAME, commands);
        else await qzPrintRawHex(QZ_DEFAULT_PRINTER_NAME, htmlTo30x20TsplHex(renderedRaw));
        return;
      }

      const html = renderTemplate(String(form?.content_html || ""), ctx);
      w = window.open("about:blank", "_blank");
      if (!w) throw new Error("popup blocked");
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${printTitle}</title>
        <style>
          body{font-family:Arial, sans-serif; margin:0; padding:0;}
          .print-root{width:100%; margin:0; padding:0;${transformCss}}
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
      </head><body><div class="print-root">${html}</div></body></html>`);
      w.document.close();
      try {
        w.history.replaceState({}, "", "/print-preview");
      } catch {
        // ignore
      }
      w.focus();
      setTimeout(() => w.print(), 300);
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

  const loadCreatorInfo = async (orderId: string) => {
    if (creatorByOrder[orderId] || creatorLoadingByOrder[orderId]) return;
    setCreatorLoadingByOrder((prev) => ({ ...prev, [orderId]: true }));
    setCreatorErrorByOrder((prev) => ({ ...prev, [orderId]: "" }));
    try {
      const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(orderId)}/creator`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`creator load failed: ${resp.status} ${body}`);
      }
      const creator = (await resp.json()) as CreatorInfo;
      setCreatorByOrder((prev) => ({ ...prev, [orderId]: creator }));
    } catch (e: any) {
      setCreatorErrorByOrder((prev) => ({ ...prev, [orderId]: e?.message || "failed to load creator" }));
    } finally {
      setCreatorLoadingByOrder((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/warehouses/warehouses/accessible`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        const rows = (await resp.json()) as Array<{
          id: string;
          name: string;
          address?: string;
          point_phone?: string;
          qr_site_svg?: string;
          qr_yandex_svg?: string;
          qr_vk_svg?: string;
          qr_telegram_svg?: string;
        }>;
        const nextOptions: WarehouseOption[] = [];
        const nextNames: Record<string, string> = {};
        const nextMap: Record<string, WarehouseInfo> = {};
        for (const row of rows || []) {
          const id = String(row.id || "");
          if (!id) continue;
          const name = String(row.name || "");
          nextOptions.push({ id, name });
          nextNames[id] = name;
          nextMap[id] = {
            name,
            address: String(row.address || ""),
            point_phone: String(row.point_phone || ""),
            qr_site_svg: String(row.qr_site_svg || ""),
            qr_yandex_svg: String(row.qr_yandex_svg || ""),
            qr_vk_svg: String(row.qr_vk_svg || ""),
            qr_telegram_svg: String(row.qr_telegram_svg || ""),
          };
        }
        setWarehouseOptions(nextOptions);
        setWarehouseNameById(nextNames);
        setWarehouseById(nextMap);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        const payload = parseJwtPayload(token);
        const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
        const useAllCategories = roles.includes("superadmin");
        const [catResp, objResp, wtResp] = await Promise.all([
          fetch(
            `${base}/orders/settings/service-categories${useAllCategories ? "" : "/accessible"}`,
            { cache: "no-store", headers: authHeaders() }
          ),
          fetch(`${base}/orders/settings/service-objects?limit=500`, { cache: "no-store", headers: authHeaders() }),
          fetch(`${base}/orders/settings/work-types?limit=500`, { cache: "no-store", headers: authHeaders() }),
        ]);
        if (catResp.ok) {
          const rows = (await catResp.json()) as Array<{ id: string; name: string }>;
          const next: Record<string, string> = {};
          for (const row of rows || []) next[row.id] = row.name;
          setCategoryNameById(next);
        }
        if (objResp.ok) {
          const rows = (await objResp.json()) as Array<{ id: string; name: string; service_category_id: string }>;
          const next: Record<string, string> = {};
          const nextOptions: ServiceObjectOption[] = [];
          for (const row of rows || []) {
            next[row.id] = row.name;
            nextOptions.push({ id: row.id, name: row.name, service_category_id: row.service_category_id });
          }
          setServiceObjectNameById(next);
          setServiceObjectOptions(nextOptions);
        }
        if (wtResp.ok) {
          const rows = (await wtResp.json()) as Array<{ id: string; name: string }>;
          const next: Record<string, string> = {};
          for (const row of rows || []) next[row.id] = row.name;
          setWorkTypeNameById(next);
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список заказов</h3>
        <div className="mb-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <select
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.order_kind}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, order_kind: e.target.value }))}
            >
              <option value="">Тип заказа</option>
              <option value="onsite">Услуга на месте</option>
              <option value="repair">Оставили в ремонт</option>
            </select>
            <select
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.service_category_id}
              onChange={(e) => {
                setDraftFilters((prev) => ({ ...prev, service_category_id: e.target.value, service_object_id: "" }));
                setServiceObjectFilterQuery("");
              }}
            >
              <option value="">Категория услуг</option>
              {Object.entries(categoryNameById).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <div className="relative">
              <input
                className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={serviceObjectFilterQuery}
                onFocus={() => setServiceObjectFilterOpen(true)}
                onBlur={() => setTimeout(() => setServiceObjectFilterOpen(false), 120)}
                onChange={(e) => {
                  setServiceObjectFilterQuery(e.target.value);
                  setDraftFilters((prev) => ({ ...prev, service_object_id: "" }));
                  setServiceObjectFilterOpen(true);
                }}
                placeholder="Объект ремонта"
              />
              {serviceObjectFilterOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
                  {!serviceObjectFilterOptions.length ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                  ) : (
                    serviceObjectFilterOptions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                        onClick={() => {
                          setDraftFilters((prev) => ({ ...prev, service_object_id: item.id }));
                          setServiceObjectFilterQuery(item.name);
                          setServiceObjectFilterOpen(false);
                        }}
                      >
                        {item.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <input
                className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={workTypeFilterQuery}
                onFocus={() => setWorkTypeFilterOpen(true)}
                onBlur={() => setTimeout(() => setWorkTypeFilterOpen(false), 120)}
                onChange={(e) => {
                  const next = e.target.value;
                  setWorkTypeFilterQuery(next);
                  setDraftFilters((prev) => ({ ...prev, work_type_id: "" }));
                  setWorkTypeFilterOpen(true);
                }}
                placeholder="Вид работы"
              />
              {workTypeFilterOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
                  {!workTypeFilterOptions.length ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                  ) : (
                    workTypeFilterOptions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                        onClick={() => {
                          setDraftFilters((prev) => ({ ...prev, work_type_id: item.id }));
                          setWorkTypeFilterQuery(item.name);
                          setWorkTypeFilterOpen(false);
                        }}
                      >
                        {item.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {warehouseOptions.length ? (
              <select
                className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={draftFilters.warehouse_id}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, warehouse_id: e.target.value }))}
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setCreatorFilterQuery(next);
                    setDraftFilters((prev) => ({ ...prev, created_by_uuid: "" }));
                  }}
                  placeholder="Создатель заказа"
                />
                {creatorFilterOpen && (
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
                )}
              </div>
            ) : null}
            <input
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.search}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Серийник / объект / телефон / имя"
            />
            <DatePicker
              id="orders-list-date-range"
              mode="range"
              placeholder="Выберите даты"
              onChange={(dates) => {
                const list = Array.isArray(dates) ? dates : [];
                const from = list[0] ? toYmdLocal(list[0] as Date) : "";
                const to = list[1] ? toYmdLocal(list[1] as Date) : from;
                setDraftFilters((prev) => ({ ...prev, created_from: from, created_to: to }));
              }}
            />
            <Button size="sm" onClick={() => void onApplyFilters()} disabled={loading}>
              Отфильтровать
            </Button>
          </div>
        </div>
        {error && <div className="text-sm text-red-600 mb-3">Ошибка: {error}</div>}
        {!items.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Заказов пока нет.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                    >
                      Номер заказа
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                    >
                      Статус
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                    >
                      Дата создания
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                    >
                      Оплата
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {items.map((order, index) => {
                    const isOpen = openOrderId === order.id;
                    const issueKind = order.issue_kind || null;
                    const displayStatus = String(order.display_status || "").trim() || (issueKind === "issued" ? "Выдано" : "");
                    const hasProblemMark = issueKind === "return" || issueKind === "problem";
                    const isIssued = displayStatus === "Выдано";
                    const shouldShowInternalStatus = !!order.status_selected_manually;
                    const confirmIssued = !!confirmIssuedByOrder[order.id];
                    const confirmClearProblem = !!confirmClearProblemByOrder[order.id];
                    const canClearProblem = isAdmin;
                    const canClearIssue = issueKind === "return" || (issueKind === "problem" && canClearProblem);
                    const hasActiveCallback = !!order.active_callback_date;
                    const callbackNeedDate = !!callbackNeedDateByOrder[order.id];
                    const showCallbackActions = hasActiveCallback && !callbackNeedDate;
                    const showCallbackDate = !hasActiveCallback || callbackNeedDate;
                    const issueDraftKind = issueDraftKindByOrder[order.id];
                    const issueReturnType = issueReturnTypeByOrder[order.id];
                    const issueReturnMoneySource = issueReturnMoneySourceByOrder[order.id];
                    const issueReturnRefundDate = getReturnRefundDate(order.created_at, issueReturnMoneySource);
                    const availableServiceObjectOptions = serviceObjectOptionsForOrder(
                      order,
                      serviceObjectQueryByOrder[order.id] || ""
                    );
                    const orderToneClass =
                      index % 2 === 0 ? "bg-white dark:bg-white/[0.03]" : "bg-gray-50 dark:bg-white/[0.06]";
                    return (
                    <React.Fragment key={order.id}>
                      <tr
                        className={`cursor-pointer ${
                          hasProblemMark
                            ? "bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/15"
                            : `${orderToneClass} hover:bg-gray-100/70 dark:hover:bg-white/[0.08]`
                        }`}
                        onClick={() => onToggleOpen(order.id)}
                      >
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                          {order.order_number ?? "-"}
                        </td>
                        <td className="px-5 py-4 text-start">
                          <div className="inline-flex items-center gap-2">
                            {displayStatus && (
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                  displayStatus === "Выполнено" || displayStatus === "Выдано"
                                    ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                                    : "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                }`}
                              >
                                {displayStatus}
                              </span>
                            )}
                            {hasProblemMark && (
                              <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                Проблемы
                              </span>
                            )}
                            {shouldShowInternalStatus && (
                              <span
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                                style={{
                                  backgroundColor: statusColorByName[order.status] || "#22c55e",
                                  color: textColorForBg(statusColorByName[order.status] || "#22c55e"),
                                }}
                              >
                                {order.status}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                          {formatOrderDateAndTime(order.created_at).date} (
                          {orderKindLabel(order.order_kind)} {formatOrderDateAndTime(order.created_at).time})
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm">
                          {financeLoadingByOrder[order.id] && !financeByOrder[order.id] ? (
                            <span className="text-gray-500 dark:text-gray-400">...</span>
                          ) : isOrderPaid(order.id) ? (
                            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                              <span aria-hidden>✓</span>
                              <span>Оплачен</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                              <span aria-hidden>✗</span>
                              <span>Не оплачен</span>
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr
                          className={`border-b-4 border-gray-300 dark:border-gray-600 ${
                            hasProblemMark ? "bg-red-50 dark:bg-red-500/10" : orderToneClass
                          }`}
                        >
                          <td
                            className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300"
                            colSpan={4}
                          >
                            <div className="space-y-3">
                              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Основные данные</div>
                              <div className="flex items-center gap-2">
                                <span>Дополнительный статус:</span>
                                <select
                                  className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                                  value={order.status_selected_manually ? order.status : ""}
                                  disabled={!!statusSavingByOrder[order.id]}
                                  onChange={(e) => void onChangeStatus(order.id, e.target.value)}
                                >
                                  <option value="">Нет</option>
                                  {!statusOptions.length ? (
                                    order.status_selected_manually ? <option value={order.status}>{order.status}</option> : null
                                  ) : (
                                    statusOptions.map((s) => (
                                      <option key={s.id} value={s.name}>
                                        {s.name}
                                      </option>
                                    ))
                                  )}
                                </select>
                              </div>
                              <div>
                                Категория услуги:{" "}
                                {categoryNameById[order.service_category_id || ""] || "-"}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>
                                  Объект ремонта: {serviceObjectNameById[order.service_object_id || ""] || "-"}
                                  {order.serial_model ? ` (${order.serial_model})` : ""}
                                </span>
                                {isAdmin ? (
                                  serviceObjectEditOpenByOrder[order.id] ? (
                                    <>
                                      <div className="relative w-[260px] max-w-full">
                                        <input
                                          className="h-9 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                                          value={serviceObjectQueryByOrder[order.id] || ""}
                                          disabled={!!serviceObjectSavingByOrder[order.id]}
                                          onChange={(event) =>
                                            setServiceObjectQueryByOrder((prev) => ({ ...prev, [order.id]: event.target.value }))
                                          }
                                          placeholder="Найти объект ремонта"
                                        />
                                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
                                          {!availableServiceObjectOptions.length ? (
                                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                                          ) : (
                                            availableServiceObjectOptions.map((item) => (
                                              <button
                                                key={item.id}
                                                type="button"
                                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                                                onClick={() => void onChangeServiceObject(order.id, item.id)}
                                              >
                                                {item.name}
                                              </button>
                                            ))
                                          )}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                        onClick={() => setServiceObjectEditOpenByOrder((prev) => ({ ...prev, [order.id]: false }))}
                                      >
                                        Отмена
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                      disabled={!availableServiceObjectOptions.length}
                                      onClick={() => openServiceObjectEditor(order)}
                                    >
                                      <EditButtonIcon />
                                      Изменить
                                    </button>
                                  )
                                ) : null}
                              </div>
                              <div>
                                Виды работ:{" "}
                                {(order.work_type_ids || [])
                                  .map((id) => workTypeNameById[id] || id)
                                  .join(", ") || "-"}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>Склад: {warehouseNameById[order.warehouse_id || ""] || order.warehouse_id || "-"}</span>
                                {warehouseEditOpenByOrder[order.id] ? (
                                  <>
                                    <select
                                      className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                                      value={warehouseDraftByOrder[order.id] ?? order.warehouse_id ?? ""}
                                      disabled={!!warehouseSavingByOrder[order.id] || !warehouseOptions.length}
                                      onChange={(event) => void onChangeWarehouse(order.id, event.target.value)}
                                    >
                                      {warehouseOptions.map((warehouse) => (
                                        <option key={warehouse.id} value={warehouse.id}>
                                          {warehouse.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                      onClick={() => setWarehouseEditOpenByOrder((prev) => ({ ...prev, [order.id]: false }))}
                                    >
                                      Отмена
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                    disabled={!warehouseOptions.length}
                                    onClick={() => openWarehouseEditor(order)}
                                  >
                                    <EditButtonIcon />
                                    Изменить
                                  </button>
                                )}
                              </div>
                              <div>
                                Контакт:{" "}
                                {!order.contact_uuid ? (
                                  "-"
                                ) : contactLoadingByOrder[order.id] ? (
                                  "Загрузка контакта..."
                                ) : contactErrorByOrder[order.id] ? (
                                  <span className="text-red-600">Ошибка: {contactErrorByOrder[order.id]}</span>
                                ) : contactByOrder[order.id] ? (
                                  `${contactByOrder[order.id]?.phone || "-"} | ${contactByOrder[order.id]?.name || "-"}`
                                ) : (
                                  order.contact_uuid
                                )}
                              </div>
                              <div>
                                {creatorLoadingByOrder[order.id] ? (
                                  "Загрузка..."
                                ) : creatorErrorByOrder[order.id] ? (
                                  <span className="text-red-600">Ошибка: {creatorErrorByOrder[order.id]}</span>
                                ) : creatorByOrder[order.id] ? (
                                  `Принял мастер: ${creatorDisplayName(creatorByOrder[order.id])}`
                                ) : (
                                  order.created_by_uuid || "-"
                                )}
                              </div>

                              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                <span className="inline-flex items-center gap-2">
                                  Финансы
                                  <a
                                    href={`/modules/finance/money?search=${encodeURIComponent(
                                      String(order.order_number ?? "")
                                    )}&open_order_id=${encodeURIComponent(order.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                    title="Редактировать в Бухгалтерии"
                                  >
                                    <EditButtonIcon />
                                    Изменить
                                  </a>
                                </span>
                              </div>
                              {financeLoadingByOrder[order.id] ? (
                                <div>Загрузка финансовых строк...</div>
                              ) : financeErrorByOrder[order.id] ? (
                                <div className="text-red-600">Ошибка: {financeErrorByOrder[order.id]}</div>
                              ) : !(financeByOrder[order.id] || []).length ? (
                                <div>Финансовые строки отсутствуют.</div>
                              ) : (
                                <div className="space-y-1">
                                  {(financeByOrder[order.id] || []).map((line) => (
                                    <div key={line.id}>
                                      {workTypeNameById[line.work_type_uuid] || line.work_type_uuid} | {line.amount} {line.currency} | предоплата:{" "}
                                      {line.prepayment ?? "-"} {line.prepayment != null ? line.currency : ""} | себестоимость: {line.cost_price ?? "-"}{" "}
                                      {line.cost_price != null ? line.currency : ""} |{" "}
                                      {line.payment_method
                                        ? line.payment_method === "card"
                                          ? "Оплата по карте"
                                          : "Наличкой"
                                        : "Не указан"} |{" "}
                                      {line.is_paid ? "Оплачен" : "Не оплачен"}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Печать</div>
                                <div className="relative inline-block">
                                  <button
                                    className="dropdown-toggle inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 shadow-sm hover:border-brand-300 hover:bg-brand-50/60 dark:border-brand-900/50 dark:bg-gray-900 dark:text-brand-300 dark:hover:bg-brand-500/10"
                                    onClick={() => setPrintDropdownOrderId((prev) => (prev === order.id ? null : order.id))}
                                  >
                                    Выбрать форму
                                    <ChevronDownIcon className="w-4 h-4" />
                                  </button>
                                  <Dropdown
                                    isOpen={printDropdownOrderId === order.id}
                                    onClose={() => setPrintDropdownOrderId(null)}
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
                                                  onClick={() => void onPrintWithForm(order, f)}
                                                  className="flex w-full items-center justify-between gap-2 rounded-lg text-left font-normal text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-100"
                                                  onItemClick={() => setPrintDropdownOrderId(null)}
                                                >
                                                  <span>{f.title}</span>
                                                  {f.qz_enabled && (
                                                    <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:border-brand-900/40 dark:bg-brand-900/20 dark:text-brand-300">
                                                      QZ
                                                    </span>
                                                  )}
                                                </DropdownItem>
                                              ))}
                                            </div>
                                          ))}
                                      </div>
                                    )}
                                  </Dropdown>
                                </div>
                              </div>

                              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-3">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCancelComment(order.id);
                                      void onOpenCamera(order.id);
                                    }}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                  >
                                    Фото
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCancelComment(order.id);
                                      setConfirmIssuedByOrder((prev) => ({ ...prev, [order.id]: true }));
                                      setConfirmClearProblemByOrder((prev) => ({ ...prev, [order.id]: false }));
                                    }}
                                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                                      isIssued
                                        ? "border-green-300 bg-green-100 text-green-700 dark:border-green-500/40 dark:bg-green-500/15 dark:text-green-300"
                                        : "border-gray-300 text-gray-700 hover:bg-green-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-green-500/10"
                                    }`}
                                  >
                                    Выдано
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmIssuedByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      onStartComment(order.id);
                                    }}
                                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                                      commentDraftOpenByOrder[order.id]
                                        ? "border-gray-400 bg-gray-100 text-gray-800 dark:border-gray-500/40 dark:bg-white/10 dark:text-gray-100"
                                        : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                    }`}
                                  >
                                    Комментарий
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmIssuedByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      setConfirmClearProblemByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      onStartCallback(order.id, hasActiveCallback);
                                    }}
                                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                                      callbackDraftOpenByOrder[order.id]
                                        ? "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                                        : "border-gray-300 text-gray-700 hover:bg-blue-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-blue-500/10"
                                    }`}
                                  >
                                    Связаться
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmIssuedByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      if (issueKind === "return") {
                                        setConfirmClearProblemByOrder((prev) => ({ ...prev, [order.id]: true }));
                                        return;
                                      }
                                      onStartIssue(order.id, "return");
                                    }}
                                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                                      issueDraftKind === "return" || issueKind === "return"
                                        ? "border-red-300 bg-red-100 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                        : "border-gray-300 text-gray-700 hover:bg-red-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-red-500/10"
                                    }`}
                                  >
                                    Возврат
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmIssuedByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      if (issueKind === "problem" && canClearProblem) {
                                        setConfirmClearProblemByOrder((prev) => ({ ...prev, [order.id]: true }));
                                        return;
                                      }
                                      onStartIssue(order.id, "problem");
                                    }}
                                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                                      issueDraftKind === "problem"
                                        ? "border-red-300 bg-red-100 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                        : "border-gray-300 text-gray-700 hover:bg-red-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-red-500/10"
                                    }`}
                                  >
                                    Проблема
                                  </button>
                                </div>

                                {photoHistoryErrorByOrder[order.id] ? (
                                  <div className="flex justify-end">
                                    <div className="text-sm text-red-600">Ошибка: {photoHistoryErrorByOrder[order.id]}</div>
                                  </div>
                                ) : null}

                                {callbackDraftOpenByOrder[order.id] && activeCallbackOrderId === order.id ? (
                                  <div className="flex justify-end">
                                    <div className="w-full max-w-[380px] rounded-lg border border-blue-200 bg-white/80 p-3 dark:border-blue-500/20 dark:bg-white/[0.03]">
                                      <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                                        {showCallbackActions ? "Связаться с клиентом" : "Когда связаться"}
                                      </div>
                                      {showCallbackDate ? (
                                        <DatePicker
                                          id={`order-callback-date-${order.id}`}
                                          mode="single"
                                          defaultDate={callbackDateByOrder[order.id] || undefined}
                                          placeholder="Выберите дату"
                                          onChange={(dates) => {
                                            const selected = dates?.[0];
                                            setCallbackDateByOrder((prev) => ({
                                              ...prev,
                                              [order.id]: selected ? toYmdLocal(selected) : "",
                                            }));
                                          }}
                                        />
                                      ) : null}
                                      <div className="mt-2 flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (showCallbackActions) {
                                              setCallbackNeedDateByOrder((prev) => ({
                                                ...prev,
                                                [order.id]: true,
                                              }));
                                              setCallbackDateByOrder((prev) => ({
                                                ...prev,
                                                [order.id]: prev[order.id] || order.active_callback_date || toYmdLocal(new Date()),
                                              }));
                                              return;
                                            }
                                            onCancelCallback(order.id);
                                          }}
                                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                        >
                                          {showCallbackActions ? "Нет" : "Отмена"}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={!!callbackSavingByOrder[order.id]}
                                          onClick={() =>
                                            void (showCallbackActions ? onCompleteCallback(order.id) : onSaveCallback(order.id))
                                          }
                                          className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 disabled:opacity-60 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                                        >
                                          {showCallbackActions ? "Выполнено" : "Сохранить"}
                                        </button>
                                      </div>
                                      {hasActiveCallback ? (
                                        <textarea
                                          value={callbackCommentByOrder[order.id] || ""}
                                          onChange={(event) =>
                                            setCallbackCommentByOrder((prev) => ({
                                              ...prev,
                                              [order.id]: event.target.value,
                                            }))
                                          }
                                          rows={3}
                                          placeholder="Комментарий (необязательно)"
                                          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                        />
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}

                                {confirmIssued ? (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onSetDisplayStatus(order.id, "Выдано");
                                      }}
                                      className="rounded-lg border border-green-300 bg-green-100 px-3 py-1.5 text-sm text-green-700 dark:border-green-500/40 dark:bg-green-500/15 dark:text-green-300"
                                    >
                                      Подтвердить
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmIssuedByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      }}
                                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                    >
                                      Нет
                                    </button>
                                  </div>
                                ) : null}

                                {canClearIssue && confirmClearProblem ? (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onClearProblem(order.id);
                                      }}
                                      className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                                    >
                                      {issueKind === "return" ? "Снять возврат" : "Снять проблему"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmClearProblemByOrder((prev) => ({ ...prev, [order.id]: false }));
                                      }}
                                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                    >
                                      Нет
                                    </button>
                                  </div>
                                ) : null}

                                {issueDraftKind && (
                                  <div className="flex justify-end">
                                    <div className="w-full max-w-[380px] rounded-lg border border-red-200 bg-white/80 p-3 dark:border-red-500/20 dark:bg-white/[0.03]">
                                      <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                                        {issueDraftKind === "return" ? "Возврат" : "Описание проблемы"}
                                      </div>
                                      {issueDraftKind === "return" ? (
                                        <div className="mb-3 space-y-3">
                                          <div>
                                            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                              Вариант возврата
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                                              <Radio
                                                id={`return-type-repair-${order.id}`}
                                                name={`return-type-${order.id}`}
                                                value="repair"
                                                checked={issueReturnType === "repair"}
                                                label="Возврат в ремонт"
                                                onChange={(_value) => {
                                                  setIssueReturnTypeByOrder((prev) => ({ ...prev, [order.id]: "repair" }));
                                                  setIssueReturnMoneySourceByOrder((prev) => ({ ...prev, [order.id]: undefined }));
                                                  setIssueReturnAmountByOrder((prev) => ({ ...prev, [order.id]: "" }));
                                                }}
                                              />
                                              <Radio
                                                id={`return-type-money-${order.id}`}
                                                name={`return-type-${order.id}`}
                                                value="money"
                                                checked={issueReturnType === "money"}
                                                label="Возврат денег"
                                                onChange={(_value) =>
                                                  setIssueReturnTypeByOrder((prev) => ({ ...prev, [order.id]: "money" }))
                                                }
                                              />
                                            </div>
                                          </div>

                                          {issueReturnType === "money" ? (
                                            <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                                              <div>
                                                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                  Откуда идет возврат
                                                </div>
                                                <div className="flex flex-wrap gap-x-4 gap-y-2">
                                                  <Radio
                                                    id={`return-money-source-today-${order.id}`}
                                                    name={`return-money-source-${order.id}`}
                                                    value="today_cash"
                                                    checked={issueReturnMoneySource === "today_cash"}
                                                    label="Из сегодняшней кассы"
                                                    onChange={(_value) =>
                                                      setIssueReturnMoneySourceByOrder((prev) => ({
                                                        ...prev,
                                                        [order.id]: "today_cash",
                                                      }))
                                                    }
                                                  />
                                                  <Radio
                                                    id={`return-money-source-order-${order.id}`}
                                                    name={`return-money-source-${order.id}`}
                                                    value="order_day_cash"
                                                    checked={issueReturnMoneySource === "order_day_cash"}
                                                    label="Из кассы в день принятия заказа"
                                                    onChange={(_value) =>
                                                      setIssueReturnMoneySourceByOrder((prev) => ({
                                                        ...prev,
                                                        [order.id]: "order_day_cash",
                                                      }))
                                                    }
                                                  />
                                                </div>
                                              </div>

                                              {issueReturnMoneySource ? (
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                  <div>
                                                    <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                      Сумма возврата
                                                    </div>
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      step="0.01"
                                                      value={issueReturnAmountByOrder[order.id] || ""}
                                                      onChange={(e) =>
                                                        setIssueReturnAmountByOrder((prev) => ({
                                                          ...prev,
                                                          [order.id]: e.target.value,
                                                        }))
                                                      }
                                                      placeholder="Введите сумму"
                                                      className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                                    />
                                                  </div>
                                                  <div>
                                                    <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                                                      Дата возврата
                                                    </div>
                                                    <input
                                                      type="date"
                                                      value={issueReturnRefundDate}
                                                      readOnly
                                                      className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                                    />
                                                  </div>
                                                </div>
                                              ) : null}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      {issueDraftKind === "return" ? (
                                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                          Комментарий
                                        </div>
                                      ) : null}
                                      <textarea
                                        value={issueDraftReasonByOrder[order.id] || ""}
                                        onChange={(e) =>
                                          setIssueDraftReasonByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))
                                        }
                                        placeholder={
                                          issueDraftKind === "return"
                                            ? issueReturnType === "repair"
                                              ? "Введите комментарий по возврату в ремонт"
                                              : issueReturnType === "money"
                                              ? "Введите комментарий по возврату денег"
                                              : "Введите комментарий по возврату"
                                            : "Опишите проблему"
                                        }
                                        rows={3}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                      />
                                      <div className="mt-2 space-y-2">
                                        {issueHistoryErrorByOrder[order.id] ? (
                                          <div className="text-sm text-red-600">Ошибка: {issueHistoryErrorByOrder[order.id]}</div>
                                        ) : null}
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => onCancelIssue(order.id)}
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                          >
                                            Отмена
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void onSaveIssue(order.id)}
                                            disabled={!!issueSavingByOrder[order.id]}
                                            className="rounded-lg border border-red-300 bg-red-100 px-3 py-1.5 text-sm text-red-700 disabled:opacity-60 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                          >
                                            Сохранить
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {commentDraftOpenByOrder[order.id] && (
                                  <div className="flex justify-end">
                                    <div className="w-[250px] rounded-lg border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-white/[0.03]">
                                      <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                                        Комментарий
                                      </div>
                                      <textarea
                                        value={commentDraftTextByOrder[order.id] || ""}
                                        onChange={(e) =>
                                          setCommentDraftTextByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))
                                        }
                                        placeholder="Введите комментарий"
                                        rows={3}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                      />
                                      <div className="mt-2 space-y-2">
                                        {commentHistoryErrorByOrder[order.id] ? (
                                          <div className="text-sm text-red-600">Ошибка: {commentHistoryErrorByOrder[order.id]}</div>
                                        ) : null}
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => onCancelComment(order.id)}
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                          >
                                            Отмена
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void onSaveComment(order.id)}
                                            disabled={!!commentSavingByOrder[order.id]}
                                            className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-60 dark:border-gray-700 dark:bg-white/10 dark:text-gray-100"
                                          >
                                            Сохранить
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {(issueHistoryLoadingByOrder[order.id] ||
                                  commentHistoryLoadingByOrder[order.id] ||
                                  photoHistoryLoadingByOrder[order.id] ||
                                  statusHistoryLoadingByOrder[order.id] ||
                                  (issueHistoryErrorByOrder[order.id] && !issueDraftKind) ||
                                  (commentHistoryErrorByOrder[order.id] && !commentDraftOpenByOrder[order.id]) ||
                                  photoHistoryErrorByOrder[order.id] ||
                                  statusHistoryErrorByOrder[order.id] ||
                                  buildFeedItems(order.id).length > 0) && (
                                  <div className="flex justify-end">
                                    <div className="w-full max-w-xl space-y-2">
                                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Лента</div>
                                      {issueHistoryLoadingByOrder[order.id] ||
                                      commentHistoryLoadingByOrder[order.id] ||
                                      photoHistoryLoadingByOrder[order.id] ||
                                      statusHistoryLoadingByOrder[order.id] ? (
                                        <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
                                      ) : issueHistoryErrorByOrder[order.id] && !issueDraftKind ? (
                                        <div className="text-sm text-red-600">Ошибка: {issueHistoryErrorByOrder[order.id]}</div>
                                      ) : commentHistoryErrorByOrder[order.id] && !commentDraftOpenByOrder[order.id] ? (
                                        <div className="text-sm text-red-600">Ошибка: {commentHistoryErrorByOrder[order.id]}</div>
                                      ) : photoHistoryErrorByOrder[order.id] ? (
                                        <div className="text-sm text-red-600">Ошибка: {photoHistoryErrorByOrder[order.id]}</div>
                                      ) : statusHistoryErrorByOrder[order.id] ? (
                                        <div className="text-sm text-red-600">Ошибка: {statusHistoryErrorByOrder[order.id]}</div>
                                      ) : (
                                        <div className="space-y-2">
                                          {buildFeedItems(order.id).map((entry) => (
                                            <div
                                              key={entry.id}
                                              className="rounded-lg border border-red-100 bg-white/80 px-3 py-2 dark:border-red-500/20 dark:bg-white/[0.03]"
                                            >
                                              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                {entry.kind === "issue" ? (
                                                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                                    {entry.title}
                                                  </span>
                                                ) : entry.kind === "photo" ? (
                                                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                                                    Фото
                                                  </span>
                                                ) : entry.kind === "comment" ? (
                                                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-white/10 dark:text-gray-300">
                                                    Комментарий
                                                  </span>
                                                ) : (
                                                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-white/10 dark:text-gray-300">
                                                    Статус
                                                  </span>
                                                )}
                                                <span>{new Date(entry.created_at).toLocaleString()}</span>
                                                {entry.kind !== "status" && entry.created_by_name ? <span>{entry.created_by_name}</span> : null}
                                              </div>
                                              {entry.kind === "photo" ? (
                                                <button
                                                  type="button"
                                                  onClick={() => setPreviewPhotoUrl(entry.image_url)}
                                                  className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                                                >
                                                  <img
                                                    src={entry.image_url}
                                                    alt="Фото заказа"
                                                    className="h-[200px] w-[200px] object-cover"
                                                  />
                                                </button>
                                              ) : (
                                                <div className="mt-1 text-sm text-gray-800 dark:text-white/90">
                                                  {entry.kind === "issue" ? entry.reason : entry.title}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!!items.length && (
          <div className="flex items-center justify-between mt-4">
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
                  void load(1, appliedFilters, nextSize);
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
                onClick={() => void onPrevPage()}
                disabled={loading || page <= 1}
              >
                Назад
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
                onClick={() => void onNextPage()}
                disabled={loading || page >= totalPages}
              >
                Дальше
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={!!cameraOrderId} onClose={closeCameraModal} className="mx-4 max-w-3xl p-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">Фото заказа</div>
          {capturedPhotoDataUrl ? (
            <img src={capturedPhotoDataUrl} alt="Снимок заказа" className="max-h-[70vh] w-full rounded-xl object-contain" />
          ) : (
            <video ref={cameraVideoRef} autoPlay playsInline muted className="max-h-[70vh] w-full rounded-xl bg-black object-contain" />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {capturedPhotoDataUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => cameraOrderId && void onOpenCamera(cameraOrderId)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                >
                  Переснять
                </button>
                <button
                  type="button"
                  onClick={() => cameraOrderId && void onSavePhoto(cameraOrderId)}
                  disabled={!cameraOrderId || !!photoSavingByOrder[cameraOrderId]}
                  className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 disabled:opacity-60 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                >
                  Сохранить
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onCapturePhoto}
                className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
              >
                Сделать снимок
              </button>
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!previewPhotoUrl} onClose={() => setPreviewPhotoUrl(null)} className="mx-4 max-w-5xl p-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">Фото заказа</div>
          {previewPhotoUrl ? (
            <img src={previewPhotoUrl} alt="Фото заказа" className="max-h-[80vh] w-full rounded-xl object-contain" />
          ) : null}
        </div>
      </Modal>
      {cameraToast ? (
        <div className="fixed bottom-4 left-4 z-[120] max-w-md rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          Ошибка: {cameraToast}
        </div>
      ) : null}
    </div>
  );
}
