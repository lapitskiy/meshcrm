"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";

type ProblemReminderItem = {
  order_id: string;
  order_number: number | null;
  serial_model: string;
  problem_since: string;
  days_overdue: number;
};

type SupplyReminderItem = {
  supply_request_id: string;
  order_id: string;
  order_number: number | null;
  serial_model: string;
  created_at: string;
  days_overdue: number;
};

type CallbackReminderItem = {
  id: string;
  order_id: string;
  order_number: number | null;
  serial_model: string;
  callback_date: string;
};

type ReminderItem =
  | {
      kind: "problem";
      id: string;
      order_id: string;
      order_number: number | null;
      serial_model: string;
      created_at: string;
      days_overdue: number;
    }
  | {
      kind: "supply";
      id: string;
      order_id: string;
      order_number: number | null;
      serial_model: string;
      created_at: string;
      days_overdue: number;
    }
  | {
      kind: "callback";
      id: string;
      order_id: string;
      order_number: number | null;
      serial_model: string;
      created_at: string;
      days_overdue: number;
    };

export default function NotificationDropdown() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [hasSeen, setHasSeen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<ReminderItem[]>([]);

  const getToken = useCallback((): string => {
    const raw = (window as any).__hubcrmAccessToken;
    if (!raw) return "";
    const token = String(raw).trim();
    if (!token || token === "undefined" || token === "null") return "";
    return token;
  }, []);

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
        // Keep empty token; request may fail with 401.
      }
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const loadReminders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await authHeaders();
      const [problemResp, supplyResp, callbackResp] = await Promise.all([
        fetch(`${base}/orders/orders/problem-reminders?limit=20`, {
          cache: "no-store",
          headers,
        }),
        fetch(`${base}/orders/supply/reminders?limit=20`, {
          cache: "no-store",
          headers,
        }),
        fetch(`${base}/orders/orders/callback-reminders/due?limit=20`, {
          cache: "no-store",
          headers,
        }),
      ]);
      if (!problemResp.ok) {
        const body = await problemResp.text().catch(() => "");
        throw new Error(`Не удалось загрузить напоминания по заказам: ${problemResp.status} ${body}`);
      }
      if (!supplyResp.ok) {
        const body = await supplyResp.text().catch(() => "");
        throw new Error(`Не удалось загрузить напоминания по снабжению: ${supplyResp.status} ${body}`);
      }
      if (!callbackResp.ok) {
        const body = await callbackResp.text().catch(() => "");
        throw new Error(`Не удалось загрузить напоминания по звонкам: ${callbackResp.status} ${body}`);
      }
      const problemPayload = (await problemResp.json()) as ProblemReminderItem[];
      const supplyPayload = (await supplyResp.json()) as SupplyReminderItem[];
      const callbackPayload = (await callbackResp.json()) as CallbackReminderItem[];
      const nextItems: ReminderItem[] = [
        ...(Array.isArray(problemPayload)
          ? problemPayload.map((item) => ({
              kind: "problem" as const,
              id: item.order_id,
              order_id: item.order_id,
              order_number: item.order_number,
              serial_model: item.serial_model,
              created_at: item.problem_since,
              days_overdue: item.days_overdue,
            }))
          : []),
        ...(Array.isArray(supplyPayload)
          ? supplyPayload.map((item) => ({
              kind: "supply" as const,
              id: item.supply_request_id,
              order_id: item.order_id,
              order_number: item.order_number,
              serial_model: item.serial_model,
              created_at: item.created_at,
              days_overdue: item.days_overdue,
            }))
          : []),
        ...(Array.isArray(callbackPayload)
          ? callbackPayload.map((item) => ({
              kind: "callback" as const,
              id: item.id,
              order_id: item.order_id,
              order_number: item.order_number,
              serial_model: item.serial_model,
              created_at: item.callback_date,
              days_overdue: Math.max(0, Math.floor((Date.now() - new Date(`${item.callback_date}T00:00:00`).getTime()) / 86400000)),
            }))
          : []),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      setItems(nextItems);
    } catch (e: any) {
      setItems([]);
      setError(e?.message || "Не удалось загрузить напоминания.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, base]);

  useEffect(() => {
    void loadReminders();
    const timer = window.setInterval(() => {
      void loadReminders();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loadReminders]);

  function toggleDropdown() {
    setIsOpen(!isOpen);
  }

  function closeDropdown() {
    setIsOpen(false);
  }

  const handleClick = () => {
    toggleDropdown();
    setHasSeen(true);
  };

  const notifying = items.length > 0 && !hasSeen;

  const formatDays = (days: number) => {
    if (days % 10 === 1 && days % 100 !== 11) return `${days} день`;
    if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) return `${days} дня`;
    return `${days} дней`;
  };

  const buildHref = (item: ReminderItem) => {
    const query = String(item.order_number ?? "").trim() || item.serial_model || "";
    if (item.kind === "supply") {
      return `/modules/orders/supply/list?search=${encodeURIComponent(query)}&open_supply_id=${encodeURIComponent(item.id)}`;
    }
    if (item.kind === "callback") {
      return `/modules/orders/list?order_ids=${encodeURIComponent(item.order_id)}&open_order_id=${encodeURIComponent(item.order_id)}`;
    }
    return `/modules/orders/list?search=${encodeURIComponent(query)}&open_order_id=${encodeURIComponent(item.order_id)}`;
  };

  return (
    <div className="relative">
      <button
        className="relative dropdown-toggle flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={handleClick}
      >
        <span
          className={`absolute right-0 top-0.5 z-10 h-2 w-2 rounded-full bg-orange-400 ${
            !notifying ? "hidden" : "flex"
          }`}
        >
          <span className="absolute inline-flex w-full h-full bg-orange-400 rounded-full opacity-75 animate-ping"></span>
        </span>
        <svg
          className="fill-current"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H4.37504H15.625H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute -right-[240px] mt-[17px] flex h-[480px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark sm:w-[361px] lg:right-0"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-gray-700">
          <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Напоминания
          </h5>
          <button
            onClick={toggleDropdown}
            className="text-gray-500 transition dropdown-toggle dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg
              className="fill-current"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col h-auto overflow-y-auto custom-scrollbar">
          {loading ? (
            <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Загрузка...</li>
          ) : error ? (
            <li className="px-4 py-3 text-sm text-red-600">{error}</li>
          ) : !items.length ? (
            <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              Просроченных напоминаний нет.
            </li>
          ) : (
            items.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <DropdownItem
                  tag="a"
                  href={buildHref(item)}
                  onItemClick={closeDropdown}
                  className="flex gap-3 rounded-lg border-b border-gray-100 p-3 px-4.5 py-3 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                    !
                  </span>
                  <span className="block min-w-0">
                    <span className="mb-1.5 block text-theme-sm text-gray-500 dark:text-gray-400">
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {item.kind === "supply"
                          ? item.order_number
                            ? `Снабжение по заказу #${item.order_number}`
                            : "Заявка снабжения"
                          : item.kind === "callback"
                          ? item.order_number
                            ? `Отзвон по заказу #${item.order_number}`
                            : "Отзвон по заказу"
                          : item.order_number
                          ? `Заказ #${item.order_number}`
                          : "Заказ без номера"}
                      </span>
                      <span>{item.kind === "supply" ? " не закрыта уже " : item.kind === "callback" ? " просрочен на " : " требует внимания уже "}</span>
                      <span className="font-medium text-red-700 dark:text-red-300">{formatDays(item.days_overdue)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
                      <span>{item.serial_model || "Без модели"}</span>
                      <span className="h-1 w-1 rounded-full bg-gray-400"></span>
                      <span>c {new Date(item.created_at).toLocaleDateString("ru-RU")}</span>
                    </span>
                  </span>
                </DropdownItem>
              </li>
            ))
          )}
        </ul>
      </Dropdown>
    </div>
  );
}
