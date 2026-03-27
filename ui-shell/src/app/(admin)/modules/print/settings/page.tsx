"use client";

import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type PrintCategory = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function PrintSettingsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<PrintCategory[]>([]);
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
    const resp = await fetch(`${base}/documents/print/categories?limit=500`, { cache: "no-store", headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`categories load failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as PrintCategory[]);
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
  }, []);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/documents/print/categories`, {
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

  const onStartEdit = (c: PrintCategory) => {
    setEditingId(c.id);
    setEditingName(c.name);
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
      const resp = await fetch(`${base}/documents/print/categories/${encodeURIComponent(editingId)}`, {
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
    if (!window.confirm("Удалить категорию?")) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/documents/print/categories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`delete failed: ${resp.status} ${body}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Печать</h3>
      <div className="text-sm text-gray-600 dark:text-white/70 mb-6">Настройки</div>

      {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Категории</h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-6">
          <div className="md:col-span-2">
            <Label>Название</Label>
            <Input value={newName} onChange={(e: any) => setNewName(e.target.value)} placeholder="Например: Часы" />
          </div>
          <div className="flex items-end">
            <Button size="sm" disabled={busy} onClick={onCreate} className="w-full">
              Добавить
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {items.map((c) => {
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className="rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex-1">
                    {isEditing ? (
                      <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                    ) : (
                      <div className="text-sm font-medium text-gray-800 dark:text-white/90">{c.name}</div>
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.id}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <Button size="sm" disabled={busy} onClick={onSaveEdit}>
                          Сохранить
                        </Button>
                        <button
                          className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                          onClick={onCancelEdit}
                          disabled={busy}
                        >
                          Отмена
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                          onClick={() => onStartEdit(c)}
                          disabled={busy}
                        >
                          Редактировать
                        </button>
                        <button
                          className="rounded-lg border border-red-200 px-3 py-1 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-900/20"
                          onClick={() => void onDelete(c.id)}
                          disabled={busy}
                        >
                          Удалить
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {!items.length && <div className="text-sm text-gray-600 dark:text-white/70">Категорий пока нет.</div>}
        </div>
      </div>
    </div>
  );
}

