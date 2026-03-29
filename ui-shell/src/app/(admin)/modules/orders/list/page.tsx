"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/button/Button";
import DatePicker from "@/components/form/date-picker";
import { ChevronDownIcon, PencilIcon } from "@/icons/index";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
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
  order_kind: string;
  service_category_id: string | null;
  service_object_id: string | null;
  serial_model: string;
  work_type_ids: string[];
  warehouse_id: string | null;
  contact_uuid: string | null;
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

type PrintFormListItem = {
  id: string;
  title: string;
  category_id?: string | null;
  category_name?: string;
  updated_at: string;
};

type WarehouseInfo = {
  name: string;
  address: string;
  point_phone: string;
};

type ListFilters = {
  order_kind: string;
  service_category_id: string;
  work_type_id: string;
  search: string;
  created_from: string;
  created_to: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
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

export default function OrdersListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const searchParams = useSearchParams();
  const initialSearch = String(searchParams.get("search") || "").trim();
  const initialOpenOrderId = String(searchParams.get("open_order_id") || "").trim();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [financeByOrder, setFinanceByOrder] = useState<Record<string, FinanceLine[]>>({});
  const [financeLoadingByOrder, setFinanceLoadingByOrder] = useState<Record<string, boolean>>({});
  const [financeErrorByOrder, setFinanceErrorByOrder] = useState<Record<string, string>>({});
  const [warehouseNameById, setWarehouseNameById] = useState<Record<string, string>>({});
  const [warehouseById, setWarehouseById] = useState<Record<string, WarehouseInfo>>({});
  const [categoryNameById, setCategoryNameById] = useState<Record<string, string>>({});
  const [serviceObjectNameById, setServiceObjectNameById] = useState<Record<string, string>>({});
  const [workTypeNameById, setWorkTypeNameById] = useState<Record<string, string>>({});
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [statusSavingByOrder, setStatusSavingByOrder] = useState<Record<string, boolean>>({});
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
  const [draftFilters, setDraftFilters] = useState<ListFilters>({
    order_kind: "",
    service_category_id: "",
    work_type_id: "",
    search: initialSearch,
    created_from: "",
    created_to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<ListFilters>({
    order_kind: "",
    service_category_id: "",
    work_type_id: "",
    search: initialSearch,
    created_from: "",
    created_to: "",
  });
  const [pendingOpenOrderId, setPendingOpenOrderId] = useState(initialOpenOrderId);
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

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async (targetPage: number, filtersArg?: ListFilters) => {
    setLoading(true);
    setError(null);
    try {
      const f = filtersArg || appliedFilters;
      const qs = new URLSearchParams();
      qs.set("page", String(targetPage));
      qs.set("page_size", "20");
      if (f.order_kind) qs.set("order_kind", f.order_kind);
      if (f.service_category_id) qs.set("service_category_id", f.service_category_id);
      if (f.work_type_id) qs.set("work_type_id", f.work_type_id);
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
      setTotalPages(data.total_pages || 1);
      if (pendingOpenOrderId && (data.items || []).some((x) => x.id === pendingOpenOrderId)) {
        setOpenOrderId(pendingOpenOrderId);
        void loadFinanceLines(pendingOpenOrderId);
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
    (async () => {
      await load(1, appliedFilters);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!nextStatus) return;
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
      setItems((prev) => prev.map((it) => (it.id === orderId ? { ...it, status: nextStatus } : it)));
      setStatusHistoryByOrder((prev) => {
        const existing = prev[orderId] || [];
        return {
          ...prev,
          [orderId]: [{ status: nextStatus, changed_at: new Date().toISOString() }, ...existing],
        };
      });
    } catch (e: any) {
      setError(e?.message || "failed to update status");
    } finally {
      setStatusSavingByOrder((prev) => ({ ...prev, [orderId]: false }));
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

  const onToggleOpen = (id: string) => {
    setOpenOrderId((prev) => (prev === id ? null : id));
    if (openOrderId !== id) {
      void loadFinanceLines(id);
      const order = items.find((x) => x.id === id);
      if (order?.contact_uuid) {
        void loadContactInfo(id, order.contact_uuid);
      }
      void loadCreatorInfo(id);
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
    const next = { ...draftFilters, search: draftFilters.search.trim() };
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
    for (const [k, v] of Object.entries(ctx)) ctxLower[k.toLowerCase()] = String(v ?? "");
    return source.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, keyRaw: string) => {
      const key = String(keyRaw || "").trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(ctxLower, key) ? ctxLower[key] : _m;
    });
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

  const onPrintWithForm = async (order: OrderItem, formId: string) => {
    setError(null);
    setPrintDropdownOrderId(null);
    const w = window.open("about:blank", "_blank");
    try {
      if (!w) throw new Error("popup blocked");
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Документ</title></head><body>Loading...</body></html>`);
      w.document.close();

      const [formResp, financeResp, contactResp, creatorResp] = await Promise.all([
        fetchWithRetry(`${base}/documents/print/forms/${encodeURIComponent(formId)}`, { cache: "no-store", headers: authHeaders() }),
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

      const workTypesText =
        (order.work_type_ids || []).map((id) => workTypeNameById[id] || id).join(", ") || "-";
      const paymentMethod = financeLines?.[0]?.payment_method ? (financeLines[0].payment_method === "card" ? "Оплата по карте" : "Наличкой") : "";
      const isPaid = financeLines?.some((x) => x.is_paid) ? "Да" : "Нет";
      const totalAmount = (financeLines || []).reduce((sum, x) => sum + Number(x.amount || 0), 0);
      const linesText = (financeLines || [])
        .map((l) => `${workTypeNameById[l.work_type_uuid] || l.work_type_uuid}: ${l.amount} ${l.currency || "RUB"}`)
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
        payment_method: paymentMethod,
        is_paid: isPaid,
        total_amount: String(totalAmount),
        lines_text: linesTextHtml,
      };

      const html = renderTemplate(String(form?.content_html || ""), ctx);
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${printTitle}</title>
        <style>
          body{font-family:Arial, sans-serif; padding:0; margin:0;}
          .print-root{padding:24px;}
          img{max-width:100%;}
          @page { margin: 8mm; }
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
        const rows = (await resp.json()) as Array<{ id: string; name: string; address?: string; point_phone?: string }>;
        const nextNames: Record<string, string> = {};
        const nextMap: Record<string, WarehouseInfo> = {};
        for (const row of rows || []) {
          const id = String(row.id || "");
          if (!id) continue;
          const name = String(row.name || "");
          nextNames[id] = name;
          nextMap[id] = {
            name,
            address: String(row.address || ""),
            point_phone: String(row.point_phone || ""),
          };
        }
        setWarehouseNameById(nextNames);
        setWarehouseById(nextMap);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    (async () => {
      try {
        const [catResp, objResp, wtResp] = await Promise.all([
          fetch(`${base}/orders/settings/service-categories`, { cache: "no-store", headers: authHeaders() }),
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
          const rows = (await objResp.json()) as Array<{ id: string; name: string }>;
          const next: Record<string, string> = {};
          for (const row of rows || []) next[row.id] = row.name;
          setServiceObjectNameById(next);
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
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
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, service_category_id: e.target.value }))}
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
                  {items.map((order) => (
                    <React.Fragment key={order.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                        onClick={() => onToggleOpen(order.id)}
                      >
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                          {order.order_number ?? "-"}
                        </td>
                        <td className="px-5 py-4 text-start">
                          <div className="inline-flex items-center gap-2">
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: statusColorByName[order.status] || "#22c55e",
                                color: textColorForBg(statusColorByName[order.status] || "#22c55e"),
                              }}
                            >
                              {order.status}
                            </span>
                            <span
                              className="group relative inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-300 cursor-help"
                              onMouseEnter={() => void loadStatusHistory(order.id)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              ?
                              <div className="hidden group-hover:block absolute left-6 top-1/2 -translate-y-1/2 z-20 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                                {statusHistoryLoadingByOrder[order.id] ? (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Загрузка...</div>
                                ) : statusHistoryErrorByOrder[order.id] ? (
                                  <div className="text-xs text-red-600">Ошибка: {statusHistoryErrorByOrder[order.id]}</div>
                                ) : !(statusHistoryByOrder[order.id] || []).length ? (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">История статусов пуста.</div>
                                ) : (
                                  <div className="space-y-1">
                                    {(statusHistoryByOrder[order.id] || []).map((h, idx) => (
                                      <div key={`${order.id}-h-${idx}`} className="text-xs text-gray-700 dark:text-gray-300">
                                        {h.status} — {new Date(h.changed_at).toLocaleString()}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </span>
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
                      {openOrderId === order.id && (
                        <tr>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300" colSpan={4}>
                            <div className="space-y-3">
                              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Основные данные</div>
                              <div className="flex items-center gap-2">
                                <span>Статус:</span>
                                <select
                                  className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                                  value={order.status}
                                  disabled={!!statusSavingByOrder[order.id]}
                                  onChange={(e) => void onChangeStatus(order.id, e.target.value)}
                                >
                                  {!statusOptions.length ? (
                                    <option value={order.status}>{order.status}</option>
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
                              <div>
                                Объект ремонта:{" "}
                                {serviceObjectNameById[order.service_object_id || ""] || "-"}
                                {order.serial_model ? ` (${order.serial_model})` : ""}
                              </div>
                              <div>
                                Виды работ:{" "}
                                {(order.work_type_ids || [])
                                  .map((id) => workTypeNameById[id] || id)
                                  .join(", ") || "-"}
                              </div>
                              <div>
                                Склад: {warehouseNameById[order.warehouse_id || ""] || order.warehouse_id || "-"}
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
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-brand-600 hover:bg-gray-100 dark:text-brand-400 dark:hover:bg-white/10"
                                    title="Редактировать в Бухгалтерии"
                                  >
                                    <PencilIcon className="size-5 shrink-0" />
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
                                      {workTypeNameById[line.work_type_uuid] || line.work_type_uuid} | {line.amount} {line.currency} |{" "}
                                      {line.payment_method === "card" ? "Оплата по карте" : "Наличкой"} |{" "}
                                      {line.is_paid ? "Оплачен" : "Не оплачен"}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Печать</div>
                                <div className="relative inline-block">
                                  <button
                                    className="dropdown-toggle inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
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
                                                  onClick={() => void onPrintWithForm(order, f.id)}
                                                  className="flex w-full rounded-lg text-left font-normal text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-100"
                                                  onItemClick={() => setPrintDropdownOrderId(null)}
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

        {!!items.length && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Страница {page} из {totalPages}
            </div>
            <div className="flex items-center gap-2">
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
    </div>
  );
}
