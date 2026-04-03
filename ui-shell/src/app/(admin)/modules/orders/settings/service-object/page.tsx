"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type ServiceCategory = {
  id: string;
  name: string;
};

type ServiceObject = {
  id: string;
  service_category_id: string;
  service_category_name: string;
  name: string;
  created_at: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function OrdersSettingsServiceObjectPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [items, setItems] = useState<ServiceObject[]>([]);

  const [newCategoryId, setNewCategoryId] = useState("");
  const [newName, setNewName] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");

  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadCategories = async () => {
    const token = getToken();
    const payload = parseJwtPayload(token);
    const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
    const useAllCategories = roles.includes("superadmin");
    setIsSuperadmin(useAllCategories);
    const resp = await fetch(`${base}/orders/settings/service-categories${useAllCategories ? "" : "/accessible"}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load categories failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as ServiceCategory[];
    setCategories(data);
    if (!newCategoryId && data.length) setNewCategoryId(data[0].id);
    if (newCategoryId && !data.some((item) => item.id === newCategoryId)) {
      setNewCategoryId(data[0]?.id || "");
    }
    if (filterCategoryId && !data.some((item) => item.id === filterCategoryId)) {
      setFilterCategoryId("");
    }
  };

  const loadServiceObjects = async (categoryId: string) => {
    const qs = categoryId ? `?service_category_id=${encodeURIComponent(categoryId)}` : "";
    const resp = await fetch(`${base}/orders/settings/service-objects${qs}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load objects failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as ServiceObject[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await loadCategories();
        await loadServiceObjects("");
      } catch (e: any) {
        setError(e?.message || "failed to load data");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadServiceObjects(filterCategoryId);
      } catch (e: any) {
        setError(e?.message || "failed to load objects");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategoryId]);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/settings/service-objects`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ service_category_id: newCategoryId, name: newName }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setNewName("");
      await loadServiceObjects(filterCategoryId);
    } catch (e: any) {
      setError(e?.message || "failed to create object");
    } finally {
      setBusy(false);
    }
  };

  const onStartEdit = (item: ServiceObject) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingCategoryId(item.service_category_id);
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
    setEditingCategoryId("");
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/settings/service-objects/${editingId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ service_category_id: editingCategoryId, name: editingName }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`update failed: ${resp.status} ${body}`);
      }
      onCancelEdit();
      await loadServiceObjects(filterCategoryId);
    } catch (e: any) {
      setError(e?.message || "failed to update object");
    } finally {
      setActionBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/settings/service-objects/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`delete failed: ${resp.status} ${body}`);
      }
      if (editingId === id) onCancelEdit();
      await loadServiceObjects(filterCategoryId);
    } catch (e: any) {
      setError(e?.message || "failed to delete object");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Новый объект ремонта</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Категория услуги</Label>
            <select
              className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              disabled={!categories.length}
            >
              {!categories.length && <option value="">Нет категорий</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Объект ремонта</Label>
            <Input value={newName} onChange={(e: any) => setNewName(e.target.value)} placeholder="Например: iPhone 12" />
          </div>
        </div>
        <div className="mt-4">
          <Button size="sm" disabled={busy || !newCategoryId} onClick={onCreate}>
            Добавить
          </Button>
        </div>
        {!isSuperadmin && !categories.length ? (
          <div className="mt-3 text-sm text-red-600">
            Нет доступа ни к одной из категорий услуг, обратитесь к администратору.
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список объектов ремонта</h3>
          <div className="min-w-[260px]">
            <Label>Фильтр по категории</Label>
            <select
              className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
            >
              <option value="">Все категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}
        {!items.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Список пуст.</div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 justify-between rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
              >
                {editingId === item.id ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                    <select
                      className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                      value={editingCategoryId}
                      onChange={(e) => setEditingCategoryId(e.target.value)}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-800 dark:text-white/90">{item.name}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{item.service_category_name}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {editingId === item.id ? (
                    <>
                      <Button size="sm" disabled={actionBusy} onClick={onSaveEdit}>
                        Сохранить
                      </Button>
                      <Button size="sm" variant="outline" disabled={actionBusy} onClick={onCancelEdit}>
                        Отмена
                      </Button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                      disabled={actionBusy}
                      onClick={() => onStartEdit(item)}
                      title="Редактировать"
                    >
                      <PencilIcon className="size-5" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-red-600 hover:text-red-700 dark:text-red-400"
                    disabled={actionBusy}
                    onClick={() => onDelete(item.id)}
                    title="Удалить"
                  >
                    <TrashBinIcon className="size-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
