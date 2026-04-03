"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type StatusItem = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function moveItem<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}

export default function SkupkaSettingsStatusesPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<StatusItem[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("#3B82F6");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/skupka/settings/statuses`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as StatusItem[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load statuses");
      }
    })();
  }, [base]);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/skupka/settings/statuses`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name, color }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setName("");
      setColor("#3B82F6");
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to create status");
    } finally {
      setBusy(false);
    }
  };

  const onStartEdit = (item: StatusItem) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingColor(item.color);
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
    setEditingColor("#3B82F6");
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/skupka/settings/statuses/${editingId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editingName, color: editingColor }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`update failed: ${resp.status} ${body}`);
      }
      onCancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to update status");
    } finally {
      setActionBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/skupka/settings/statuses/${id}`, {
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
      setError(e?.message || "failed to delete status");
    } finally {
      setActionBusy(false);
    }
  };

  const persistOrder = async (ordered: StatusItem[]) => {
    const resp = await fetch(`${base}/skupka/settings/statuses/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ ids: ordered.map((item) => item.id) }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`reorder failed: ${resp.status} ${body}`);
    }
  };

  const onDropTo = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const fromIndex = items.findIndex((item) => item.id === draggingId);
    const toIndex = items.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = moveItem(items, fromIndex, toIndex);
    setItems(reordered);
    setDraggingId(null);
    setError(null);
    try {
      await persistOrder(reordered);
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to reorder statuses");
      await load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Новый статус</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Название статуса</Label>
            <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Например: Принят" />
          </div>
          <div>
            <Label>Цвет</Label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-300 px-2 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button size="sm" disabled={busy} onClick={onCreate}>Добавить</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список статусов</h3>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">Перетащите строку мышью, чтобы изменить порядок вывода.</div>
        {error ? <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div> : null}
        {!items.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Список пуст.</div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                draggable
                onDragStart={() => setDraggingId(item.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void onDropTo(item.id)}
                className="flex items-center gap-3 justify-between rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 cursor-move"
              >
                {editingId === item.id ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                    <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                    <input
                      type="color"
                      value={editingColor}
                      onChange={(e) => setEditingColor(e.target.value)}
                      className="h-10 w-full rounded-lg border border-gray-300 px-2 dark:border-gray-700 dark:bg-gray-900"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-block w-4 h-4 rounded-full border border-gray-200 dark:border-gray-700"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-gray-800 dark:text-white/90">{item.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {editingId === item.id ? (
                    <>
                      <Button size="sm" disabled={actionBusy} onClick={onSaveEdit}>Сохранить</Button>
                      <Button size="sm" variant="outline" disabled={actionBusy} onClick={onCancelEdit}>Отмена</Button>
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
