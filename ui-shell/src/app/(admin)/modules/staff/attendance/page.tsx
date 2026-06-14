"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type Branch = {
  id: string;
  name: string;
  address: string;
};

type Session = {
  id: string;
  work_date: string;
  branch_name?: string | null;
  check_in_at: string;
  check_out_at?: string | null;
  scheduled_end_at?: string | null;
  worked_minutes?: number | null;
  comment: string;
  close_comment?: string;
  closed_automatically?: boolean;
};

type StatusPayload = {
  is_checked_in: boolean;
  open_session: Session | null;
  today_sessions: Session[];
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function formatMinutes(totalMinutes?: number | null): string {
  const safe = Number(totalMinutes || 0);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours} ч ${minutes} мин`;
}

export default function StaffAttendancePage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeComment, setCloseComment] = useState("");
  const [showEarlyCloseReason, setShowEarlyCloseReason] = useState(false);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const [branchesResp, statusResp] = await Promise.all([
      fetch(`${base}/staff/staff/branches`, { cache: "no-store", headers: authHeaders() }),
      fetch(`${base}/staff/staff/attendance/me/status`, { cache: "no-store", headers: authHeaders() }),
    ]);
    if (!branchesResp.ok) {
      const body = await branchesResp.text().catch(() => "");
      throw new Error(`staff branches failed: ${branchesResp.status} ${body}`);
    }
    if (!statusResp.ok) {
      const body = await statusResp.text().catch(() => "");
      throw new Error(`staff status failed: ${statusResp.status} ${body}`);
    }
    setBranches((await branchesResp.json()) as Branch[]);
    setStatus((await statusResp.json()) as StatusPayload);
    setCloseComment("");
    setShowEarlyCloseReason(false);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить посещаемость");
      }
    })();
  }, []);

  const onCheckIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/check-in`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ branch_id: selectedBranchId || null }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`check-in failed: ${resp.status} ${body}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось отметить начало работы");
    } finally {
      setBusy(false);
    }
  };

  const onCheckOut = async () => {
    const scheduledEndAt = status?.open_session?.scheduled_end_at
      ? new Date(status.open_session.scheduled_end_at).getTime()
      : null;
    const isEarlyClose = scheduledEndAt !== null && Date.now() < scheduledEndAt;
    if (isEarlyClose && !showEarlyCloseReason) {
      setShowEarlyCloseReason(true);
      return;
    }
    if (isEarlyClose && !closeComment.trim()) {
      setError("Укажите причину раннего завершения работы");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/check-out`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ comment: closeComment.trim() }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`check-out failed: ${resp.status} ${body}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось отметить завершение работы");
    } finally {
      setBusy(false);
    }
  };

  const isEarlyClose =
    !!status?.open_session?.scheduled_end_at &&
    Date.now() < new Date(status.open_session.scheduled_end_at).getTime();

  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Посещаемость" />
      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        {error ? <div className="text-sm text-red-600">Ошибка: {error}</div> : null}

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h3 className="mb-3 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Текущий статус</h3>
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
            {status?.is_checked_in ? "Рабочий день уже открыт." : "Рабочий день еще не начат."}
          </div>

          {!status?.is_checked_in ? (
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="max-w-md flex-1">
                <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">Филиал</label>
                <select
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                >
                  <option value="">Без филиала</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" disabled={busy} onClick={onCheckIn}>
                Отметить начало работы
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <div>Филиал: {status?.open_session?.branch_name || "не указан"}</div>
                <div>Начало: {status?.open_session?.check_in_at ? new Date(status.open_session.check_in_at).toLocaleString("ru-RU") : "—"}</div>
                {status?.open_session?.scheduled_end_at ? (
                  <div>По графику до: {new Date(status.open_session.scheduled_end_at).toLocaleString("ru-RU")}</div>
                ) : null}
                <div>Сейчас на смене: {formatMinutes(status?.open_session?.worked_minutes)}</div>
              </div>
              <div className="flex w-full max-w-md flex-col gap-3">
                {showEarlyCloseReason ? (
                  <div>
                    <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">
                      Причина раннего завершения
                    </label>
                    <textarea
                      className="min-h-[96px] w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                      value={closeComment}
                      onChange={(e) => setCloseComment(e.target.value)}
                      placeholder="Почему сотрудник завершает работу раньше графика"
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="sm" disabled={busy} onClick={onCheckOut} className="w-full">
                    {showEarlyCloseReason ? "Подтвердить завершение" : "Завершить рабочий день"}
                  </Button>
                  {showEarlyCloseReason ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setShowEarlyCloseReason(false);
                        setCloseComment("");
                        setError(null);
                      }}
                      className="w-full"
                    >
                      Отмена
                    </Button>
                  ) : null}
                </div>
                {isEarlyClose ? (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    До конца смены по графику еще есть время. При досрочном завершении нужна причина.
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h3 className="mb-3 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Сессии за сегодня</h3>
          {!status?.today_sessions?.length ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Сегодня отметок еще нет.</div>
          ) : (
            <div className="space-y-3">
              {status.today_sessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-lg border border-gray-100 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300"
                >
                  <div className="font-medium text-gray-800 dark:text-white/90">
                    {session.branch_name || "Без филиала"}
                  </div>
                  <div>
                    Начало: {new Date(session.check_in_at).toLocaleString("ru-RU")}
                  </div>
                  <div>
                    Завершение:{" "}
                    {session.check_out_at
                      ? session.closed_automatically
                        ? `Смена закрыта автоматически (${new Date(session.check_out_at).toLocaleString("ru-RU")})`
                        : new Date(session.check_out_at).toLocaleString("ru-RU")
                      : "Смена открыта"}
                  </div>
                  <div>Отработано: {formatMinutes(session.worked_minutes)}</div>
                  {session.comment ? <div>Комментарий: {session.comment}</div> : null}
                  {session.close_comment ? <div>Причина завершения: {session.close_comment}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
