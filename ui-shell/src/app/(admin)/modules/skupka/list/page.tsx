"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import { qzPrintRaw, qzPrintRawHex } from "@/lib/qzTray";
import {
  QZ_DEFAULT_PRINTER_NAME,
  ensureTsplPrintFooter,
  findUnknownPlaceholderKeys,
  htmlTo30x20TsplHex,
  htmlToPlainLinesForTspl,
  looksLikeTspl,
  normPrintPlaceholderKey,
  normalizeTsplPayload,
  tsplEscapeText as tsplText,
} from "@/lib/printQzTspl";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DatePicker from "@/components/form/date-picker";
import Button from "@/components/ui/button/Button";
import { ChevronDownIcon } from "@/icons/index";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BuybackDeal = {
  id: string;
  deal_number?: number | null;
  deal_type: string;
  realization_status: "Реализован" | "Не реализован" | string;
  category_id?: string | null;
  category_name?: string;
  purchase_object_id?: string | null;
  purchase_object_name?: string;
  device_condition_names?: string[];
  title: string;
  client_name: string;
  client_phone: string;
  offered_amount: number;
  currency: string;
  status: string;
  contact_uuid?: string;
  warehouse_id?: string | null;
  created_by_uuid?: string;
  comment: string;
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

type WarehouseOption = {
  id: string;
  name: string;
};

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

function dealTypeLabel(value: string): string {
  if (value === "parts") return "На запчасти";
  if (value === "resale") return "На перепродажу";
  return value;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  const date = d.toLocaleDateString("ru-RU");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

function toYmdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function creatorDisplayName(creator: CreatorOption | null | undefined): string {
  if (!creator) return "-";
  const fullName = String(creator.full_name || "").trim();
  if (fullName) return fullName;
  const username = String(creator.username || "").trim();
  if (username) return username;
  const email = String(creator.email || "").trim();
  if (email) return email;
  return "-";
}

function paymentMethodLabel(value: string): string {
  if (value === "cashbox") return "Из кассы";
  if (value === "online_transfer") return "Онлайн перевод";
  return value || "-";
}

type ListFilters = {
  realization_status: "" | "Реализован" | "Не реализован";
  deal_type: "" | "parts" | "resale";
  created_by_uuid: string;
  created_from: string;
  created_to: string;
};

type CreatorOption = {
  user_uuid: string;
  username: string;
  email: string;
  full_name: string;
};

export default function SkupkaListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const searchParams = useSearchParams();
  const [items, setItems] = useState<BuybackDeal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([]);
  const [printForms, setPrintForms] = useState<PrintFormListItem[]>([]);
  const [printFormsError, setPrintFormsError] = useState<string>("");
  const [printFormsLoading, setPrintFormsLoading] = useState(false);
  const [printDropdownDealId, setPrintDropdownDealId] = useState<string | null>(null);
  const [, setQzBusyDealId] = useState<string | null>(null);
  const [lineByDealId, setLineByDealId] = useState<Record<string, BuybackFinanceLine>>({});
  const [warehouseNameById, setWarehouseNameById] = useState<Record<string, string>>({});
  const [draftFilters, setDraftFilters] = useState<ListFilters>({
    realization_status: "",
    deal_type: "",
    created_by_uuid: "",
    created_from: "",
    created_to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<ListFilters>({
    realization_status: "",
    deal_type: "",
    created_by_uuid: "",
    created_from: "",
    created_to: "",
  });

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/skupka/deals?limit=500`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`load deals failed: ${resp.status} ${body}`);
        }
        setItems((await resp.json()) as BuybackDeal[]);
      } catch (e: any) {
        setError(e?.message || "failed to load deals");
      }
    })();
  }, [base]);

  useEffect(() => {
    const targetDealId = String(searchParams.get("open_deal_id") || "").trim();
    if (!targetDealId) return;
    if (!items.some((item) => item.id === targetDealId)) return;
    setOpenDealId(targetDealId);
  }, [searchParams, items]);

  useEffect(() => {
    (async () => {
      setPrintFormsLoading(true);
      setPrintFormsError("");
      try {
        const resp = await fetch(`${base}/documents/print/forms?limit=500`, {
          cache: "no-store",
          headers: authHeaders(),
        });
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
  }, [base]);

  useEffect(() => {
    (async () => {
      try {
        const [linesResp, warehousesResp] = await Promise.all([
          fetch(`${base}/finance/finance/buyback-lines?limit=2000`, { cache: "no-store", headers: authHeaders() }),
          fetch(`${base}/warehouses/warehouses/accessible`, { cache: "no-store", headers: authHeaders() }),
        ]);
        if (linesResp.ok) {
          const lines = (await linesResp.json()) as BuybackFinanceLine[];
          const nextLineByDealId: Record<string, BuybackFinanceLine> = {};
          for (const line of lines || []) {
            const key = String(line.deal_uuid || "");
            if (!key || nextLineByDealId[key]) continue;
            nextLineByDealId[key] = line;
          }
          setLineByDealId(nextLineByDealId);
        }
        if (warehousesResp.ok) {
          const warehouses = (await warehousesResp.json()) as WarehouseOption[];
          const nextWarehouseMap: Record<string, string> = {};
          for (const row of warehouses || []) nextWarehouseMap[String(row.id)] = String(row.name || "");
          setWarehouseNameById(nextWarehouseMap);
        }
      } catch {
        // ignore
      }
    })();
  }, [base]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/skupka/deals/creators/options`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) return;
        setCreatorOptions((await resp.json()) as CreatorOption[]);
      } catch {
        // ignore
      }
    })();
  }, [base]);

  const fallbackCreatorUuids = useMemo(() => {
    return Array.from(new Set((items || []).map((x) => String(x.created_by_uuid || "").trim()).filter(Boolean))).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const fromTs = appliedFilters.created_from ? new Date(`${appliedFilters.created_from}T00:00:00`).getTime() : null;
    const toTs = appliedFilters.created_to ? new Date(`${appliedFilters.created_to}T23:59:59`).getTime() : null;
    return (items || []).filter((item) => {
      if (appliedFilters.realization_status && item.realization_status !== appliedFilters.realization_status) return false;
      if (appliedFilters.deal_type && item.deal_type !== appliedFilters.deal_type) return false;
      if (appliedFilters.created_by_uuid && String(item.created_by_uuid || "") !== appliedFilters.created_by_uuid) return false;
      const createdTs = new Date(item.created_at).getTime();
      if (fromTs !== null && createdTs < fromTs) return false;
      if (toTs !== null && createdTs > toTs) return false;
      return true;
    });
  }, [items, appliedFilters]);

  const renderTemplate = (html: string, ctx: Record<string, string>) => {
    const source = String(html || "");
    const ctxLower: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx)) ctxLower[normPrintPlaceholderKey(k)] = String(v ?? "");
    return source.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, keyRaw: string) => {
      const key = normPrintPlaceholderKey(String(keyRaw || ""));
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

  /** Проверка QZ: минимальный TSPL с текстом TEST (сырой «TEST» без команд этикетка не печатает). */
  const onPrintQzTestRaw = async () => {
    setError(null);
    try {
      await qzPrintRawHex(QZ_DEFAULT_PRINTER_NAME, htmlTo30x20TsplHex("<p style=\"font-size:24px\">ТЕСТ QZ</p><p>Русский текст</p>"));
    } catch (e: any) {
      setError(e?.message || "QZ TEST failed");
    }
  };

  const onPrintWithForm = async (deal: BuybackDeal, form: PrintFormListItem) => {
    setError(null);
    setPrintDropdownDealId(null);
    if (form.qz_enabled) {
      setQzBusyDealId(deal.id);
      try {
        const formResp = await fetchWithRetry(
          `${base}/documents/print/forms/${encodeURIComponent(form.id)}?_cb=${Date.now()}`,
          {
            cache: "no-store",
            headers: authHeaders(),
          }
        );
        if (!formResp.ok) {
          const body = await formResp.text().catch(() => "");
          throw new Error(`form load failed: ${formResp.status} ${body}`);
        }
        const fullForm = await formResp.json();
        const financeLine = lineByDealId[deal.id];
        const creator = creatorOptions.find((item) => item.user_uuid === String(deal.created_by_uuid || "").trim()) || null;
        const ctx: Record<string, string> = {
          deal_id: tsplText(deal.id, 64),
          deal_number: tsplText(deal.deal_number ?? "", 32),
          deal_type: tsplText(dealTypeLabel(deal.deal_type), 64),
          realization_status: tsplText(deal.realization_status || "Не реализован", 64),
          category_name: tsplText(deal.category_name || "-", 64),
          purchase_object_name: tsplText(deal.purchase_object_name || "-", 64),
          device_condition_names: tsplText((deal.device_condition_names || []).join(", "), 120),
          title: tsplText(deal.title || "-", 120),
          client_name: tsplText(deal.client_name || "-", 64),
          client_phone: tsplText(deal.client_phone || "-", 32),
          offered_amount: tsplText(String(deal.offered_amount ?? ""), 32),
          amount: tsplText(String(financeLine?.amount ?? deal.offered_amount ?? ""), 32),
          currency: tsplText(String(financeLine?.currency || deal.currency || "RUB"), 8),
          payment_method: tsplText(paymentMethodLabel(String(financeLine?.payment_method || "")), 32),
          warehouse_name: tsplText(warehouseNameById[String(deal.warehouse_id || "")] || "-", 64),
          comment: tsplText(deal.comment || "", 200),
          user_name: tsplText(creatorDisplayName(creator), 64),
          user_login: tsplText(String(creator?.username || creator?.email || deal.created_by_uuid || "-"), 64),
          created_at: tsplText(formatDateTime(deal.created_at), 64),
        };
        const tpl = String(fullForm?.content_html || "").trim();
        if (!tpl) {
          throw new Error(
            "QZ: в форме пустое тело печати. Открой форму в «Печать» → режим HTML, вставь TSPL и {{ deal_number }} и т.д., сохрани. Раньше при пустом теле подставлялась запасная этикетка — она отключена."
          );
        }
        const unknownPh = findUnknownPlaceholderKeys(tpl, ctx);
        if (unknownPh.length > 0) {
          const allowed = Object.keys(ctx).sort().join(", ");
          throw new Error(
            `QZ: в шаблоне неизвестные имена: ${unknownPh.join(", ")}. Для выкупа: ${allowed}. (Часто: {{ order_* }} — только для заказов; нужны deal_number, title, …)`
          );
        }
        const renderedRaw = renderTemplate(tpl, ctx);
        const rendered = htmlToPlainLinesForTspl(renderedRaw);
        if (!rendered.trim()) {
          throw new Error(
            "QZ: после очистки HTML шаблон пуст. В форме должны быть строки TSPL (не только пустые абзацы редактора)."
          );
        }
        const commands = looksLikeTspl(rendered)
          ? [ensureTsplPrintFooter(normalizeTsplPayload(rendered))]
          : null;
        if (commands) {
          await qzPrintRaw(QZ_DEFAULT_PRINTER_NAME, commands);
        } else {
          await qzPrintRawHex(QZ_DEFAULT_PRINTER_NAME, htmlTo30x20TsplHex(renderedRaw));
        }
      } catch (e: any) {
        setError(e?.message || "QZ print failed");
      } finally {
        setQzBusyDealId(null);
      }
      return;
    }
    const w = window.open("about:blank", "_blank");
    try {
      if (!w) throw new Error("popup blocked");
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Документ</title></head><body>Loading...</body></html>`);
      w.document.close();

      const formResp = await fetchWithRetry(
        `${base}/documents/print/forms/${encodeURIComponent(form.id)}?_cb=${Date.now()}`,
        {
          cache: "no-store",
          headers: authHeaders(),
        }
      );
      if (!formResp.ok) {
        const body = await formResp.text().catch(() => "");
        throw new Error(`form load failed: ${formResp.status} ${body}`);
      }

      const form = await formResp.json();
      const printTitle = String(form?.title || "Документ").trim() || "Документ";
      const widthMm = pageSizeMm(form?.page_width_mm, 200);
      const heightMm = pageSizeMm(form?.page_height_mm, 300);
      const marginMm = pageSizeMm(form?.page_margin_mm, 0);
      const autoHeight = Boolean(form?.page_auto_height);
      const transformCss = printTransformCss(form);
      const financeLine = lineByDealId[deal.id];
      const creator = creatorOptions.find((item) => item.user_uuid === String(deal.created_by_uuid || "").trim()) || null;
      const ctx: Record<string, string> = {
        deal_id: String(deal.id || ""),
        deal_number: String(deal.deal_number ?? ""),
        deal_type: dealTypeLabel(deal.deal_type),
        realization_status: String(deal.realization_status || "Не реализован"),
        category_name: String(deal.category_name || "-"),
        purchase_object_name: String(deal.purchase_object_name || "-"),
        device_condition_names: (deal.device_condition_names || []).join(", "),
        title: String(deal.title || "-"),
        client_name: String(deal.client_name || "-"),
        client_phone: String(deal.client_phone || "-"),
        offered_amount: String(deal.offered_amount ?? ""),
        amount: String(financeLine?.amount ?? deal.offered_amount ?? ""),
        currency: String(financeLine?.currency || deal.currency || "RUB"),
        payment_method: paymentMethodLabel(String(financeLine?.payment_method || "")),
        warehouse_name: String(warehouseNameById[String(deal.warehouse_id || "")] || "-"),
        comment: String(deal.comment || ""),
        user_name: creatorDisplayName(creator),
        user_login: String(creator?.username || creator?.email || deal.created_by_uuid || "-"),
        created_at: formatDateTime(deal.created_at),
      };

      const html = renderTemplate(String(form?.content_html || ""), ctx);
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${printTitle}</title>
        <style>
          @page{size:${widthMm}mm ${heightMm}mm;margin:${marginMm}mm;}
          html,body{width:${widthMm}mm;margin:0;padding:0;}
          body{font-family:Arial, sans-serif;margin:0;padding:0;}
          .print-root{width:100%;margin:0;padding:0;${transformCss}}
          .print-root table{width:100% !important;table-layout:fixed !important;border-collapse:collapse !important;}
          .print-root td,.print-root th{overflow:hidden;vertical-align:top;word-break:break-word;}
          .print-root img{display:block;max-width:100%;height:auto;}
          @media print{html,body{width:${widthMm}mm;margin:0 !important;padding:0 !important;}.print-root{width:100%;margin:0 !important;padding:0 !important;}}
          @media screen{html,body,.print-root{width:${widthMm}mm;${autoHeight ? "" : `min-height:${heightMm}mm;`}}}
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

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список выкупов</h3>
        <div className="mb-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
            <select
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.realization_status}
              onChange={(e) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  realization_status: (e.target.value as any) || "",
                }))
              }
            >
              <option value="">Реализация: Все</option>
              <option value="Не реализован">Не реализован</option>
              <option value="Реализован">Реализован</option>
            </select>
            <select
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={draftFilters.deal_type}
              onChange={(e) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  deal_type: (e.target.value as any) || "",
                }))
              }
            >
              <option value="">Тип сделки: Все</option>
              <option value="parts">На запчасти</option>
              <option value="resale">На перепродажу</option>
            </select>
            <DatePicker
              id="skupka-list-date-range"
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
              value={draftFilters.created_by_uuid}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, created_by_uuid: e.target.value }))}
            >
              <option value="">Создатель сделки: Все</option>
              {creatorOptions.length
                ? creatorOptions.map((u) => (
                    <option key={u.user_uuid} value={u.user_uuid}>
                      {u.full_name || u.username || u.email || u.user_uuid}
                    </option>
                  ))
                : fallbackCreatorUuids.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
            </select>
            <Button
              size="sm"
              onClick={() =>
                setAppliedFilters({
                  realization_status: draftFilters.realization_status,
                  deal_type: draftFilters.deal_type,
                  created_by_uuid: draftFilters.created_by_uuid,
                  created_from: draftFilters.created_from,
                  created_to: draftFilters.created_to,
                })
              }
            >
              Отфильтровать
            </Button>
          </div>
        </div>
        {error ? <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div> : null}
        {!filteredItems.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Выкупов пока нет.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Номер выкупа
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Тип сделки
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Реализация
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Дата создания
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                      Сумма
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {filteredItems.map((item) => (
                    <React.Fragment key={item.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                        onClick={() => setOpenDealId((prev) => (prev === item.id ? null : item.id))}
                      >
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                          {item.deal_number ?? "-"}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">
                          {dealTypeLabel(item.deal_type) || "-"}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">
                          {item.realization_status || "Не реализован"}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">
                          {item.offered_amount} {item.currency}
                        </td>
                      </tr>
                      {openDealId === item.id ? (
                        <tr>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300" colSpan={5}>
                            <div className="space-y-2">
                              <div>Название: {item.title || "-"}</div>
                              <div>Тип сделки: {dealTypeLabel(item.deal_type)}</div>
                              <div>Реализация: {item.realization_status || "Не реализован"}</div>
                              <div>Категория: {item.category_name || "Без категории"}</div>
                              <div>Объект: {item.purchase_object_name || "Без объекта"}</div>
                              <div>
                                Состояние устройства: {(item.device_condition_names || []).length ? (item.device_condition_names || []).join(", ") : "-"}
                              </div>
                              <div>Клиент: {item.client_name || "-"}{item.client_phone ? ` | ${item.client_phone}` : ""}</div>
                              {item.comment ? <div>Комментарий: {item.comment}</div> : null}
                              <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Печать</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="relative inline-block">
                                    <button
                                      className="dropdown-toggle inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                      onClick={() => setPrintDropdownDealId((prev) => (prev === item.id ? null : item.id))}
                                    >
                                      Выбрать форму
                                      <ChevronDownIcon className="w-4 h-4" />
                                    </button>
                                    <Dropdown
                                      isOpen={printDropdownDealId === item.id}
                                      onClose={() => setPrintDropdownDealId(null)}
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
                                                    onClick={() => void onPrintWithForm(item, f)}
                                                    className="flex w-full items-center justify-between gap-2 rounded-lg text-left font-normal text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-100"
                                                    onItemClick={() => setPrintDropdownDealId(null)}
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
                                  <button
                                    type="button"
                                    className="inline-flex items-center rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm font-mono text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                    onClick={() => void onPrintQzTestRaw()}
                                    title="QZ: TSPL 30×20 мм, текст «30x20 TEST» (forceRaw)"
                                  >
                                    TEST
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
