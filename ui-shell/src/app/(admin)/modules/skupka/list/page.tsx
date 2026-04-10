"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
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
  updated_at: string;
};

type WarehouseOption = {
  id: string;
  name: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
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

  const onPrintWithForm = async (deal: BuybackDeal, formId: string) => {
    setError(null);
    setPrintDropdownDealId(null);
    const w = window.open("about:blank", "_blank");
    try {
      if (!w) throw new Error("popup blocked");
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Документ</title></head><body>Loading...</body></html>`);
      w.document.close();

      const formResp = await fetchWithRetry(`${base}/documents/print/forms/${encodeURIComponent(formId)}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!formResp.ok) {
        const body = await formResp.text().catch(() => "");
        throw new Error(`form load failed: ${formResp.status} ${body}`);
      }

      const form = await formResp.json();
      const printTitle = String(form?.title || "Документ").trim() || "Документ";
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
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${printTitle}</title></head><body>${html}</body></html>`);
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
                                                  onClick={() => void onPrintWithForm(item, f.id)}
                                                  className="flex w-full rounded-lg text-left font-normal text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-100"
                                                  onItemClick={() => setPrintDropdownDealId(null)}
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
