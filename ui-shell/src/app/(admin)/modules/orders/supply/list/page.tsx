"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDownIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";

type SupplyRequestItem = {
  id: string;
  order_id: string;
  order_number: number | null;
  order_status: string;
  order_serial_model: string;
  service_category_id: string;
  service_category_name: string;
  request_text: string;
  display_status?: string | null;
  photos_count: number;
  preview_photo_data_url: string | null;
  created_by_uuid: string | null;
  created_by_name: string;
  created_at: string;
};

type SupplyRequestListResponse = {
  items: SupplyRequestItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type SupplyRequestStatusHistoryItem = {
  status: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  changed_at: string;
};

type SupplyRequestPhotoItem = {
  id: string;
  mime_type: string;
  data_url: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type SupplyRequestCommentItem = {
  id: string;
  comment: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type SupplyFeedItem =
  | {
      kind: "status";
      id: string;
      title: string;
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

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
}

export default function OrdersSupplyListPage() {
  const searchParams = useSearchParams();
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const initialSearch = String(searchParams.get("search") || "").trim();
  const initialOpenSupplyId = String(searchParams.get("open_supply_id") || "").trim();
  const [items, setItems] = useState<SupplyRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [openItemId, setOpenItemId] = useState<string | null>(initialOpenSupplyId || null);
  const [statusHistoryByItem, setStatusHistoryByItem] = useState<Record<string, SupplyRequestStatusHistoryItem[]>>({});
  const [statusHistoryLoadingByItem, setStatusHistoryLoadingByItem] = useState<Record<string, boolean>>({});
  const [statusHistoryErrorByItem, setStatusHistoryErrorByItem] = useState<Record<string, string>>({});
  const [photosByItem, setPhotosByItem] = useState<Record<string, SupplyRequestPhotoItem[]>>({});
  const [photosLoadingByItem, setPhotosLoadingByItem] = useState<Record<string, boolean>>({});
  const [photosErrorByItem, setPhotosErrorByItem] = useState<Record<string, string>>({});
  const [commentsByItem, setCommentsByItem] = useState<Record<string, SupplyRequestCommentItem[]>>({});
  const [commentsLoadingByItem, setCommentsLoadingByItem] = useState<Record<string, boolean>>({});
  const [commentsErrorByItem, setCommentsErrorByItem] = useState<Record<string, string>>({});
  const [commentDraftOpenByItem, setCommentDraftOpenByItem] = useState<Record<string, boolean>>({});
  const [commentDraftTextByItem, setCommentDraftTextByItem] = useState<Record<string, string>>({});
  const [commentSavingByItem, setCommentSavingByItem] = useState<Record<string, boolean>>({});
  const [confirmCloseByItem, setConfirmCloseByItem] = useState<Record<string, boolean>>({});
  const [statusSavingByItem, setStatusSavingByItem] = useState<Record<string, boolean>>({});
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

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
        // Keep empty token; error will be shown from API.
      }
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(
        `${base}/orders/supply?page=${encodeURIComponent(String(page))}&page_size=12&search=${encodeURIComponent(search.trim())}`,
        {
          cache: "no-store",
          headers: await authHeaders(),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Не удалось загрузить заявки: ${resp.status} ${body}`);
      }
      const payload = (await resp.json()) as SupplyRequestListResponse;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setTotal(Number(payload.total || 0));
      setTotalPages(Math.max(1, Number(payload.total_pages || 1)));
    } catch (e: any) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setError(e?.message || "Не удалось загрузить список заявок.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, base, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (openItemId && !items.some((item) => item.id === openItemId)) {
      setOpenItemId(null);
    }
  }, [items, openItemId]);

  useEffect(() => {
    if (initialOpenSupplyId && items.some((item) => item.id === initialOpenSupplyId)) {
      setOpenItemId(initialOpenSupplyId);
    }
  }, [initialOpenSupplyId, items]);

  const loadStatusHistory = useCallback(
    async (itemId: string, force = false) => {
      if (!force && statusHistoryByItem[itemId]) return;
      setStatusHistoryLoadingByItem((prev) => ({ ...prev, [itemId]: true }));
      setStatusHistoryErrorByItem((prev) => ({ ...prev, [itemId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/supply/${encodeURIComponent(itemId)}/status-history?limit=100`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить историю статусов: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as SupplyRequestStatusHistoryItem[];
        setStatusHistoryByItem((prev) => ({ ...prev, [itemId]: Array.isArray(payload) ? payload : [] }));
      } catch (e: any) {
        setStatusHistoryErrorByItem((prev) => ({ ...prev, [itemId]: e?.message || "Не удалось загрузить историю статусов." }));
      } finally {
        setStatusHistoryLoadingByItem((prev) => ({ ...prev, [itemId]: false }));
      }
    },
    [authHeaders, base, statusHistoryByItem]
  );

  const loadPhotos = useCallback(
    async (itemId: string) => {
      if (photosByItem[itemId]) return;
      setPhotosLoadingByItem((prev) => ({ ...prev, [itemId]: true }));
      setPhotosErrorByItem((prev) => ({ ...prev, [itemId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/supply/${encodeURIComponent(itemId)}/photos?limit=100`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить фото: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as SupplyRequestPhotoItem[];
        setPhotosByItem((prev) => ({ ...prev, [itemId]: Array.isArray(payload) ? payload : [] }));
      } catch (e: any) {
        setPhotosErrorByItem((prev) => ({ ...prev, [itemId]: e?.message || "Не удалось загрузить фото." }));
      } finally {
        setPhotosLoadingByItem((prev) => ({ ...prev, [itemId]: false }));
      }
    },
    [authHeaders, base, photosByItem]
  );

  const loadComments = useCallback(
    async (itemId: string) => {
      if (commentsByItem[itemId]) return;
      setCommentsLoadingByItem((prev) => ({ ...prev, [itemId]: true }));
      setCommentsErrorByItem((prev) => ({ ...prev, [itemId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/supply/${encodeURIComponent(itemId)}/comments?limit=100`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить комментарии: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as SupplyRequestCommentItem[];
        setCommentsByItem((prev) => ({ ...prev, [itemId]: Array.isArray(payload) ? payload : [] }));
      } catch (e: any) {
        setCommentsErrorByItem((prev) => ({ ...prev, [itemId]: e?.message || "Не удалось загрузить комментарии." }));
      } finally {
        setCommentsLoadingByItem((prev) => ({ ...prev, [itemId]: false }));
      }
    },
    [authHeaders, base, commentsByItem]
  );

  const buildFeedItems = useCallback(
    (itemId: string): SupplyFeedItem[] => {
      const statusItems: SupplyFeedItem[] = (statusHistoryByItem[itemId] || []).map((entry, index) => ({
        kind: "status",
        id: `status-${itemId}-${index}-${entry.changed_at}`,
        title: entry.status,
        created_at: entry.changed_at,
        created_by_name: entry.created_by_name,
      }));
      const commentItems: SupplyFeedItem[] = (commentsByItem[itemId] || []).map((entry) => ({
        kind: "comment",
        id: entry.id,
        title: entry.comment,
        created_at: entry.created_at,
        created_by_name: entry.created_by_name,
      }));
      const photoItems: SupplyFeedItem[] = (photosByItem[itemId] || []).map((entry) => ({
        kind: "photo",
        id: entry.id,
        title: "Фото заявки",
        image_url: entry.data_url,
        created_at: entry.created_at,
        created_by_name: entry.created_by_name,
      }));
      return [...statusItems, ...commentItems, ...photoItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    [commentsByItem, photosByItem, statusHistoryByItem]
  );

  const onToggleOpen = useCallback(
    (itemId: string) => {
      setOpenItemId((prev) => (prev === itemId ? null : itemId));
      if (openItemId !== itemId) {
        void loadStatusHistory(itemId);
        void loadPhotos(itemId);
        void loadComments(itemId);
      }
    },
    [loadComments, loadPhotos, loadStatusHistory, openItemId]
  );

  const onSetDisplayStatus = useCallback(
    async (itemId: string, nextDisplayStatus: string) => {
      setStatusSavingByItem((prev) => ({ ...prev, [itemId]: true }));
      setStatusHistoryErrorByItem((prev) => ({ ...prev, [itemId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/supply/${encodeURIComponent(itemId)}/display-status`, {
          method: "PUT",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            ...(await authHeaders()),
          },
          body: JSON.stringify({ display_status: nextDisplayStatus }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось обновить статус: ${resp.status} ${body}`);
        }
        const updated = (await resp.json()) as SupplyRequestItem;
        setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...updated } : item)));
        setConfirmCloseByItem((prev) => ({ ...prev, [itemId]: false }));
        void loadStatusHistory(itemId, true);
      } catch (e: any) {
        setStatusHistoryErrorByItem((prev) => ({ ...prev, [itemId]: e?.message || "Не удалось обновить статус." }));
      } finally {
        setStatusSavingByItem((prev) => ({ ...prev, [itemId]: false }));
      }
    },
    [authHeaders, base, loadStatusHistory]
  );

  const onStartComment = useCallback((itemId: string) => {
    setCommentDraftOpenByItem((prev) => ({ ...prev, [itemId]: true }));
    setCommentsErrorByItem((prev) => ({ ...prev, [itemId]: "" }));
  }, []);

  const onCancelComment = useCallback((itemId: string) => {
    setCommentDraftOpenByItem((prev) => ({ ...prev, [itemId]: false }));
    setCommentDraftTextByItem((prev) => ({ ...prev, [itemId]: "" }));
  }, []);

  const onSaveComment = useCallback(
    async (itemId: string) => {
      const comment = String(commentDraftTextByItem[itemId] || "").trim();
      if (!comment) {
        setCommentsErrorByItem((prev) => ({ ...prev, [itemId]: "Введите комментарий." }));
        return;
      }
      setCommentSavingByItem((prev) => ({ ...prev, [itemId]: true }));
      setCommentsErrorByItem((prev) => ({ ...prev, [itemId]: "" }));
      try {
        const resp = await fetch(`${base}/orders/supply/${encodeURIComponent(itemId)}/comments`, {
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
        const entry = (await resp.json()) as SupplyRequestCommentItem;
        setCommentsByItem((prev) => ({ ...prev, [itemId]: [entry, ...(prev[itemId] || [])] }));
        setCommentDraftTextByItem((prev) => ({ ...prev, [itemId]: "" }));
        setCommentDraftOpenByItem((prev) => ({ ...prev, [itemId]: false }));
      } catch (e: any) {
        setCommentsErrorByItem((prev) => ({ ...prev, [itemId]: e?.message || "Не удалось сохранить комментарий." }));
      } finally {
        setCommentSavingByItem((prev) => ({ ...prev, [itemId]: false }));
      }
    },
    [authHeaders, base, commentDraftTextByItem]
  );

  return (
    <div>
      <PageBreadcrumb pageTitle="Заказы · Снабжение · Список заявок" />

      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">Список заявок на снабжение</h1>
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Всего заявок: {total}</div>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Поиск по номеру заказа, категории или тексту"
              className="h-11 min-w-[320px] rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? "Обновляю..." : "Обновить"}
            </Button>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка заявок...</div>
        ) : items.length ? (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Заказ
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Категория
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Создал
                    </TableCell>
                    <TableCell isHeader className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      Дата
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {items.map((item) => {
                    const isOpen = openItemId === item.id;
                    const isClosed = String(item.display_status || "").trim() === "Закрыто";
                    const confirmClose = !!confirmCloseByItem[item.id];
                    const feedItems = buildFeedItems(item.id);
                    return (
                      <React.Fragment key={item.id}>
                        <tr
                          className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02] ${
                            isOpen ? "bg-gray-50 dark:bg-white/[0.06]" : ""
                          }`}
                          onClick={() => onToggleOpen(item.id)}
                        >
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-800 dark:text-white/90">
                            <div className="flex items-center gap-3">
                              <ChevronDownIcon
                                className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-medium">
                                    {item.order_number ? `Заказ #${item.order_number}` : "Заказ без номера"}
                                  </div>
                                  {item.display_status ? (
                                    <span
                                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                        isClosed
                                          ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                                          : "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                      }`}
                                    >
                                      {item.display_status}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  Статус заказа: {item.order_status || "Без статуса"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {item.service_category_name || "-"}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {item.created_by_name || item.created_by_uuid || "-"}
                          </td>
                          <td className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {formatDateTime(item.created_at)}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="bg-gray-50 dark:bg-white/[0.06]">
                            <td colSpan={4} className="px-5 py-4 text-start text-theme-sm text-gray-700 dark:text-gray-300">
                              <div className="space-y-4">
                                <div className="min-w-0 space-y-3">
                                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Детали заявки
                                  </div>
                                  <div>Серийный номер / модель: {item.order_serial_model || "-"}</div>
                                  <div className="whitespace-pre-wrap break-words">{item.request_text || "-"}</div>
                                  <div>
                                    <Link
                                      href={`/modules/orders/list?search=${encodeURIComponent(
                                        String(item.order_number || "")
                                      )}&open_order_id=${encodeURIComponent(item.order_id)}`}
                                      className="inline-flex items-center rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-200 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      Перейти к заказу
                                    </Link>
                                  </div>
                                </div>

                                <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setConfirmCloseByItem((prev) => ({ ...prev, [item.id]: true }));
                                      }}
                                      disabled={isClosed || !!statusSavingByItem[item.id]}
                                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                                        isClosed
                                          ? "border-green-300 bg-green-100 text-green-700 dark:border-green-500/40 dark:bg-green-500/15 dark:text-green-300"
                                          : "border-gray-300 text-gray-700 hover:bg-green-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-green-500/10"
                                      }`}
                                    >
                                      Выполнено
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onStartComment(item.id);
                                      }}
                                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                                        commentDraftOpenByItem[item.id]
                                          ? "border-gray-400 bg-gray-100 text-gray-800 dark:border-gray-500/40 dark:bg-white/10 dark:text-gray-100"
                                          : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                      }`}
                                    >
                                      Комментарий
                                    </button>
                                  </div>

                                  {confirmClose ? (
                                    <div className="mt-3 flex justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void onSetDisplayStatus(item.id, "Закрыто");
                                        }}
                                        disabled={!!statusSavingByItem[item.id]}
                                        className="rounded-lg border border-green-300 bg-green-100 px-3 py-1.5 text-sm text-green-700 dark:border-green-500/40 dark:bg-green-500/15 dark:text-green-300"
                                      >
                                        Да
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setConfirmCloseByItem((prev) => ({ ...prev, [item.id]: false }));
                                        }}
                                        disabled={!!statusSavingByItem[item.id]}
                                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200"
                                      >
                                        Нет
                                      </button>
                                    </div>
                                  ) : null}

                                  {commentDraftOpenByItem[item.id] ? (
                                    <div className="mt-3 flex justify-end">
                                      <div className="w-full max-w-xs rounded-lg border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-white/[0.03]">
                                        <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Комментарий</div>
                                        <textarea
                                          value={commentDraftTextByItem[item.id] || ""}
                                          onChange={(event) =>
                                            setCommentDraftTextByItem((prev) => ({ ...prev, [item.id]: event.target.value }))
                                          }
                                          placeholder="Введите комментарий"
                                          rows={3}
                                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                        />
                                        <div className="mt-2 space-y-2">
                                          {commentsErrorByItem[item.id] ? (
                                            <div className="text-sm text-red-600">Ошибка: {commentsErrorByItem[item.id]}</div>
                                          ) : null}
                                          <div className="flex justify-end gap-2">
                                            <button
                                              type="button"
                                              onClick={() => onCancelComment(item.id)}
                                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200"
                                            >
                                              Отмена
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => void onSaveComment(item.id)}
                                              disabled={!!commentSavingByItem[item.id]}
                                              className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-60 dark:border-gray-700 dark:bg-white/10 dark:text-gray-100"
                                            >
                                              Сохранить
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}

                                  {(statusHistoryLoadingByItem[item.id] ||
                                    commentsLoadingByItem[item.id] ||
                                    photosLoadingByItem[item.id] ||
                                    statusHistoryErrorByItem[item.id] ||
                                    (commentsErrorByItem[item.id] && !commentDraftOpenByItem[item.id]) ||
                                    photosErrorByItem[item.id] ||
                                    feedItems.length > 0) && (
                                    <div className="mt-4 flex justify-end">
                                      <div className="w-full max-w-xl space-y-2">
                                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Лента</div>
                                        {statusHistoryLoadingByItem[item.id] ||
                                        commentsLoadingByItem[item.id] ||
                                        photosLoadingByItem[item.id] ? (
                                          <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
                                        ) : statusHistoryErrorByItem[item.id] ? (
                                          <div className="text-sm text-red-600">Ошибка: {statusHistoryErrorByItem[item.id]}</div>
                                        ) : commentsErrorByItem[item.id] && !commentDraftOpenByItem[item.id] ? (
                                          <div className="text-sm text-red-600">Ошибка: {commentsErrorByItem[item.id]}</div>
                                        ) : photosErrorByItem[item.id] ? (
                                          <div className="text-sm text-red-600">Ошибка: {photosErrorByItem[item.id]}</div>
                                        ) : (
                                          <div className="space-y-2">
                                            {feedItems.map((entry) => (
                                              <div
                                                key={entry.id}
                                                className="rounded-lg border border-red-100 bg-white/80 px-3 py-2 dark:border-red-500/20 dark:bg-white/[0.03]"
                                              >
                                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                  {entry.kind === "photo" ? (
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
                                                  {entry.created_by_name ? <span>{entry.created_by_name}</span> : null}
                                                </div>
                                                {entry.kind === "photo" ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => setPreviewPhotoUrl(entry.image_url)}
                                                    className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                                                  >
                                                    <img
                                                      src={entry.image_url}
                                                      alt="Фото заявки"
                                                      className="h-[200px] w-[200px] object-cover"
                                                    />
                                                  </button>
                                                ) : (
                                                  <div className="mt-1 text-sm text-gray-800 dark:text-white/90">{entry.title}</div>
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
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Заявок пока нет.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Страница {page} из {totalPages}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1 || loading}>
              Назад
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages || loading}
            >
              Вперёд
            </Button>
          </div>
        </div>
      </div>

      <Modal isOpen={!!previewPhotoUrl} onClose={() => setPreviewPhotoUrl(null)} className="mx-4 max-w-5xl p-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">Фото заявки</div>
          {previewPhotoUrl ? (
            <img src={previewPhotoUrl} alt="Фото заявки" className="max-h-[80vh] w-full rounded-xl object-contain" />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
