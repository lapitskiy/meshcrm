"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useRef, useState } from "react";

type Summary = {
  total_sessions: number;
  open_sessions: number;
  finished_sessions: number;
  total_worked_minutes: number;
};

type UserLite = {
  user_uuid: string;
  username: string;
  email: string;
  full_name: string;
};

type Schedule = {
  id: string;
  user_uuid: string;
  branch_name?: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
};

type Session = {
  id: string;
  user_uuid: string;
  schedule_id?: string | null;
  work_date: string;
  branch_name?: string | null;
  check_in_at: string;
  check_out_at?: string | null;
  worked_minutes?: number | null;
};

type AttendanceComment = {
  id: string;
  session_id: string;
  comment: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type AttendanceIssueKind = "problem" | "resolved";

type AttendanceIssue = {
  id: string;
  session_id: string;
  issue_kind: AttendanceIssueKind;
  reason: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type AttendancePhoto = {
  id: string;
  session_id: string;
  mime_type: string;
  data_url: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  created_at: string;
};

type FeedItem =
  | {
      kind: "issue";
      id: string;
      title: string;
      reason: string;
      created_at: string;
      created_by_name?: string;
      issue_kind: AttendanceIssueKind;
    }
  | {
      kind: "comment";
      id: string;
      title: string;
      created_at: string;
      created_by_name?: string;
    }
  | {
      kind: "photo";
      id: string;
      title: string;
      image_url: string;
      created_at: string;
      created_by_name?: string;
    };

const PAGE_SIZE = 50;

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function formatMinutes(totalMinutes?: number | null): string {
  const safe = Number(totalMinutes || 0);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours} ч ${minutes} мин`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}

function formatTime(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 5);
}

function formatUserLabel(session: Session, selectedUser: UserLite | null): string {
  if (selectedUser) return selectedUser.full_name;
  return session.user_uuid;
}

function getSessionProblem(session: Session, schedule?: Schedule) {
  if (!schedule?.start_time) {
    return {
      isLate: false,
      label: "Без графика",
      details: "Нет назначенного времени начала",
      scheduledStart: null as string | null,
    };
  }
  const [hours, minutes] = schedule.start_time.split(":").map(Number);
  const actualStart = new Date(session.check_in_at);
  const scheduledStart = new Date(actualStart);
  scheduledStart.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  const diffMs = actualStart.getTime() - scheduledStart.getTime();
  if (diffMs <= 0) {
    return {
      isLate: false,
      label: "Норма",
      details: "Начал вовремя",
      scheduledStart: schedule.start_time,
    };
  }
  const lateMinutes = Math.floor(diffMs / 60000);
  return {
    isLate: true,
    label: "Проблема",
    details: `Опоздание ${formatMinutes(lateMinutes)}`,
    scheduledStart: schedule.start_time,
  };
}

export default function StaffAnalyticsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fromDate, setFromDate] = useState(today.slice(0, 8) + "01");
  const [toDate, setToDate] = useState(today);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsPage, setSessionsPage] = useState(0);
  const [hasNextSessionsPage, setHasNextSessionsPage] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserLite[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [commentHistoryBySession, setCommentHistoryBySession] = useState<Record<string, AttendanceComment[]>>({});
  const [commentHistoryLoadingBySession, setCommentHistoryLoadingBySession] = useState<Record<string, boolean>>({});
  const [commentHistoryErrorBySession, setCommentHistoryErrorBySession] = useState<Record<string, string>>({});
  const [commentDraftOpenBySession, setCommentDraftOpenBySession] = useState<Record<string, boolean>>({});
  const [commentDraftTextBySession, setCommentDraftTextBySession] = useState<Record<string, string>>({});
  const [commentSavingBySession, setCommentSavingBySession] = useState<Record<string, boolean>>({});
  const [issueHistoryBySession, setIssueHistoryBySession] = useState<Record<string, AttendanceIssue[]>>({});
  const [issueHistoryLoadingBySession, setIssueHistoryLoadingBySession] = useState<Record<string, boolean>>({});
  const [issueHistoryErrorBySession, setIssueHistoryErrorBySession] = useState<Record<string, string>>({});
  const [issueDraftOpenBySession, setIssueDraftOpenBySession] = useState<Record<string, boolean>>({});
  const [issueDraftReasonBySession, setIssueDraftReasonBySession] = useState<Record<string, string>>({});
  const [issueSavingBySession, setIssueSavingBySession] = useState<Record<string, boolean>>({});
  const [confirmResolvedBySession, setConfirmResolvedBySession] = useState<Record<string, boolean>>({});
  const [photoHistoryBySession, setPhotoHistoryBySession] = useState<Record<string, AttendancePhoto[]>>({});
  const [photoHistoryLoadingBySession, setPhotoHistoryLoadingBySession] = useState<Record<string, boolean>>({});
  const [photoHistoryErrorBySession, setPhotoHistoryErrorBySession] = useState<Record<string, string>>({});
  const [photoSavingBySession, setPhotoSavingBySession] = useState<Record<string, boolean>>({});
  const [cameraSessionId, setCameraSessionId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [capturedPhotoDataUrl, setCapturedPhotoDataUrl] = useState("");
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const schedulesMap = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules]
  );

  const load = async (nextFromDate: string, nextToDate: string, userUuid?: string | null, page = 0) => {
    const params = new URLSearchParams({
      from_date: nextFromDate,
      to_date: nextToDate,
    });
    if (userUuid) {
      params.set("user_uuid", userUuid);
    } else {
      params.set("all_users", "true");
    }
    const sessionsParams = new URLSearchParams(params);
    sessionsParams.set("limit", String(PAGE_SIZE + 1));
    sessionsParams.set("offset", String(page * PAGE_SIZE));
    const schedulesParams = new URLSearchParams();
    if (userUuid) {
      schedulesParams.set("user_uuid", userUuid);
    } else {
      schedulesParams.set("all_users", "true");
    }
    const [summaryResp, sessionsResp, schedulesResp] = await Promise.all([
      fetch(`${base}/staff/staff/analytics/summary?${params.toString()}`, {
        cache: "no-store",
        headers: authHeaders(),
      }),
      fetch(`${base}/staff/staff/attendance/sessions?${sessionsParams.toString()}`, {
        cache: "no-store",
        headers: authHeaders(),
      }),
      fetch(`${base}/staff/staff/schedules?${schedulesParams.toString()}`, {
        cache: "no-store",
        headers: authHeaders(),
      }),
    ]);
    if (!summaryResp.ok) {
      const body = await summaryResp.text().catch(() => "");
      throw new Error(`analytics summary failed: ${summaryResp.status} ${body}`);
    }
    if (!sessionsResp.ok) {
      const body = await sessionsResp.text().catch(() => "");
      throw new Error(`analytics sessions failed: ${sessionsResp.status} ${body}`);
    }
    if (!schedulesResp.ok) {
      const body = await schedulesResp.text().catch(() => "");
      throw new Error(`staff schedules failed: ${schedulesResp.status} ${body}`);
    }
    setSummary((await summaryResp.json()) as Summary);
    const loadedSessions = (await sessionsResp.json()) as Session[];
    setSessions(loadedSessions.slice(0, PAGE_SIZE));
    setHasNextSessionsPage(loadedSessions.length > PAGE_SIZE);
    setSchedules((await schedulesResp.json()) as Schedule[]);
    setSessionsPage(page);
  };

  useEffect(() => {
    (async () => {
      try {
        await load(fromDate, toDate, null);
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить аналитику");
      }
    })();
  }, []);

  useEffect(() => {
    setError(null);
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
            throw new Error(`masters search failed: ${resp.status} ${body}`);
          }
          setUsers((await resp.json()) as UserLite[]);
        } catch (e: any) {
          setError(e?.message || "Не удалось найти мастера");
          setUsers([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, base]);

  const onReload = async () => {
    try {
      setError(null);
      await load(fromDate, toDate, selectedUser?.user_uuid || null, 0);
    } catch (e: any) {
      setError(e?.message || "Не удалось обновить аналитику");
    }
  };

  const onPickUser = async (user: UserLite) => {
    try {
      setError(null);
      setSelectedUser(user);
      setQuery(user.email || user.username || user.full_name);
      setUsers([]);
      await load(fromDate, toDate, user.user_uuid, 0);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить аналитику мастера");
    }
  };

  const onResetUserFilter = async () => {
    try {
      setError(null);
      setSelectedUser(null);
      setQuery("");
      setUsers([]);
      await load(fromDate, toDate, null, 0);
    } catch (e: any) {
      setError(e?.message || "Не удалось сбросить фильтр мастера");
    }
  };

  const onChangeSessionsPage = async (nextPage: number) => {
    try {
      setError(null);
      await load(fromDate, toDate, selectedUser?.user_uuid || null, nextPage);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить страницу смен");
    }
  };

  const loadCommentHistory = async (sessionId: string) => {
    if (commentHistoryBySession[sessionId]) return;
    setCommentHistoryLoadingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setCommentHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/comments?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance comments failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as AttendanceComment[];
      setCommentHistoryBySession((prev) => ({ ...prev, [sessionId]: history }));
    } catch (e: any) {
      setCommentHistoryErrorBySession((prev) => ({
        ...prev,
        [sessionId]: e?.message || "Не удалось загрузить комментарии",
      }));
    } finally {
      setCommentHistoryLoadingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const loadIssueHistory = async (sessionId: string) => {
    if (issueHistoryBySession[sessionId]) return;
    setIssueHistoryLoadingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/issues?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance issues failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as AttendanceIssue[];
      setIssueHistoryBySession((prev) => ({ ...prev, [sessionId]: history }));
    } catch (e: any) {
      setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: e?.message || "Не удалось загрузить проблемы" }));
    } finally {
      setIssueHistoryLoadingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const loadPhotoHistory = async (sessionId: string) => {
    if (photoHistoryBySession[sessionId]) return;
    setPhotoHistoryLoadingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setPhotoHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/photos?limit=100`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance photos failed: ${resp.status} ${body}`);
      }
      const history = (await resp.json()) as AttendancePhoto[];
      setPhotoHistoryBySession((prev) => ({ ...prev, [sessionId]: history }));
    } catch (e: any) {
      setPhotoHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: e?.message || "Не удалось загрузить фото" }));
    } finally {
      setPhotoHistoryLoadingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const stopCameraStream = () => {
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  const closeCameraModal = () => {
    stopCameraStream();
    setCameraSessionId(null);
    setCameraError("");
    setCapturedPhotoDataUrl("");
  };

  const onOpenCamera = async (sessionId: string) => {
    setPhotoHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    setCameraError("");
    setCapturedPhotoDataUrl("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhotoHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "Браузер не поддерживает доступ к камере." }));
      return;
    }
    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraSessionId(sessionId);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        void cameraVideoRef.current.play().catch(() => {
          setCameraError("Не удалось запустить камеру.");
        });
      }
    } catch (e: any) {
      setPhotoHistoryErrorBySession((prev) => ({
        ...prev,
        [sessionId]: e?.message ? `Не удалось открыть камеру: ${e.message}` : "Не удалось открыть камеру.",
      }));
    }
  };

  const onCapturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) {
      setCameraError("Камера не готова.");
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError("Подождите, пока камера начнет передавать изображение.");
      return;
    }
    const maxWidth = 1600;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Не удалось подготовить снимок.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    setCapturedPhotoDataUrl(canvas.toDataURL("image/jpeg", 0.9));
    setCameraError("");
    stopCameraStream();
  };

  const onToggleOpen = (sessionId: string) => {
    setOpenSessionId((prev) => (prev === sessionId ? null : sessionId));
    if (openSessionId !== sessionId) {
      void loadCommentHistory(sessionId);
      void loadIssueHistory(sessionId);
      void loadPhotoHistory(sessionId);
    }
  };

  const onStartComment = (sessionId: string) => {
    setCommentDraftOpenBySession((prev) => ({ ...prev, [sessionId]: true }));
    setCommentHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
  };

  const onCancelComment = (sessionId: string) => {
    setCommentDraftOpenBySession((prev) => ({ ...prev, [sessionId]: false }));
    setCommentDraftTextBySession((prev) => ({ ...prev, [sessionId]: "" }));
  };

  const onSaveComment = async (sessionId: string) => {
    const comment = String(commentDraftTextBySession[sessionId] || "").trim();
    if (!comment) {
      setCommentHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "Укажите комментарий." }));
      return;
    }
    setCommentSavingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setCommentHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/comments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ comment }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance comment save failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as AttendanceComment;
      setCommentHistoryBySession((prev) => ({ ...prev, [sessionId]: [entry, ...(prev[sessionId] || [])] }));
      setCommentDraftOpenBySession((prev) => ({ ...prev, [sessionId]: false }));
      setCommentDraftTextBySession((prev) => ({ ...prev, [sessionId]: "" }));
    } catch (e: any) {
      setCommentHistoryErrorBySession((prev) => ({
        ...prev,
        [sessionId]: e?.message || "Не удалось сохранить комментарий",
      }));
    } finally {
      setCommentSavingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const onStartIssue = (sessionId: string) => {
    setIssueDraftOpenBySession((prev) => ({ ...prev, [sessionId]: true }));
    setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    setConfirmResolvedBySession((prev) => ({ ...prev, [sessionId]: false }));
  };

  const onCancelIssue = (sessionId: string) => {
    setIssueDraftOpenBySession((prev) => ({ ...prev, [sessionId]: false }));
    setIssueDraftReasonBySession((prev) => ({ ...prev, [sessionId]: "" }));
  };

  const onSaveIssue = async (sessionId: string) => {
    const reason = String(issueDraftReasonBySession[sessionId] || "").trim();
    if (!reason) {
      setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "Укажите причину." }));
      return;
    }
    setIssueSavingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/issues`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ issue_kind: "problem", reason }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance issue save failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as AttendanceIssue;
      setIssueHistoryBySession((prev) => ({ ...prev, [sessionId]: [entry, ...(prev[sessionId] || [])] }));
      setIssueDraftOpenBySession((prev) => ({ ...prev, [sessionId]: false }));
      setIssueDraftReasonBySession((prev) => ({ ...prev, [sessionId]: "" }));
    } catch (e: any) {
      setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: e?.message || "Не удалось сохранить проблему" }));
    } finally {
      setIssueSavingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const onResolveIssue = async (sessionId: string) => {
    setIssueSavingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/issues`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ issue_kind: "resolved", reason: "Проблема решена" }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance issue resolve failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as AttendanceIssue;
      setIssueHistoryBySession((prev) => ({ ...prev, [sessionId]: [entry, ...(prev[sessionId] || [])] }));
      setConfirmResolvedBySession((prev) => ({ ...prev, [sessionId]: false }));
    } catch (e: any) {
      setIssueHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: e?.message || "Не удалось снять проблему" }));
    } finally {
      setIssueSavingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const onSavePhoto = async (sessionId: string) => {
    if (!capturedPhotoDataUrl) {
      setCameraError("Сначала сделайте снимок.");
      return;
    }
    setPhotoSavingBySession((prev) => ({ ...prev, [sessionId]: true }));
    setPhotoHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: "" }));
    try {
      const resp = await fetch(`${base}/staff/staff/attendance/sessions/${encodeURIComponent(sessionId)}/photos`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ data_url: capturedPhotoDataUrl }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`attendance photo save failed: ${resp.status} ${body}`);
      }
      const entry = (await resp.json()) as AttendancePhoto;
      setPhotoHistoryBySession((prev) => ({ ...prev, [sessionId]: [entry, ...(prev[sessionId] || [])] }));
      closeCameraModal();
    } catch (e: any) {
      setPhotoHistoryErrorBySession((prev) => ({ ...prev, [sessionId]: e?.message || "Не удалось сохранить фото" }));
    } finally {
      setPhotoSavingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const buildFeedItems = (sessionId: string): FeedItem[] => {
    const issueItems: FeedItem[] = (issueHistoryBySession[sessionId] || []).map((entry) => ({
      kind: "issue",
      id: entry.id,
      title: entry.issue_kind === "resolved" ? "Решена" : "Проблема",
      reason: entry.reason,
      created_at: entry.created_at,
      created_by_name: entry.created_by_name,
      issue_kind: entry.issue_kind,
    }));
    const commentItems: FeedItem[] = (commentHistoryBySession[sessionId] || []).map((entry) => ({
      kind: "comment",
      id: entry.id,
      title: entry.comment,
      created_at: entry.created_at,
      created_by_name: entry.created_by_name,
    }));
    const photoItems: FeedItem[] = (photoHistoryBySession[sessionId] || []).map((entry) => ({
      kind: "photo",
      id: entry.id,
      title: "Фото",
      image_url: entry.data_url,
      created_at: entry.created_at,
      created_by_name: entry.created_by_name,
    }));
    return [...issueItems, ...commentItems, ...photoItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  };

  useEffect(() => {
    if (!cameraSessionId || !cameraVideoRef.current || !cameraStreamRef.current) return;
    const video = cameraVideoRef.current;
    video.srcObject = cameraStreamRef.current;
    void video.play().catch(() => {
      setCameraError("Не удалось запустить камеру.");
    });
    return () => {
      if (video.srcObject === cameraStreamRef.current) {
        video.srcObject = null;
      }
    };
  }, [cameraSessionId]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Аналитика" />
      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-sm text-gray-500 dark:text-gray-400">Всего смен</div>
            <div className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {summary?.total_sessions ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-sm text-gray-500 dark:text-gray-400">Открытые смены</div>
            <div className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {summary?.open_sessions ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-sm text-gray-500 dark:text-gray-400">Закрытые смены</div>
            <div className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {summary?.finished_sessions ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="text-sm text-gray-500 dark:text-gray-400">Отработано</div>
            <div className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {formatMinutes(summary?.total_worked_minutes)}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 lg:min-w-[360px]">
              <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">Мастер</label>
              <input
                className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Начните вводить email или username"
              />
              {!!users.length && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  {users.map((user) => (
                    <button
                      key={user.user_uuid}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => void onPickUser(user)}
                    >
                      {user.full_name} {user.email ? `(${user.email})` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">С</label>
              <input
                type="date"
                className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-gray-700 dark:text-gray-300">По</label>
              <input
                type="date"
                className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => void onReload()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Обновить
            </button>
            {selectedUser ? (
              <button
                type="button"
                onClick={() => void onResetUserFilter()}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Сбросить мастера
              </button>
            ) : null}
          </div>

          {error ? <div className="mb-3 text-sm text-red-600">Ошибка: {error}</div> : null}
          <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {selectedUser ? (
              <>
                Аналитика по мастеру: <span className="font-medium text-gray-800 dark:text-white/90">{selectedUser.full_name}</span>
              </>
            ) : (
              "Если мастер не выбран, показываются смены всех сотрудников."
            )}
          </div>

          {!sessions.length ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Нет данных за выбранный период.</div>
          ) : (
            <div className="space-y-3">
              <div className="hidden rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400 lg:grid lg:grid-cols-[1fr_1.1fr_0.8fr_1fr_1fr_0.8fr_0.8fr] lg:gap-3">
                <div>Мастер</div>
                <div>Точка</div>
                <div>По графику</div>
                <div>Начал работать</div>
                <div>Завершение</div>
                <div>Отработано</div>
                <div>Статус</div>
              </div>
              {sessions.map((session) => {
                const schedule = session.schedule_id ? schedulesMap.get(session.schedule_id) : undefined;
                const problem = getSessionProblem(session, schedule);
                const latestIssue = (issueHistoryBySession[session.id] || [])[0];
                const hasManualProblem = latestIssue?.issue_kind === "problem";
                const isProblem = hasManualProblem || problem.isLate;
                const statusLabel = hasManualProblem ? "Проблема" : latestIssue?.issue_kind === "resolved" ? "Решена" : problem.label;
                const statusDetails = hasManualProblem
                  ? latestIssue.reason
                  : latestIssue?.issue_kind === "resolved"
                    ? latestIssue.reason || "Проблема решена"
                    : problem.details;
                return (
                  <div
                    key={session.id}
                    className={`rounded-lg border ${
                      isProblem
                        ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
                        : "border-gray-100 dark:border-gray-800"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleOpen(session.id)}
                      className={`w-full px-4 py-3 text-left text-sm dark:text-gray-300 lg:grid lg:grid-cols-[1fr_1.1fr_0.8fr_1fr_1fr_0.8fr_0.8fr_32px] lg:items-center lg:gap-3 ${
                        isProblem ? "text-red-900 dark:text-red-200" : "text-gray-700"
                      }`}
                    >
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">Мастер</div>
                        <div className="break-all font-medium text-gray-800 dark:text-white/90">
                          {formatUserLabel(session, selectedUser)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">Точка</div>
                        <div className="font-medium text-gray-800 dark:text-white/90">
                          {session.branch_name || schedule?.branch_name || "Без филиала"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">По графику</div>
                        <div>{problem.scheduledStart ? formatTime(problem.scheduledStart) : "Не задано"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">Начал работать</div>
                        <div>{formatDateTime(session.check_in_at)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">Завершение</div>
                        <div>{session.check_out_at ? formatDateTime(session.check_out_at) : "Открыта"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">Отработано</div>
                        <div>{formatMinutes(session.worked_minutes)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">Статус</div>
                        <div
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            isProblem
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
                              : statusLabel === "Решена"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                                : problem.scheduledStart
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {statusLabel}
                        </div>
                        <div
                          className={`mt-1 text-xs ${
                            isProblem ? "text-red-700 dark:text-red-300" : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {statusDetails}
                        </div>
                      </div>
                      <div className="mt-2 text-right text-lg lg:mt-0">{openSessionId === session.id ? "−" : "+"}</div>
                    </button>

                    {openSessionId === session.id ? (
                      <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                            <div>Дата смены: {session.work_date}</div>
                            <div>ID сессии: {session.id}</div>
                            <div>Мастер: {formatUserLabel(session, selectedUser)}</div>
                          </div>
                          <div className="w-full max-w-[280px]">
                            {!commentDraftOpenBySession[session.id] && !issueDraftOpenBySession[session.id] ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => onStartComment(session.id)}>
                                  Комментарий
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => onStartIssue(session.id)}>
                                  Проблема
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => void onOpenCamera(session.id)}>
                                  Фото
                                </Button>
                              </div>
                            ) : (
                              <div className="rounded-lg border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-white/[0.03]">
                                {issueDraftOpenBySession[session.id] ? (
                                  <>
                                    <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Описание проблемы</div>
                                    <textarea
                                      value={issueDraftReasonBySession[session.id] || ""}
                                      onChange={(e) =>
                                        setIssueDraftReasonBySession((prev) => ({ ...prev, [session.id]: e.target.value }))
                                      }
                                      placeholder="Опишите проблему"
                                      rows={3}
                                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                    />
                                    <div className="mt-2 space-y-2">
                                      {issueHistoryErrorBySession[session.id] ? (
                                        <div className="text-sm text-red-600">Ошибка: {issueHistoryErrorBySession[session.id]}</div>
                                      ) : null}
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => onCancelIssue(session.id)}
                                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                        >
                                          Отмена
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void onSaveIssue(session.id)}
                                          disabled={!!issueSavingBySession[session.id]}
                                          className="rounded-lg border border-red-300 bg-red-100 px-3 py-1.5 text-sm text-red-700 disabled:opacity-60 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                                        >
                                          Сохранить
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Комментарий</div>
                                    <textarea
                                      value={commentDraftTextBySession[session.id] || ""}
                                      onChange={(e) =>
                                        setCommentDraftTextBySession((prev) => ({ ...prev, [session.id]: e.target.value }))
                                      }
                                      placeholder="Введите комментарий"
                                      rows={3}
                                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                    />
                                    <div className="mt-2 space-y-2">
                                      {commentHistoryErrorBySession[session.id] ? (
                                        <div className="text-sm text-red-600">Ошибка: {commentHistoryErrorBySession[session.id]}</div>
                                      ) : null}
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => onCancelComment(session.id)}
                                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                                        >
                                          Отмена
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void onSaveComment(session.id)}
                                          disabled={!!commentSavingBySession[session.id]}
                                          className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-60 dark:border-gray-700 dark:bg-white/10 dark:text-gray-100"
                                        >
                                          Сохранить
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {hasManualProblem && confirmResolvedBySession[session.id] ? (
                          <div className="mt-4 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void onResolveIssue(session.id)}
                              className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                            >
                              Решена
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmResolvedBySession((prev) => ({ ...prev, [session.id]: false }))}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                            >
                              Нет
                            </button>
                          </div>
                        ) : hasManualProblem ? (
                          <div className="mt-4 flex justify-end">
                            <button
                              type="button"
                              onClick={() => setConfirmResolvedBySession((prev) => ({ ...prev, [session.id]: true }))}
                              className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                            >
                              Решена
                            </button>
                          </div>
                        ) : null}

                        {(commentHistoryLoadingBySession[session.id] ||
                          issueHistoryLoadingBySession[session.id] ||
                          photoHistoryLoadingBySession[session.id] ||
                          commentHistoryErrorBySession[session.id] ||
                          issueHistoryErrorBySession[session.id] ||
                          photoHistoryErrorBySession[session.id] ||
                          commentDraftOpenBySession[session.id] ||
                          issueDraftOpenBySession[session.id] ||
                          buildFeedItems(session.id).length > 0) && (
                          <div className="mt-4 flex justify-end">
                            <div className="w-full max-w-xl space-y-2">
                              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Лента</div>
                              {commentHistoryLoadingBySession[session.id] ||
                              issueHistoryLoadingBySession[session.id] ||
                              photoHistoryLoadingBySession[session.id] ? (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
                              ) : commentHistoryErrorBySession[session.id] && !commentDraftOpenBySession[session.id] ? (
                                <div className="text-sm text-red-600">Ошибка: {commentHistoryErrorBySession[session.id]}</div>
                              ) : issueHistoryErrorBySession[session.id] && !issueDraftOpenBySession[session.id] ? (
                                <div className="text-sm text-red-600">Ошибка: {issueHistoryErrorBySession[session.id]}</div>
                              ) : photoHistoryErrorBySession[session.id] ? (
                                <div className="text-sm text-red-600">Ошибка: {photoHistoryErrorBySession[session.id]}</div>
                              ) : buildFeedItems(session.id).length ? (
                                <div className="space-y-2">
                                  {buildFeedItems(session.id).map((entry) => (
                                    <div
                                      key={entry.id}
                                      className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2 dark:border-gray-700 dark:bg-white/[0.03]"
                                    >
                                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                        {entry.kind === "issue" ? (
                                          <span
                                            className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                                              entry.issue_kind === "resolved"
                                                ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                                : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                                            }`}
                                          >
                                            {entry.title}
                                          </span>
                                        ) : entry.kind === "photo" ? (
                                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                                            Фото
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-white/10 dark:text-gray-300">
                                            Комментарий
                                          </span>
                                        )}
                                        <span>{new Date(entry.created_at).toLocaleString("ru-RU")}</span>
                                        {entry.created_by_name ? <span>{entry.created_by_name}</span> : null}
                                      </div>
                                      {entry.kind === "photo" ? (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewPhotoUrl(entry.image_url)}
                                          className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                                        >
                                          <img
                                            src={entry.image_url}
                                            alt="Фото смены"
                                            className="h-[200px] w-[200px] object-cover"
                                          />
                                        </button>
                                      ) : (
                                        <div className="mt-1 text-sm text-gray-800 dark:text-white/90">
                                          {entry.kind === "issue" ? entry.reason : entry.title}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Событий пока нет.</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <div className="flex flex-col gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  Страница {sessionsPage + 1}, показано {sessions.length} смен
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={sessionsPage === 0}
                    onClick={() => void onChangeSessionsPage(sessionsPage - 1)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700"
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    disabled={!hasNextSessionsPage}
                    onClick={() => void onChangeSessionsPage(sessionsPage + 1)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={!!cameraSessionId} onClose={closeCameraModal} className="mx-4 max-w-3xl p-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">Фото смены</div>
          {capturedPhotoDataUrl ? (
            <img src={capturedPhotoDataUrl} alt="Снимок смены" className="max-h-[70vh] w-full rounded-xl object-contain" />
          ) : (
            <video ref={cameraVideoRef} autoPlay playsInline muted className="max-h-[70vh] w-full rounded-xl bg-black object-contain" />
          )}
          {cameraError ? <div className="text-sm text-red-600">Ошибка: {cameraError}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {capturedPhotoDataUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => cameraSessionId && void onOpenCamera(cameraSessionId)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                >
                  Переснять
                </button>
                <button
                  type="button"
                  onClick={() => cameraSessionId && void onSavePhoto(cameraSessionId)}
                  disabled={!cameraSessionId || !!photoSavingBySession[cameraSessionId]}
                  className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 disabled:opacity-60 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
                >
                  Сохранить
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onCapturePhoto}
                className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
              >
                Сделать снимок
              </button>
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!previewPhotoUrl} onClose={() => setPreviewPhotoUrl(null)} className="mx-4 max-w-5xl p-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">Фото смены</div>
          {previewPhotoUrl ? (
            <img src={previewPhotoUrl} alt="Фото смены" className="max-h-[80vh] w-full rounded-xl object-contain" />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
