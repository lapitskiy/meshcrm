"use client";

import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { KC_TOKENS_STORAGE_KEY, clearPersistedKeycloakTokens, getKeycloak } from "@/lib/keycloak";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

type Props = {
  children: React.ReactNode;
};

type PersistedTokens = {
  token?: string;
  refreshToken?: string;
  idToken?: string;
};

type StaffBranch = {
  id: string;
  name: string;
  address: string;
};

type AttendanceStatusPayload = {
  is_checked_in: boolean;
};

type TenantContext = {
  tenant_id: string;
  role: string;
  tenants: Array<{ tenant_id: string; name: string; role: string }>;
};

const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_MIN_VALIDITY_SECONDS = 90;
const MAX_REFRESH_FAILURES = 6;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];
const SESSION_TIMEOUT_MS = 10 * 60 * 60 * 1000;
const TENANT_CONTEXT_STORAGE_KEY = "hubcrm.tenant.context";

function loadPersistedTokens(): PersistedTokens {
  try {
    const raw = window.localStorage.getItem(KC_TOKENS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedTokens;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePersistedTokens(tokens: PersistedTokens) {
  try {
    window.localStorage.setItem(KC_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Ignore localStorage write failures (private mode, quota, etc).
  }
}

function clearPersistedTokens() {
  clearPersistedKeycloakTokens();
  try {
    window.localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
    (window as any).__hubcrmTenantContext = undefined;
  } catch {
    // no-op
  }
}

function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

function getSessionAuthTimestampMs(kc: any): number | null {
  const parsed =
    kc?.tokenParsed && typeof kc.tokenParsed === "object"
      ? kc.tokenParsed
      : kc?.idTokenParsed && typeof kc.idTokenParsed === "object"
        ? kc.idTokenParsed
        : null;
  const authTimeSeconds =
    typeof parsed?.auth_time === "number"
      ? parsed.auth_time
      : typeof parsed?.iat === "number"
        ? parsed.iat
        : null;
  return authTimeSeconds ? authTimeSeconds * 1000 : null;
}

function syncKeycloakTokens(kc: {
  token?: string;
  refreshToken?: string;
  idToken?: string;
}) {
  (window as any).__hubcrmAccessToken = kc.token;
  savePersistedTokens({
    token: kc.token,
    refreshToken: kc.refreshToken,
    idToken: kc.idToken,
  });
}

function syncTenantContext(context: TenantContext) {
  if (!context?.tenant_id) {
    throw new Error("Tenant context is empty");
  }
  (window as any).__hubcrmTenantContext = context;
  window.localStorage.setItem(TENANT_CONTEXT_STORAGE_KEY, JSON.stringify(context));
}

export default function KeycloakGate({ children }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendanceCheckedIn, setAttendanceCheckedIn] = useState<boolean | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [attendanceBranches, setAttendanceBranches] = useState<StaffBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");

  useEffect(() => {
    let disposed = false;
    let intervalId: number | null = null;
    let retryTimeoutId: number | null = null;
    let sessionTimeoutId: number | null = null;
    let handleOnline: (() => void) | null = null;

    (async () => {
      try {
        const base = getGatewayBaseUrl();
        const kc = await getKeycloak();
        const persisted = loadPersistedTokens();
        const authenticated = await kc.init({
          onLoad: "login-required",
          pkceMethod: "S256",
          checkLoginIframe: false,
          token: persisted.token,
          refreshToken: persisted.refreshToken,
          idToken: persisted.idToken,
        });

        if (!authenticated) {
          clearPersistedTokens();
          await kc.login();
          return;
        }

        let refreshFailures = 0;
        let refreshInFlight = false;
        let authRedirectStarted = false;

        const clearTimers = () => {
          if (intervalId !== null) window.clearInterval(intervalId);
          if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
          if (sessionTimeoutId !== null) window.clearTimeout(sessionTimeoutId);
        };

        const logoutDueToSessionTimeout = async () => {
          if (disposed || authRedirectStarted) return;
          authRedirectStarted = true;
          clearTimers();
          clearPersistedTokens();
          await kc.logout({
            redirectUri: `${window.location.origin}/signin`,
          });
        };

        const armSessionTimeout = () => {
          if (sessionTimeoutId !== null) {
            window.clearTimeout(sessionTimeoutId);
            sessionTimeoutId = null;
          }
          const authTimestampMs = getSessionAuthTimestampMs(kc);
          if (!authTimestampMs) return;
          const remainingMs = authTimestampMs + SESSION_TIMEOUT_MS - Date.now();
          if (remainingMs <= 0) {
            void logoutDueToSessionTimeout();
            return;
          }
          sessionTimeoutId = window.setTimeout(() => {
            sessionTimeoutId = null;
            void logoutDueToSessionTimeout();
          }, remainingMs);
        };

        const loginIfSessionIsLost = async () => {
          if (disposed || authRedirectStarted) return;
          authRedirectStarted = true;
          clearTimers();
          clearPersistedTokens();
          await kc.login();
        };

        const loadTenantContext = async () => {
          const token = kc.token || (window as any).__hubcrmAccessToken || "";
          if (!token) throw new Error("Missing access token for tenant context");
          const resp = await fetch(`${base}/plugins/tenants/current`, {
            cache: "no-store",
            headers: { authorization: `Bearer ${token}` },
          });
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`tenant context failed: ${resp.status} ${body}`);
          }
          syncTenantContext((await resp.json()) as TenantContext);
        };

        const scheduleRetry = () => {
          if (disposed || retryTimeoutId !== null) return;
          const delay =
            RETRY_DELAYS_MS[Math.min(refreshFailures - 1, RETRY_DELAYS_MS.length - 1)];
          retryTimeoutId = window.setTimeout(() => {
            retryTimeoutId = null;
            void tryRefreshToken(true);
          }, delay);
        };

        const tryRefreshToken = async (forced = false) => {
          if (disposed || refreshInFlight || authRedirectStarted) return;
          if (!forced && !isNavigatorOnline()) return;
          refreshInFlight = true;

          try {
            const refreshed = await kc.updateToken(REFRESH_MIN_VALIDITY_SECONDS);
            refreshFailures = 0;
            if (refreshed || kc.token) {
              syncKeycloakTokens(kc);
              armSessionTimeout();
            }
          } catch {
            refreshFailures += 1;
            if (refreshFailures >= MAX_REFRESH_FAILURES) {
              await loginIfSessionIsLost();
              return;
            }
            scheduleRetry();
          } finally {
            refreshInFlight = false;
          }
        };

        const loadAttendanceGuard = async () => {
          setAttendanceLoading(true);
          setAttendanceError(null);
          try {
            const token = kc.token || (window as any).__hubcrmAccessToken || "";
            const headers = token ? { authorization: `Bearer ${token}` } : {};
            const [branchesResp, statusResp] = await Promise.all([
              fetch(`${base}/staff/staff/branches`, { cache: "no-store", headers }),
              fetch(`${base}/staff/staff/attendance/me/status`, { cache: "no-store", headers }),
            ]);
            if (!branchesResp.ok) {
              const body = await branchesResp.text().catch(() => "");
              throw new Error(`staff branches failed: ${branchesResp.status} ${body}`);
            }
            if (!statusResp.ok) {
              const body = await statusResp.text().catch(() => "");
              throw new Error(`staff status failed: ${statusResp.status} ${body}`);
            }
            const branches = (await branchesResp.json()) as StaffBranch[];
            const status = (await statusResp.json()) as AttendanceStatusPayload;
            if (disposed) return;
            setAttendanceBranches(branches || []);
            setAttendanceCheckedIn(Boolean(status?.is_checked_in));
          } catch (e: any) {
            if (disposed) return;
            setAttendanceCheckedIn(false);
            setAttendanceError(e?.message || "Failed to load attendance status");
          } finally {
            if (!disposed) {
              setAttendanceLoading(false);
            }
          }
        };

        handleOnline = () => {
          void tryRefreshToken(true);
        };

        syncKeycloakTokens(kc);
        await loadTenantContext();
        armSessionTimeout();
        intervalId = window.setInterval(() => {
          void tryRefreshToken();
        }, REFRESH_INTERVAL_MS);
        window.addEventListener("online", handleOnline);
        await loadAttendanceGuard();

        if (disposed) return;
        setReady(true);
      } catch (e: any) {
        if (disposed) return;
        setError(e?.message || "Keycloak init failed");
        // fallback: go to template signin page
        router.push("/signin");
      }
    })();

    return () => {
      disposed = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
      if (sessionTimeoutId !== null) window.clearTimeout(sessionTimeoutId);
      if (handleOnline) window.removeEventListener("online", handleOnline);
    };
  }, [router]);

  const onAttendanceModalClose = () => {};

  const onCheckIn = async () => {
    const token = (window as any).__hubcrmAccessToken || "";
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    setAttendanceBusy(true);
    setAttendanceError(null);
    try {
      const resp = await fetch(`${getGatewayBaseUrl()}/staff/staff/attendance/check-in`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ branch_id: selectedBranchId || null }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`check-in failed: ${resp.status} ${body}`);
      }
      setAttendanceCheckedIn(true);
    } catch (e: any) {
      setAttendanceError(e?.message || "Не удалось отметить начало работы");
    } finally {
      setAttendanceBusy(false);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-600 font-medium">Auth error</div>
        <div className="text-sm text-gray-600 mt-2">{error}</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Signing you in...</div>
      </div>
    );
  }

  return (
    <>
      {children}
      <Modal
        isOpen={ready && !attendanceLoading && attendanceCheckedIn === false}
        onClose={onAttendanceModalClose}
        showCloseButton={false}
        className="mx-4 max-w-[560px]"
      >
        <div className="rounded-3xl bg-white p-6 dark:bg-gray-900 sm:p-8">
          <div className="mb-2 text-xl font-semibold text-gray-800 dark:text-white/90">
            Начало рабочего дня
          </div>
          <div className="mb-5 text-sm text-gray-600 dark:text-gray-300">
            Доступ к CRM откроется после отметки о начале работы.
          </div>

          {attendanceError ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {attendanceError}
            </div>
          ) : null}

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Точка
            </label>
            <select
              className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              <option value="">Без точки</option>
              {attendanceBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <Button size="sm" disabled={attendanceBusy} onClick={onCheckIn} className="w-full">
            {attendanceBusy ? "Сохраняю..." : "Начал работать"}
          </Button>
        </div>
      </Modal>
    </>
  );
}


