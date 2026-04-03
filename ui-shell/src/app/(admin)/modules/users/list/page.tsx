"use client";

import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
import {
  AdminUser,
  AdminUserForm,
  AdminUserPasswordResetResult,
  AdminUserRole,
  EMPTY_ADMIN_USER_FORM,
  adminUsersFetch,
  canManageUsers,
  cloneForm,
  formToPayload,
  readError,
  toggleRole,
  userToForm,
  passwordResetToPayload,
} from "@/lib/adminUsers";
import React, { useEffect, useState } from "react";

function RoleSelector({
  roles,
  selected,
  onToggle,
}: {
  roles: AdminUserRole[];
  selected: string[];
  onToggle: (roleName: string) => void;
}) {
  if (!roles.length) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Нет доступных ролей для назначения.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {roles.map((role) => (
        <div key={role.name} className="rounded-lg border border-gray-100 px-3 py-3 dark:border-gray-800">
          <Checkbox checked={selected.includes(role.name)} onChange={() => onToggle(role.name)} label={role.name} />
          {role.description ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{role.description}</div> : null}
        </div>
      ))}
    </div>
  );
}

export default function UsersListPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminUserRole[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [editingId, setEditingId] = useState<string>("");
  const [editingForm, setEditingForm] = useState<AdminUserForm>(cloneForm(EMPTY_ADMIN_USER_FORM));
  const [newPassword, setNewPassword] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState(true);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (search = "") => {
    const suffix = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
    const resp = await adminUsersFetch(`/users${suffix}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(await readError(resp, "Не удалось загрузить пользователей"));
    setItems((await resp.json()) as AdminUser[]);
  };

  useEffect(() => {
    (async () => {
      try {
        const allowed = await canManageUsers();
        setCanManage(allowed);
        setAccessReady(true);
        if (!allowed) return;
        const [rolesResp] = await Promise.all([adminUsersFetch("/users/roles", { cache: "no-store" }), load()]);
        if (!rolesResp.ok) throw new Error(await readError(rolesResp, "Не удалось загрузить роли"));
        setRoles((await rolesResp.json()) as AdminUserRole[]);
      } catch (e: any) {
        setAccessReady(true);
        setError(e?.message || "Не удалось загрузить пользователей");
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!canManage) return;
      void (async () => {
        try {
          setError(null);
          await load(query);
        } catch (e: any) {
          setError(e?.message || "Не удалось загрузить пользователей");
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, canManage]);

  const onStartEdit = (user: AdminUser) => {
    setEditingId(user.id);
    setEditingForm(userToForm(user));
    setNewPassword("");
    setTemporaryPassword(true);
    setPasswordMessage(null);
    setError(null);
  };

  const onCancelEdit = () => {
    setEditingId("");
    setEditingForm(cloneForm(EMPTY_ADMIN_USER_FORM));
    setNewPassword("");
    setTemporaryPassword(true);
    setPasswordMessage(null);
  };

  const updateEditingField = (name: keyof AdminUserForm, value: string | boolean | string[]) => {
    setEditingForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSave = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    setPasswordMessage(null);
    try {
      const resp = await adminUsersFetch(`/users/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToPayload(editingForm)),
      });
      if (!resp.ok) throw new Error(await readError(resp, "Не удалось сохранить пользователя"));
      onCancelEdit();
      await load(query);
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить пользователя");
    } finally {
      setBusy(false);
    }
  };

  const generatePassword = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let password = "";
    for (let index = 0; index < 12; index += 1) {
      password += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    setNewPassword(password);
  };

  const onResetPassword = async (user: AdminUser) => {
    setBusy(true);
    setError(null);
    setPasswordMessage(null);
    try {
      const resp = await adminUsersFetch(`/users/${encodeURIComponent(user.id)}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          passwordResetToPayload({
            newPassword,
            temporary: temporaryPassword,
            sendEmail: false,
          })
        ),
      });
      if (!resp.ok) throw new Error(await readError(resp, "Не удалось сменить пароль"));
      const data = (await resp.json()) as AdminUserPasswordResetResult;
      setPasswordMessage(`Пароль обновлен. Новый пароль: ${data.temporary_password}`);
      setNewPassword("");
      setTemporaryPassword(true);
    } catch (e: any) {
      setError(e?.message || "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (user: AdminUser) => {
    if (!window.confirm(`Удалить пользователя ${user.full_name || user.email}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await adminUsersFetch(`/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error(await readError(resp, "Не удалось удалить пользователя"));
      if (editingId === user.id) onCancelEdit();
      await load(query);
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить пользователя");
    } finally {
      setBusy(false);
    }
  };

  if (!accessReady) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="text-sm text-red-600">Недостаточно прав для управления пользователями.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список пользователей</h3>
            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">Редактирование профиля, статуса и ролей доступа.</div>
          </div>
          <div className="w-full md:max-w-sm">
            <Label>Поиск</Label>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, email или логин" />
          </div>
        </div>

        {error ? <div className="mt-4 text-sm text-red-600">Ошибка: {error}</div> : null}

        <div className="mt-6 space-y-4">
          {!items.length ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Пользователи не найдены.</div>
          ) : (
            items.map((user) => (
              <div key={user.id} className="rounded-xl border border-gray-100 px-4 py-4 dark:border-gray-800">
                {editingId === user.id ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label>Имя</Label>
                        <Input value={editingForm.firstName} onChange={(e) => updateEditingField("firstName", e.target.value)} />
                      </div>
                      <div>
                        <Label>Фамилия</Label>
                        <Input value={editingForm.lastName} onChange={(e) => updateEditingField("lastName", e.target.value)} />
                      </div>
                      <div>
                        <Label>Email</Label>
                        <Input type="email" value={editingForm.email} onChange={(e) => updateEditingField("email", e.target.value)} />
                      </div>
                      <div>
                        <Label>Телефон</Label>
                        <Input value={editingForm.phone} onChange={(e) => updateEditingField("phone", e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>Должность</Label>
                        <Input value={editingForm.position} onChange={(e) => updateEditingField("position", e.target.value)} />
                      </div>
                    </div>

                    <Checkbox checked={editingForm.enabled} onChange={(checked) => updateEditingField("enabled", checked)} label="Активный пользователь" />

                    <div>
                      <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Права доступа</div>
                      <RoleSelector
                        roles={roles}
                        selected={editingForm.roles}
                        onToggle={(roleName) => updateEditingField("roles", toggleRole(editingForm.roles, roleName))}
                      />
                    </div>

                    <div className="rounded-lg border border-gray-100 px-4 py-4 dark:border-gray-800">
                      <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Смена пароля</div>
                      {passwordMessage ? <div className="mb-3 text-sm text-green-600">{passwordMessage}</div> : null}
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <Label>Новый пароль</Label>
                          <Input
                            type="text"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Введите новый пароль"
                          />
                        </div>
                        <div className="flex items-end">
                          <Button size="sm" variant="outline" disabled={busy} onClick={generatePassword}>
                            Сгенерировать
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-3">
                        <Checkbox checked={temporaryPassword} onChange={setTemporaryPassword} label="Требовать смену пароля при входе" />
                      </div>
                      <div className="mt-4">
                        <Button size="sm" disabled={busy || newPassword.trim().length < 8} onClick={() => void onResetPassword(user)}>
                          Обновить пароль
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy || !editingForm.firstName.trim() || !editingForm.lastName.trim() || !editingForm.email.trim()}
                        onClick={onSave}
                      >
                        Сохранить
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={onCancelEdit}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div>
                        <div className="text-base font-medium text-gray-800 dark:text-white/90">{user.full_name || user.email}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
                      </div>
                      <div className="grid grid-cols-1 gap-1 text-sm text-gray-600 dark:text-gray-300 md:grid-cols-2 md:gap-x-6">
                        <div>Телефон: {user.phone || "Не указан"}</div>
                        <div>Должность: {user.position || "Не указана"}</div>
                        <div>Логин: {user.username || user.email}</div>
                        <div>Статус: {user.enabled ? "Активен" : "Отключен"}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {user.roles.length ? (
                          user.roles.map((role) => (
                            <span
                              key={role}
                              className="rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                            >
                              {role}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-gray-500 dark:text-gray-400">Роли не назначены.</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                        disabled={busy}
                        onClick={() => onStartEdit(user)}
                        title="Редактировать"
                      >
                        <PencilIcon className="size-5" />
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-700 dark:text-red-400"
                        disabled={busy}
                        onClick={() => void onDelete(user)}
                        title="Удалить"
                      >
                        <TrashBinIcon className="size-5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
