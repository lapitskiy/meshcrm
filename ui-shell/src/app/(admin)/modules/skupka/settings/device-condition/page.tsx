"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type DeviceConditionItem = {
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

export default function SkupkaSettingsDeviceConditionPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<DeviceConditionItem[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/skupka/settings/device-conditions`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as DeviceConditionItem[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load device conditions");
      }
    })();
  }, [base]);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/skupka/settings/device-conditions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setName("");
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to create device condition");
    } finally {
      setBusy(false);
    }
  };

  const onStartEdit = (item: DeviceConditionItem) => {
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
      const resp = await fetch(`${base}/skupka/settings/device-conditions/${editingId}`, {
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
      setError(e?.message || "failed to update device condition");
    } finally {
      setActionBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/skupka/settings/device-conditions/${id}`, {
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
      setError(e?.message || "failed to delete device condition");
    } finally {
      setActionBusy(false);
    }
  };

  const persistOrder = async (ordered: DeviceConditionItem[]) => {
    const resp = await fetch(`${base}/skupka/settings/device-conditions/reorder`, {
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
      setError(e?.message || "failed to reorder device conditions");
      await load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Новое состояние устройства</h3>
        <div>
          <Label>Название состояния</Label>
          <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Например: Отличное" />
        </div>
        <div className="mt-4">
          <Button size="sm" disabled={busy} onClick={onCreate}>Добавить</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список состояний устройства</h3>
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
                  <div className="w-full">
                    <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
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
