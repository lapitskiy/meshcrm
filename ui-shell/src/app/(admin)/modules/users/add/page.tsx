"use client";

import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import {
  AdminUserCreateRequest,
  AdminUserCreateResult,
  AdminUserForm,
  AdminUserRole,
  EMPTY_ADMIN_USER_FORM,
  adminUsersFetch,
  canManageUsers,
  cloneForm,
  createRequestToPayload,
  readError,
  toggleRole,
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

export default function UsersAddPage() {
  const [form, setForm] = useState<AdminUserForm>(cloneForm(EMPTY_ADMIN_USER_FORM));
  const [sendEmail, setSendEmail] = useState(false);
  const [roles, setRoles] = useState<AdminUserRole[]>([]);
  const [busy, setBusy] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<AdminUserCreateResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const allowed = await canManageUsers();
        setCanManage(allowed);
        setAccessReady(true);
        if (!allowed) return;
        const resp = await adminUsersFetch("/users/roles", { cache: "no-store" });
        if (!resp.ok) throw new Error(await readError(resp, "Не удалось загрузить роли"));
        setRoles((await resp.json()) as AdminUserRole[]);
      } catch (e: any) {
        setAccessReady(true);
        setError(e?.message || "Не удалось загрузить роли");
      }
    })();
  }, []);

  const updateField = (name: keyof AdminUserForm, value: string | boolean | string[]) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    setCreatedUser(null);
    try {
      const payload: AdminUserCreateRequest = {
        ...form,
        sendEmail,
      };
      const resp = await adminUsersFetch("/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createRequestToPayload(payload)),
      });
      if (!resp.ok) throw new Error(await readError(resp, "Не удалось создать пользователя"));
      setCreatedUser((await resp.json()) as AdminUserCreateResult);
      setForm(cloneForm(EMPTY_ADMIN_USER_FORM));
      setSendEmail(false);
    } catch (e: any) {
      setError(e?.message || "Не удалось создать пользователя");
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
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Добавить пользователя</h3>
        {error ? <div className="mb-4 text-sm text-red-600">Ошибка: {error}</div> : null}
        {createdUser ? (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-300">
            Пользователь создан. Логин: {createdUser.email}. Временный пароль: {createdUser.temporary_password}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Имя</Label>
            <Input value={form.firstName} onChange={(e) => updateField("firstName", e.target.value)} placeholder="Иван" />
          </div>
          <div>
            <Label>Фамилия</Label>
            <Input value={form.lastName} onChange={(e) => updateField("lastName", e.target.value)} placeholder="Иванов" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} placeholder="user@example.com" />
          </div>
          <div>
            <Label>Телефон</Label>
            <Input value={form.phone} onChange={(e) => updateField("phone", e.target.value)} placeholder="+7 777 123 45 67" />
          </div>
          <div className="md:col-span-2">
            <Label>Должность</Label>
            <Input value={form.position} onChange={(e) => updateField("position", e.target.value)} placeholder="Менеджер по продажам" />
          </div>
        </div>

        <div className="mt-4">
          <Checkbox checked={form.enabled} onChange={(checked) => updateField("enabled", checked)} label="Активный пользователь" />
        </div>

        <div className="mt-3">
          <Checkbox checked={sendEmail} onChange={setSendEmail} label="Отправить регистрационные данные на email" />
        </div>

        <div className="mt-6">
          <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Права доступа</div>
          <RoleSelector
            roles={roles}
            selected={form.roles}
            onToggle={(roleName) => updateField("roles", toggleRole(form.roles, roleName))}
          />
        </div>

        <div className="mt-6">
          <Button
            size="sm"
            disabled={busy || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim()}
            onClick={onSubmit}
          >
            Добавить
          </Button>
        </div>
      </div>
    </div>
  );
}
