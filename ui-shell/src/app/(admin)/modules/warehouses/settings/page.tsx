"use client";

import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type Warehouse = {
  id: string;
  name: string;
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

export default function WarehousesSettingsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserLite[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserLite | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadWarehouses = async () => {
    const resp = await fetch(`${base}/warehouses/warehouses/admin/all`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`warehouses admin list failed: ${resp.status} ${body}`);
    }
    setWarehouses((await resp.json()) as Warehouse[]);
  };

  const loadUserAccess = async (userUuid: string) => {
    const resp = await fetch(`${base}/warehouses/warehouses/access/users/${encodeURIComponent(userUuid)}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`user access load failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as { warehouse_ids: string[] };
    const next: Record<string, boolean> = {};
    for (const id of data.warehouse_ids || []) next[id] = true;
    setSelectedIds(next);
  };

  useEffect(() => {
    (async () => {
      try {
        await loadWarehouses();
      } catch (e: any) {
        setError(e?.message || "failed to load warehouses");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOk(null);
    setError(null);
    if (query.trim().length < 2) {
      setUsers([]);
      return;
    }
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const resp = await fetch(
            `${base}/warehouses/warehouses/access/users/search?q=${encodeURIComponent(query.trim())}`,
            { cache: "no-store", headers: authHeaders() }
          );
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`users search failed: ${resp.status} ${body}`);
          }
          setUsers((await resp.json()) as UserLite[]);
        } catch (e: any) {
          setError(e?.message || "users search failed");
          setUsers([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const onPickUser = async (u: UserLite) => {
    setSelectedUser(u);
    setQuery(u.email || u.username || u.full_name);
    setUsers([]);
    setOk(null);
    setError(null);
    try {
      await loadUserAccess(u.user_uuid);
    } catch (e: any) {
      setError(e?.message || "failed to load user access");
      setSelectedIds({});
    }
  };

  const onToggleWarehouse = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const onSave = async () => {
    if (!selectedUser) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const warehouseIds = Object.keys(selectedIds).filter((id) => selectedIds[id]);
      const resp = await fetch(
        `${base}/warehouses/warehouses/access/users/${encodeURIComponent(selectedUser.user_uuid)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ warehouse_ids: warehouseIds, role }),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`save access failed: ${resp.status} ${body}`);
      }
      setOk("Права сохранены");
    } catch (e: any) {
      setError(e?.message || "save access failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Права доступа к складам</h3>

        {error && <div className="text-sm text-red-600 mb-3">Ошибка: {error}</div>}
        {ok && <div className="text-sm text-green-600 mb-3">{ok}</div>}

        <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-4 mb-4">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Пользователь (поиск по email/username)
          </div>
          <input
            className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-700"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Введите минимум 2 символа"
          />
          {!!users.length && (
            <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 max-h-56 overflow-y-auto">
              {users.map((u) => (
                <button
                  key={u.user_uuid}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => void onPickUser(u)}
                >
                  {u.full_name} {u.email ? `(${u.email})` : ""} [{u.user_uuid}]
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedUser && (
          <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-4">
            <div className="text-sm mb-3 text-gray-700 dark:text-gray-300">
              Выбран пользователь: {selectedUser.full_name} ({selectedUser.user_uuid})
            </div>

            <div className="mb-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 mr-2">Роль:</label>
              <select
                className="rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {warehouses.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-white/90">
                  <input type="checkbox" checked={!!selectedIds[w.id]} onChange={() => onToggleWarehouse(w.id)} />
                  <span>{w.name}</span>
                </label>
              ))}
            </div>

            <div className="mt-4">
              <Button size="sm" disabled={busy} onClick={onSave}>
                Сохранить права
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
