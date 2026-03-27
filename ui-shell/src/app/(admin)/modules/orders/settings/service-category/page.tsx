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
  created_at: string;
};

type UserLite = {
  user_uuid: string;
  username: string;
  email: string;
  full_name: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
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

function isSuperadminToken(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload) return false;
  const realmRoles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
  if (realmRoles.includes("superadmin")) return true;
  const resourceAccess = payload?.resource_access || {};
  return Object.values(resourceAccess).some((obj: any) => Array.isArray(obj?.roles) && obj.roles.includes("superadmin"));
}

export default function OrdersSettingsServiceCategoryPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [name, setName] = useState("");
  const [items, setItems] = useState<ServiceCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [accessQuery, setAccessQuery] = useState("");
  const [accessUsers, setAccessUsers] = useState<UserLite[]>([]);
  const [selectedAccessUser, setSelectedAccessUser] = useState<UserLite | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Record<string, boolean>>({});
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/orders/settings/service-categories`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as ServiceCategory[]);
  };

  useEffect(() => {
    const token = getToken();
    setIsSuperadmin(isSuperadminToken(token));
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load categories");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSuperadmin) return;
    setAccessMessage(null);
    setError(null);
    if (accessQuery.trim().length < 2) {
      setAccessUsers([]);
      return;
    }
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const resp = await fetch(
            `${base}/orders/settings/service-categories/access/users/search?q=${encodeURIComponent(accessQuery.trim())}`,
            {
              cache: "no-store",
              headers: authHeaders(),
            }
          );
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`users search failed: ${resp.status} ${body}`);
          }
          setAccessUsers((await resp.json()) as UserLite[]);
        } catch (e: any) {
          setError(e?.message || "users search failed");
          setAccessUsers([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessQuery, isSuperadmin]);

  const onPickAccessUser = async (user: UserLite) => {
    setSelectedAccessUser(user);
    setAccessUsers([]);
    setAccessQuery(user.email || user.username || user.full_name);
    setAccessMessage(null);
    setError(null);
    try {
      const resp = await fetch(
        `${base}/orders/settings/service-categories/access/users/${encodeURIComponent(user.user_uuid)}`,
        {
          cache: "no-store",
          headers: authHeaders(),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`load access failed: ${resp.status} ${body}`);
      }
      const data = (await resp.json()) as { category_ids: string[] };
      const next: Record<string, boolean> = {};
      for (const id of data.category_ids || []) next[id] = true;
      setSelectedCategoryIds(next);
    } catch (e: any) {
      setError(e?.message || "failed to load category access");
      setSelectedCategoryIds({});
    }
  };

  const onToggleCategoryAccess = (id: string) => {
    setSelectedCategoryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const onSaveCategoryAccess = async () => {
    if (!selectedAccessUser) return;
    setAccessBusy(true);
    setAccessMessage(null);
    setError(null);
    try {
      const categoryIds = Object.keys(selectedCategoryIds).filter((id) => selectedCategoryIds[id]);
      const resp = await fetch(
        `${base}/orders/settings/service-categories/access/users/${encodeURIComponent(selectedAccessUser.user_uuid)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ category_ids: categoryIds }),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`save access failed: ${resp.status} ${body}`);
      }
      setAccessMessage("Права по категориям сохранены");
    } catch (e: any) {
      setError(e?.message || "failed to save category access");
    } finally {
      setAccessBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load categories");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccessUser?.user_uuid]);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/settings/service-categories`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setName("");
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to create category");
    } finally {
      setBusy(false);
    }
  };

  const onStartEdit = (item: ServiceCategory) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/settings/service-categories/${editingId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ name: editingName }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`update failed: ${resp.status} ${body}`);
      }
      onCancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to update category");
    } finally {
      setActionBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/orders/settings/service-categories/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`delete failed: ${resp.status} ${body}`);
      }
      if (editingId === id) onCancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to delete category");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Новая категория услуги</h3>
        <div className="space-y-4">
          <div>
            <Label>Название</Label>
            <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Например: Диагностика" />
          </div>
          <Button size="sm" disabled={busy} onClick={onCreate}>
            Добавить
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Созданные категории</h3>
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
                  <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                ) : (
                  <span className="text-sm text-gray-800 dark:text-white/90">{item.name}</span>
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

      {isSuperadmin && (
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">
            Права доступа к категориям
          </h3>
          {accessMessage && <div className="text-sm text-green-600 mb-3">{accessMessage}</div>}
          <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-4 mb-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Пользователь (поиск по email/username)
            </div>
            <input
              className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-700"
              value={accessQuery}
              onChange={(e) => setAccessQuery(e.target.value)}
              placeholder="Введите минимум 2 символа"
            />
            {!!accessUsers.length && (
              <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 max-h-56 overflow-y-auto">
                {accessUsers.map((u) => (
                  <button
                    key={u.user_uuid}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                    onClick={() => void onPickAccessUser(u)}
                  >
                    {u.full_name} {u.email ? `(${u.email})` : ""} [{u.user_uuid}]
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedAccessUser && (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-4">
              <div className="text-sm mb-3 text-gray-700 dark:text-gray-300">
                Выбран пользователь: {selectedAccessUser.full_name} ({selectedAccessUser.user_uuid})
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {items.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-white/90">
                    <input
                      type="checkbox"
                      checked={!!selectedCategoryIds[item.id]}
                      onChange={() => onToggleCategoryAccess(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>

              <div className="mt-4">
                <Button size="sm" disabled={accessBusy} onClick={onSaveCategoryAccess}>
                  Сохранить права
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
