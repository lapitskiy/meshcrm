"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type Contact = {
  id: string;
  name: string;
  phone: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  let core = digits;
  if (core.startsWith("7")) core = core.slice(1);
  if (core.startsWith("8")) core = core.slice(1);
  core = core.slice(0, 10);
  const p1 = core.slice(0, 3);
  const p2 = core.slice(3, 6);
  const p3 = core.slice(6, 8);
  const p4 = core.slice(8, 10);
  let out = "+7";
  if (p1) out += p1;
  if (p2) out += `-${p2}`;
  if (p3) out += `-${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

function isPhoneValid(phone: string): boolean {
  return /^\+7\d{3}-\d{3}-\d{2}-\d{2}$/.test(phone);
}

export default function ContactsListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+7");
  const [items, setItems] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingPhone, setEditingPhone] = useState("+7");
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/contacts/contacts`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) throw new Error(`load failed: ${resp.status}`);
    setItems((await resp.json()) as Contact[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load contacts");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error("Имя обязательно");
      if (!isPhoneValid(phone)) throw new Error("Телефон должен быть в формате +7xxx-xxx-xx-xx");
      const resp = await fetch(`${base}/contacts/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), phone }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`create failed: ${resp.status} ${body}`);
      }
      setName("");
      setPhone("+7");
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to create contact");
    } finally {
      setBusy(false);
    }
  };

  const onStartEdit = (item: Contact) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingPhone(item.phone);
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
    setEditingPhone("+7");
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setActionBusy(true);
    setError(null);
    try {
      if (!editingName.trim()) throw new Error("Имя обязательно");
      if (!isPhoneValid(editingPhone)) throw new Error("Телефон должен быть в формате +7xxx-xxx-xx-xx");
      const resp = await fetch(`${base}/contacts/contacts/${editingId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editingName.trim(), phone: editingPhone }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`update failed: ${resp.status} ${body}`);
      }
      onCancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to update contact");
    } finally {
      setActionBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setActionBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/contacts/contacts/${id}`, {
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
      setError(e?.message || "failed to delete contact");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Добавить контакт</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Имя</Label>
            <Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Имя контакта" />
          </div>
          <div>
            <Label>Телефон</Label>
            <Input
              value={phone}
              onChange={(e: any) => setPhone(formatPhone(e.target.value))}
              placeholder="+7xxx-xxx-xx-xx"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button size="sm" disabled={busy} onClick={onCreate}>
            Добавить
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список контактов</h3>
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
                    <Input value={editingName} onChange={(e: any) => setEditingName(e.target.value)} />
                    <Input value={editingPhone} onChange={(e: any) => setEditingPhone(formatPhone(e.target.value))} />
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-800 dark:text-white/90">{item.name}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{item.phone}</span>
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
