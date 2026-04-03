"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type Warehouse = {
  id: string;
  name: string;
  address: string;
  point_phone: string;
  qr_site_svg: string;
  qr_yandex_svg: string;
  qr_vk_svg: string;
  qr_telegram_svg: string;
  created_at: string;
  updated_at: string;
};

type QrChannel = "site" | "yandex" | "vk" | "telegram";

const qrFieldMap: Record<QrChannel, keyof Warehouse> = {
  site: "qr_site_svg",
  yandex: "qr_yandex_svg",
  vk: "qr_vk_svg",
  telegram: "qr_telegram_svg",
};

const qrLabels: Record<QrChannel, string> = {
  site: "QR сайта (SVG)",
  yandex: "QR Яндекс (SVG)",
  vk: "QR VK группы (SVG)",
  telegram: "QR Telegram (SVG)",
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

async function readSvgFile(file: File): Promise<string> {
  const text = await file.text();
  if (!text.toLowerCase().includes("<svg")) {
    throw new Error("Файл должен быть SVG");
  }
  return text;
}

export default function WarehousesListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<Warehouse[]>([]);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPointPhone, setNewPointPhone] = useState("");
  const [newQrSiteSvg, setNewQrSiteSvg] = useState("");
  const [newQrYandexSvg, setNewQrYandexSvg] = useState("");
  const [newQrVkSvg, setNewQrVkSvg] = useState("");
  const [newQrTelegramSvg, setNewQrTelegramSvg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string>("");
  const [editingName, setEditingName] = useState<string>("");
  const [editingAddress, setEditingAddress] = useState<string>("");
  const [editingPointPhone, setEditingPointPhone] = useState<string>("");
  const [editingQrSiteSvg, setEditingQrSiteSvg] = useState<string | null>(null);
  const [editingQrYandexSvg, setEditingQrYandexSvg] = useState<string | null>(null);
  const [editingQrVkSvg, setEditingQrVkSvg] = useState<string | null>(null);
  const [editingQrTelegramSvg, setEditingQrTelegramSvg] = useState<string | null>(null);

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

  const setNewQrByChannel = (channel: QrChannel, value: string) => {
    if (channel === "site") setNewQrSiteSvg(value);
    if (channel === "yandex") setNewQrYandexSvg(value);
    if (channel === "vk") setNewQrVkSvg(value);
    if (channel === "telegram") setNewQrTelegramSvg(value);
  };

  const setEditingQrByChannel = (channel: QrChannel, value: string | null) => {
    if (channel === "site") setEditingQrSiteSvg(value);
    if (channel === "yandex") setEditingQrYandexSvg(value);
    if (channel === "vk") setEditingQrVkSvg(value);
    if (channel === "telegram") setEditingQrTelegramSvg(value);
  };

  const onCreateSvgUpload = async (channel: QrChannel, file: File | null) => {
    if (!file) return;
    try {
      setError(null);
      const svg = await readSvgFile(file);
      setNewQrByChannel(channel, svg);
    } catch (e: any) {
      setError(e?.message || "Ошибка загрузки SVG");
    }
  };

  const onEditSvgUpload = async (channel: QrChannel, file: File | null) => {
    if (!file) return;
    try {
      setError(null);
      const svg = await readSvgFile(file);
      setEditingQrByChannel(channel, svg);
    } catch (e: any) {
      setError(e?.message || "Ошибка загрузки SVG");
    }
  };

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/warehouses/warehouses`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: newName,
          address: newAddress,
          point_phone: newPointPhone,
          qr_site_svg: newQrSiteSvg,
          qr_yandex_svg: newQrYandexSvg,
          qr_vk_svg: newQrVkSvg,
          qr_telegram_svg: newQrTelegramSvg,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setNewName("");
      setNewAddress("");
      setNewPointPhone("");
      setNewQrSiteSvg("");
      setNewQrYandexSvg("");
      setNewQrVkSvg("");
      setNewQrTelegramSvg("");
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
    setEditingAddress(w.address || "");
    setEditingPointPhone(w.point_phone || "");
    setEditingQrSiteSvg(null);
    setEditingQrYandexSvg(null);
    setEditingQrVkSvg(null);
    setEditingQrTelegramSvg(null);
  };

  const onCancelEdit = () => {
    setEditingId("");
    setEditingName("");
    setEditingAddress("");
    setEditingPointPhone("");
    setEditingQrSiteSvg(null);
    setEditingQrYandexSvg(null);
    setEditingQrVkSvg(null);
    setEditingQrTelegramSvg(null);
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/warehouses/warehouses/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: editingName,
          address: editingAddress,
          point_phone: editingPointPhone,
          qr_site_svg: editingQrSiteSvg,
          qr_yandex_svg: editingQrYandexSvg,
          qr_vk_svg: editingQrVkSvg,
          qr_telegram_svg: editingQrTelegramSvg,
        }),
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
            <div>
              <Label>Адрес</Label>
              <Input value={newAddress} onChange={(e: any) => setNewAddress(e.target.value)} placeholder="Например: г. Алматы, ул. Абая, 10" />
            </div>
            <div>
              <Label>Телефон точки</Label>
              <Input value={newPointPhone} onChange={(e: any) => setNewPointPhone(e.target.value)} placeholder="+7 777 123 45 67" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(["site", "yandex", "vk", "telegram"] as QrChannel[]).map((channel) => (
                <div key={`new-${channel}`} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">{qrLabels[channel]}</div>
                  <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                    <span>Выбрать SVG файл</span>
                    <input
                      type="file"
                      accept=".svg,image/svg+xml"
                      disabled={busy}
                      className="hidden"
                      onChange={(e) => void onCreateSvgUpload(channel, e.target.files?.[0] || null)}
                    />
                  </label>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {!!({ site: newQrSiteSvg, yandex: newQrYandexSvg, vk: newQrVkSvg, telegram: newQrTelegramSvg }[channel])
                      ? "Выбран SVG файл"
                      : "SVG не загружен"}
                  </div>
                </div>
              ))}
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
                  className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-3"
                >
                  {editingId === w.id ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} placeholder="Название" />
                        <Input value={editingAddress} onChange={(e: any) => setEditingAddress(e.target.value)} placeholder="Адрес" />
                        <Input value={editingPointPhone} onChange={(e: any) => setEditingPointPhone(e.target.value)} placeholder="Телефон точки" />
                        <div className="grid gap-3 md:grid-cols-2">
                          {(["site", "yandex", "vk", "telegram"] as QrChannel[]).map((channel) => (
                            <div key={`edit-${channel}`} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                              <div className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">{qrLabels[channel]}</div>
                              <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                                <span>Выбрать SVG файл</span>
                                <input
                                  type="file"
                                  accept=".svg,image/svg+xml"
                                  disabled={busy}
                                  className="hidden"
                                  onChange={(e) => void onEditSvgUpload(channel, e.target.files?.[0] || null)}
                                />
                              </label>
                              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                {({ site: editingQrSiteSvg, yandex: editingQrYandexSvg, vk: editingQrVkSvg, telegram: editingQrTelegramSvg }[channel])
                                  ? "Выбран новый SVG (будет сохранен)"
                                  : w[qrFieldMap[channel]]
                                    ? "Уже загружен SVG"
                                    : "SVG не загружен"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" disabled={busy || !editingName.trim()} onClick={onSaveEdit}>
                          Сохранить
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={onCancelEdit}>
                          Отмена
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => void onDelete(w.id)}>
                          Удалить
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex-1">
                      <div>
                        <div className="text-sm text-gray-800 dark:text-white/90">{w.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{w.address}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{w.point_phone}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(["site", "yandex", "vk", "telegram"] as QrChannel[]).map((channel) => (
                            <span key={`tag-${w.id}-${channel}`} className="text-xs text-gray-500 dark:text-gray-400">
                              {qrLabels[channel]}: {w[qrFieldMap[channel]] ? "есть" : "нет"}
                            </span>
                          ))}
                        </div>
                      </div>
                      </div>
                      <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onStartEdit(w)}>
                        Редактировать
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => void onDelete(w.id)}>
                        Удалить
                      </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

