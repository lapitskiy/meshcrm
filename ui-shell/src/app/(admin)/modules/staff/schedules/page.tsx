"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type UserLite = {
  user_uuid: string;
  username: string;
  email: string;
  full_name: string;
};

type Warehouse = {
  id: string;
  name: string;
  address?: string;
};

type Schedule = {
  id: string;
  user_uuid: string;
  branch_id?: string | null;
  branch_name?: string | null;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

const WEEKDAYS = [
  { value: 0, label: "Пн" },
  { value: 1, label: "Вт" },
  { value: 2, label: "Ср" },
  { value: 3, label: "Чт" },
  { value: 4, label: "Пт" },
  { value: 5, label: "Сб" },
  { value: 6, label: "Вс" },
];

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function StaffSchedulesPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserLite[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserLite | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [allowedWarehouseIds, setAllowedWarehouseIds] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedDays, setSelectedDays] = useState<Record<number, boolean>>({});
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [shiftName, setShiftName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const allowedWarehouses = useMemo(
    () => warehouses.filter((item) => allowedWarehouseIds.includes(item.id)),
    [warehouses, allowedWarehouseIds]
  );

  const loadWarehouses = async () => {
    const resp = await fetch(`${base}/warehouses/warehouses/admin/all`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`warehouses load failed: ${resp.status} ${body}`);
    }
    setWarehouses((await resp.json()) as Warehouse[]);
  };

  const loadSchedules = async (userUuid: string) => {
    const resp = await fetch(`${base}/staff/staff/schedules?user_uuid=${encodeURIComponent(userUuid)}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`staff schedules load failed: ${resp.status} ${body}`);
    }
    setSchedules((await resp.json()) as Schedule[]);
  };

  const loadUserWarehouseAccess = async (userUuid: string) => {
    const resp = await fetch(`${base}/warehouses/warehouses/access/users/${encodeURIComponent(userUuid)}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`user warehouse access failed: ${resp.status} ${body}`);
    }
    const payload = (await resp.json()) as { warehouse_ids: string[] };
    setAllowedWarehouseIds(payload.warehouse_ids || []);
    if ((payload.warehouse_ids || []).length === 1) {
      setSelectedWarehouseId(String(payload.warehouse_ids[0] || ""));
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadWarehouses();
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить точки");
      }
    })();
  }, []);

  useEffect(() => {
    setError(null);
    setOk(null);
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
          setError(e?.message || "Не удалось найти сотрудника");
          setUsers([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const onPickUser = async (user: UserLite) => {
    setBusy(true);
    setSelectedUser(user);
    setQuery(user.email || user.username || user.full_name);
    setUsers([]);
    setError(null);
    setOk(null);
    setSelectedDays({});
    setSelectedWarehouseId("");
    try {
      await Promise.all([loadUserWarehouseAccess(user.user_uuid), loadSchedules(user.user_uuid)]);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить данные сотрудника");
      setSchedules([]);
      setAllowedWarehouseIds([]);
    } finally {
      setBusy(false);
    }
  };

  const onToggleDay = (weekday: number) => {
    setSelectedDays((prev) => ({ ...prev, [weekday]: !prev[weekday] }));
  };

  const onSave = async () => {
    if (!selectedUser) return;
    const weekdays = Object.keys(selectedDays)
      .filter((key) => selectedDays[Number(key)])
      .map((key) => Number(key));
    if (!weekdays.length) {
      setError("Выберите хотя бы один день");
      return;
    }
    if (!selectedWarehouseId) {
      setError("Выберите точку/склад");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await Promise.all(
        weekdays.map(async (weekday) => {
          const existing = schedules.find((item) => item.weekday === weekday);
          const resp = await fetch(
            existing
              ? `${base}/staff/staff/schedules/${encodeURIComponent(existing.id)}`
              : `${base}/staff/staff/schedules`,
            {
              method: existing ? "PUT" : "POST",
              headers: { "content-type": "application/json", ...authHeaders() },
              body: JSON.stringify({
                user_uuid: selectedUser.user_uuid,
                branch_id: selectedWarehouseId,
                name: shiftName,
                weekday,
                start_time: startTime,
                end_time: endTime,
                is_active: true,
              }),
            }
          );
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`save schedule failed: ${resp.status} ${body}`);
          }
        })
      );
      await loadSchedules(selectedUser.user_uuid);
      setSelectedDays({});
      setOk("Смены сохранены");
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить смены");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (scheduleId: string) => {
    if (!selectedUser) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/schedules/${encodeURIComponent(scheduleId)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`delete schedule failed: ${resp.status} ${body}`);
      }
      await loadSchedules(selectedUser.user_uuid);
      setOk("Смена удалена");
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить смену");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Графики смен" />
      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        {error ? <div className="text-sm text-red-600">Ошибка: {error}</div> : null}
        {ok ? <div className="text-sm text-green-600">{ok}</div> : null}

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Сотрудник</div>
          <input
            className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-700"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Начните вводить email или username"
          />
          {!!users.length && (
            <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 max-h-56 overflow-y-auto">
              {users.map((user) => (
                <button
                  key={user.user_uuid}
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => void onPickUser(user)}
                >
                  {user.full_name} {user.email ? `(${user.email})` : ""} [{user.user_uuid}]
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedUser ? (
          <>
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="mb-4 text-sm text-gray-700 dark:text-gray-300">
                Выбран сотрудник: <span className="font-medium">{selectedUser.full_name}</span> ({selectedUser.user_uuid})
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">Точка/склад</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  >
                    <option value="">Выберите точку</option>
                    {allowedWarehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  {!allowedWarehouses.length ? (
                    <div className="mt-2 text-xs text-amber-600">
                      У сотрудника нет назначенных точек в модуле складов.
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">Название смены</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                    value={shiftName}
                    onChange={(e) => setShiftName(e.target.value)}
                    placeholder="Например: основная смена"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">Начало</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">Конец</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-sm text-gray-700 dark:text-gray-300">Дни работы</div>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => onToggleDay(day.value)}
                      className={`rounded-lg border px-4 py-2 text-sm ${
                        selectedDays[day.value]
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <Button size="sm" disabled={busy || !allowedWarehouses.length} onClick={onSave}>
                  Сохранить назначение смен
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Текущие смены сотрудника</h3>
              {!schedules.length ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Для сотрудника смены еще не назначены.</div>
              ) : (
                <div className="space-y-3">
                  {schedules
                    .slice()
                    .sort((a, b) => a.weekday - b.weekday)
                    .map((schedule) => (
                      <div
                        key={schedule.id}
                        className="flex flex-col gap-3 rounded-lg border border-gray-100 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div>
                          <div className="font-medium text-gray-800 dark:text-white/90">
                            {WEEKDAYS.find((item) => item.value === schedule.weekday)?.label || schedule.weekday}
                          </div>
                          <div>Точка: {schedule.branch_name || "не указана"}</div>
                          <div>
                            Время: {schedule.start_time} - {schedule.end_time}
                          </div>
                          {schedule.name ? <div>Название: {schedule.name}</div> : null}
                        </div>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onDelete(schedule.id)}>
                          Удалить
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
