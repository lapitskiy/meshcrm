"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type Warehouse = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function WarehousesListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<Warehouse[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string>("");
  const [editingName, setEditingName] = useState<string>("");

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/warehouses/warehouses`, { cache: "no-store", headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`warehouses load failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as Warehouse[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load warehouses");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/warehouses/warehouses`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: newName }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setNewName("");
      await load();
    } catch (e: any) {
      setError(e?.message || "create failed");
    } finally {
      setBusy(false);
    }
  };

  const onStartEdit = (w: Warehouse) => {
    setEditingId(w.id);
    setEditingName(w.name);
  };

  const onCancelEdit = () => {
    setEditingId("");
    setEditingName("");
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/warehouses/warehouses/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editingName }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`update failed: ${resp.status} ${body}`);
      }
      onCancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "update failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/warehouses/warehouses/${encodeURIComponent(id)}`, {
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
      setError(e?.message || "delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Склады</h3>

        {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}

        <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4 mb-6">
          <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Добавить склад</h4>
          <div className="space-y-3">
            <div>
              <Label>Название</Label>
              <Input value={newName} onChange={(e: any) => setNewName(e.target.value)} placeholder="Например: Склад №1" />
            </div>
            <Button size="sm" disabled={busy || !newName.trim()} onClick={onCreate}>
              Добавить
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
          <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Список складов</h4>
          {!items.length ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Пока нет складов.</div>
          ) : (
            <div className="space-y-2">
              {items.map((w) => (
                <div
                  key={w.id}
                  className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
                >
                  <div className="flex-1">
                    {editingId === w.id ? (
                      <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                    ) : (
                      <div className="text-sm text-gray-800 dark:text-white/90">{w.name}</div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {editingId === w.id ? (
                      <>
                        <Button size="sm" disabled={busy || !editingName.trim()} onClick={onSaveEdit}>
                          Сохранить
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={onCancelEdit}>
                          Отмена
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onStartEdit(w)}>
                        Редактировать
                      </Button>
                    )}
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void onDelete(w.id)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

