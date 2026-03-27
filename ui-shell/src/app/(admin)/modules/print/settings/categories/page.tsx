"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
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

export default function PrintCategoriesSettingsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [name, setName] = useState("");
  const [items, setItems] = useState<PrintCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/documents/print/categories`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load failed: ${resp.status} ${body}`);
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
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Название категории обязательно");
      const resp = await fetch(`${base}/documents/print/categories`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: cleanName }),
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

  const onStartEdit = (item: PrintCategory) => {
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
      const cleanName = editingName.trim();
      if (!cleanName) throw new Error("Название категории обязательно");
      const resp = await fetch(`${base}/documents/print/categories/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: cleanName }),
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
    if (!window.confirm("Удалить категорию?")) return;
    setActionBusy(true);
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
      if (editingId === id) onCancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to delete category");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="p-6">
      <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Печать</h3>
      <div className="text-sm text-gray-600 dark:text-white/70 mb-6">Настройки → Категории</div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Категории печати</h3>
        {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}

        <div className="space-y-4 mb-6">
          <div>
            <Label>Название категории</Label>
            <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Например: Акт" />
          </div>
          <Button size="sm" disabled={busy} onClick={onCreate}>
            Добавить категорию
          </Button>
        </div>

        {!items.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Список категорий пуст.</div>
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
                    onClick={() => void onDelete(item.id)}
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
