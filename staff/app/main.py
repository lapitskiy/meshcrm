import base64
import binascii
import json
import os
import re
import threading
import time
import uuid
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Literal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import psycopg
from psycopg.errors import UniqueViolation
from fastapi import FastAPI, HTTPException, Query, Request as FastAPIRequest
from pydantic import BaseModel, Field

from app.manifests import MANIFEST


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
WAREHOUSES_BASE_URL = env("WAREHOUSES_BASE_URL", "http://warehouses:8000")
KEYCLOAK_INTERNAL_URL = env("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = env("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = env("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = env("KEYCLOAK_ADMIN_PASSWORD", "admin")
ACCESS_ADMIN_ROLES = {"superadmin", "admin", "staff_admin"}
ATTENDANCE_AUTO_CLOSE_POLL_SECONDS = int(os.getenv("ATTENDANCE_AUTO_CLOSE_POLL_SECONDS", "60"))
_attendance_worker_started = False


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def require_user_uuid(request: FastAPIRequest) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def require_tenant_id(request: FastAPIRequest) -> str:
    tenant_id = str(request.headers.get("x-tenant-id", "")).strip()
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing x-tenant-id")
    return tenant_id


def roles_from_headers(request: FastAPIRequest) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def is_admin(request: FastAPIRequest) -> bool:
    return bool(roles_from_headers(request).intersection(ACCESS_ADMIN_ROLES))


def require_admin(request: FastAPIRequest) -> str:
    user_uuid = require_user_uuid(request)
    if is_admin(request):
        return user_uuid
    raise HTTPException(status_code=403, detail="forbidden: admin role required")


def parse_iso_date(value: str | None, field_name: str) -> date | None:
    if value is None or not str(value).strip():
        return None
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid {field_name}, expected YYYY-MM-DD") from e


def parse_hhmm(value: str, field_name: str) -> dt_time:
    raw = str(value or "").strip()
    try:
        return dt_time.fromisoformat(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid {field_name}, expected HH:MM[:SS]") from e


def resolve_user_scope(request: FastAPIRequest, requested_user_uuid: str | None) -> str:
    current_user_uuid = require_user_uuid(request)
    candidate = str(requested_user_uuid or "").strip()
    if not candidate:
        return current_user_uuid
    if candidate == current_user_uuid or is_admin(request):
        return candidate
    raise HTTPException(status_code=403, detail="forbidden: cannot access another user's staff data")


def forwarded_internal_headers(request: FastAPIRequest) -> dict[str, str]:
    return {
        "x-user-uuid": require_user_uuid(request),
        "x-user-roles": ",".join(sorted(roles_from_headers(request))),
        "x-tenant-id": require_tenant_id(request),
    }


def fetch_keycloak_admin_token() -> str:
    body = (
        "client_id=admin-cli"
        f"&username={KEYCLOAK_ADMIN_USER}"
        f"&password={KEYCLOAK_ADMIN_PASSWORD}"
        "&grant_type=password"
    ).encode("utf-8")
    req = Request(
        f"{KEYCLOAK_INTERNAL_URL}/realms/master/protocol/openid-connect/token",
        data=body,
        headers={"content-type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8") or "{}")
    token = str(payload.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("missing access_token in keycloak response")
    return token


def fetch_keycloak_user(user_uuid: str) -> dict:
    token = fetch_keycloak_admin_token()
    req = Request(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_uuid}",
        headers={"authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def user_display_name_from_uuid(user_uuid: str | None) -> str:
    uid = str(user_uuid or "").strip()
    if not uid:
        return ""
    try:
        payload = fetch_keycloak_user(uid)
    except Exception:
        return uid
    first = str(payload.get("firstName") or "").strip()
    last = str(payload.get("lastName") or "").strip()
    return (f"{first} {last}").strip() or str(payload.get("username") or "").strip() or uid


def photo_data_url(mime_type: str, content: bytes) -> str:
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def parse_photo_data_url(raw_value: str) -> tuple[str, bytes]:
    match = re.match(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$", raw_value.strip(), re.IGNORECASE)
    if not match:
        raise HTTPException(status_code=400, detail="photo must be a base64 image data_url")
    mime_type = str(match.group(1) or "").lower()
    encoded = re.sub(r"\s+", "", str(match.group(2) or ""))
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="photo base64 is invalid") from exc
    if not content:
        raise HTTPException(status_code=400, detail="photo content is empty")
    if len(content) > 6 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="photo is too large")
    return mime_type, content


def warehouses_admin_all(request: FastAPIRequest) -> list[dict]:
    req = Request(
        f"{WAREHOUSES_BASE_URL}/warehouses/admin/all",
        headers=forwarded_internal_headers(request),
        method="GET",
    )
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8")) or []
    except HTTPError as e:
        raise HTTPException(status_code=502, detail=f"warehouses admin list failed: {e.code}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="warehouses admin list failed") from e


def warehouses_accessible_for_current_user(request: FastAPIRequest) -> list[dict]:
    req = Request(
        f"{WAREHOUSES_BASE_URL}/warehouses/accessible",
        headers=forwarded_internal_headers(request),
        method="GET",
    )
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8")) or []
    except HTTPError as e:
        raise HTTPException(status_code=502, detail=f"warehouse access load failed: {e.code}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="warehouse access load failed") from e


def warehouses_admin_access_for_user(user_uuid: str, request: FastAPIRequest) -> list[str]:
    req = Request(
        f"{WAREHOUSES_BASE_URL}/warehouses/access/users/{user_uuid}",
        headers=forwarded_internal_headers(request),
        method="GET",
    )
    try:
        with urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8")) or {}
            return [str(item) for item in (payload.get("warehouse_ids") or []) if str(item).strip()]
    except HTTPError as e:
        raise HTTPException(status_code=502, detail=f"warehouse access load failed: {e.code}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="warehouse access load failed") from e


def warehouses_for_user(user_uuid: str, request: FastAPIRequest) -> list[dict]:
    if user_uuid == require_user_uuid(request):
        return warehouses_accessible_for_current_user(request)
    allowed_ids = set(warehouses_admin_access_for_user(user_uuid, request))
    if not allowed_ids:
        return []
    return [item for item in warehouses_admin_all(request) if str(item.get("id")) in allowed_ids]


def warehouses_access_for_user(user_uuid: str, request: FastAPIRequest) -> list[str]:
    warehouses = warehouses_for_user(user_uuid, request)
    return [str(item.get("id")) for item in warehouses if str(item.get("id") or "").strip()]


def sync_branch_from_warehouse(branch_id: uuid.UUID | None, user_uuid: str, request: FastAPIRequest) -> uuid.UUID | None:
    if branch_id is None:
        return None
    warehouses = warehouses_for_user(user_uuid, request)
    match = next((item for item in warehouses if str(item.get("id")) == str(branch_id)), None)
    if not match:
        raise HTTPException(status_code=400, detail="selected warehouse is not assigned to user")
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO staff_branches (id, name, address, is_active, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET
              name = EXCLUDED.name,
              address = EXCLUDED.address,
              is_active = EXCLUDED.is_active,
              updated_at = EXCLUDED.updated_at
            """,
            (
                branch_id,
                str(match.get("name") or "").strip(),
                str(match.get("address") or "").strip(),
                bool(match.get("enabled", True)),
                now,
                now,
            ),
        )
    return branch_id


def ensure_schedule_slot_available(user_uuid: str, weekday: int, schedule_id: uuid.UUID | None = None) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id
            FROM staff_schedules
            WHERE user_uuid = %s
              AND weekday = %s
              AND (%s::uuid IS NULL OR id <> %s::uuid)
            LIMIT 1
            """,
            (user_uuid, weekday, schedule_id, schedule_id),
        )
        row = cur.fetchone()
    if row:
        raise HTTPException(status_code=400, detail="schedule for this weekday already exists")


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_branches (
              id UUID PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              address TEXT NOT NULL DEFAULT '',
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_schedules (
              id UUID PRIMARY KEY,
              user_uuid TEXT NOT NULL,
              branch_id UUID NULL REFERENCES staff_branches(id) ON DELETE SET NULL,
              name TEXT NOT NULL DEFAULT '',
              weekday INTEGER NOT NULL,
              start_time TIME NOT NULL,
              end_time TIME NOT NULL,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              CHECK (weekday BETWEEN 0 AND 6)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_kpk_chapters (
              id UUID PRIMARY KEY,
              chapter_no INTEGER NOT NULL,
              title TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (chapter_no)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_kpk_articles (
              id UUID PRIMARY KEY,
              chapter_id UUID NOT NULL REFERENCES staff_kpk_chapters(id) ON DELETE CASCADE,
              article_no INTEGER NOT NULL,
              title TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (chapter_id, article_no)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_kpk_points (
              id UUID PRIMARY KEY,
              article_id UUID NOT NULL REFERENCES staff_kpk_articles(id) ON DELETE CASCADE,
              point_no INTEGER NOT NULL,
              description TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (article_id, point_no)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_violations (
              id UUID PRIMARY KEY,
              user_uuid TEXT NOT NULL,
              kpk_point_id UUID NULL REFERENCES staff_kpk_points(id) ON DELETE SET NULL,
              comment TEXT NOT NULL DEFAULT '',
              created_by_uuid TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS attendance_sessions (
              id UUID PRIMARY KEY,
              user_uuid TEXT NOT NULL,
              branch_id UUID NULL REFERENCES staff_branches(id) ON DELETE SET NULL,
              schedule_id UUID NULL REFERENCES staff_schedules(id) ON DELETE SET NULL,
              work_date DATE NOT NULL,
              check_in_at TIMESTAMPTZ NOT NULL,
              check_out_at TIMESTAMPTZ NULL,
              source TEXT NOT NULL DEFAULT 'manual',
              comment TEXT NOT NULL DEFAULT '',
              close_comment TEXT NOT NULL DEFAULT '',
              closed_automatically BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS attendance_session_comment_history (
              id UUID PRIMARY KEY,
              session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
              comment TEXT NOT NULL,
              created_by_uuid TEXT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS attendance_session_issue_history (
              id UUID PRIMARY KEY,
              session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
              issue_kind TEXT NOT NULL,
              reason TEXT NOT NULL DEFAULT '',
              created_by_uuid TEXT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS attendance_session_photo_history (
              id UUID PRIMARY KEY,
              session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
              mime_type TEXT NOT NULL,
              content BYTEA NOT NULL,
              created_by_uuid TEXT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute("ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS close_comment TEXT NOT NULL DEFAULT ''")
        cur.execute(
            "ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS closed_automatically BOOLEAN NOT NULL DEFAULT FALSE"
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_staff_schedules_user_uuid_weekday ON staff_schedules(user_uuid, weekday)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_staff_kpk_articles_chapter_id ON staff_kpk_articles(chapter_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_staff_kpk_points_article_id ON staff_kpk_points(article_id)")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_attendance_sessions_user_uuid_work_date ON attendance_sessions(user_uuid, work_date)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_attendance_sessions_branch_id_work_date ON attendance_sessions(branch_id, work_date)"
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_open_session_per_user
            ON attendance_sessions(user_uuid)
            WHERE check_out_at IS NULL
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_attendance_session_comment_history_session_id_created_at "
            "ON attendance_session_comment_history(session_id, created_at DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_attendance_session_issue_history_session_id_created_at "
            "ON attendance_session_issue_history(session_id, created_at DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_attendance_session_photo_history_session_id_created_at "
            "ON attendance_session_photo_history(session_id, created_at DESC)"
        )


class BranchIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(default="", max_length=500)
    is_active: bool = True


class BranchOut(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class KpkPointOut(BaseModel):
    id: uuid.UUID
    point_no: int
    description: str


class KpkArticleOut(BaseModel):
    id: uuid.UUID
    article_no: int
    title: str
    points: list[KpkPointOut]


class KpkChapterTreeOut(BaseModel):
    id: uuid.UUID
    chapter_no: int
    title: str
    articles: list[KpkArticleOut]


class KpkChapterCreateIn(BaseModel):
    chapter_no: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=500)


class KpkChapterUpdateIn(BaseModel):
    chapter_no: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=500)


class KpkArticleCreateIn(BaseModel):
    chapter_id: uuid.UUID
    article_no: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=500)


class KpkArticleUpdateIn(BaseModel):
    article_no: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=500)


class KpkPointCreateIn(BaseModel):
    article_id: uuid.UUID
    point_no: int = Field(ge=1)
    description: str = Field(min_length=1, max_length=8000)


class KpkPointUpdateIn(BaseModel):
    point_no: int = Field(ge=1)
    description: str = Field(min_length=1, max_length=8000)


class ScheduleIn(BaseModel):
    user_uuid: str = Field(min_length=1, max_length=255)
    branch_id: uuid.UUID | None = None
    name: str = Field(default="", max_length=200)
    weekday: int = Field(ge=0, le=6)
    start_time: str = Field(min_length=4, max_length=8)
    end_time: str = Field(min_length=4, max_length=8)
    is_active: bool = True


class ScheduleOut(BaseModel):
    id: uuid.UUID
    user_uuid: str
    branch_id: uuid.UUID | None
    branch_name: str | None = None
    name: str
    weekday: int
    start_time: str
    end_time: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AttendanceSessionOut(BaseModel):
    id: uuid.UUID
    user_uuid: str
    branch_id: uuid.UUID | None
    branch_name: str | None = None
    schedule_id: uuid.UUID | None
    work_date: date
    check_in_at: datetime
    check_out_at: datetime | None
    scheduled_end_at: datetime | None = None
    source: str
    comment: str
    close_comment: str = ""
    closed_automatically: bool = False
    created_at: datetime
    updated_at: datetime
    worked_minutes: int | None = None


class AttendanceSessionCommentCreateIn(BaseModel):
    comment: str = Field(min_length=1, max_length=4000)


class AttendanceSessionCommentOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    comment: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: datetime


class AttendanceSessionIssueCreateIn(BaseModel):
    issue_kind: Literal["problem", "resolved"]
    reason: str = Field(default="", max_length=4000)


class AttendanceSessionIssueOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    issue_kind: Literal["problem", "resolved"]
    reason: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: datetime


class AttendanceSessionPhotoCreateIn(BaseModel):
    data_url: str = Field(min_length=1, max_length=12_000_000)


class AttendanceSessionPhotoOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    mime_type: str
    data_url: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: datetime


class AttendanceStatusOut(BaseModel):
    is_checked_in: bool
    open_session: AttendanceSessionOut | None = None
    today_sessions: list[AttendanceSessionOut] = Field(default_factory=list)


class CheckInIn(BaseModel):
    branch_id: uuid.UUID | None = None
    comment: str = Field(default="", max_length=2000)
    source: str = Field(default="manual", min_length=1, max_length=100)


class CheckOutIn(BaseModel):
    comment: str = Field(default="", max_length=2000)


class AnalyticsSummaryOut(BaseModel):
    total_sessions: int
    open_sessions: int
    finished_sessions: int
    total_worked_minutes: int


class ViolationCreateIn(BaseModel):
    user_uuid: str = Field(min_length=1, max_length=255)
    kpk_point_id: uuid.UUID | None = None
    comment: str = Field(default="", max_length=8000)


class ViolationOut(BaseModel):
    id: uuid.UUID
    user_uuid: str
    user_name: str
    kpk_point_id: uuid.UUID | None
    kpk_chapter_no: int | None
    kpk_article_no: int | None
    kpk_point_no: int | None
    kpk_point_description: str | None
    comment: str
    created_by_uuid: str
    created_by_name: str
    created_at: datetime
    updated_at: datetime


app = FastAPI(title="staff", version="0.1.0")


def branch_out_from_row(row: tuple) -> BranchOut:
    return BranchOut(
        id=row[0],
        name=row[1],
        address=row[2],
        is_active=row[3],
        created_at=row[4],
        updated_at=row[5],
    )


def schedule_out_from_row(row: tuple) -> ScheduleOut:
    return ScheduleOut(
        id=row[0],
        user_uuid=row[1],
        branch_id=row[2],
        branch_name=row[3],
        name=row[4],
        weekday=row[5],
        start_time=row[6].isoformat(timespec="minutes"),
        end_time=row[7].isoformat(timespec="minutes"),
        is_active=row[8],
        created_at=row[9],
        updated_at=row[10],
    )


def scheduled_end_at_from_parts(work_date_value: date, schedule_end_time: dt_time | None, tz_source: datetime | None) -> datetime | None:
    if schedule_end_time is None:
        return None
    tzinfo = tz_source.tzinfo if tz_source and tz_source.tzinfo is not None else timezone.utc
    return datetime.combine(work_date_value, schedule_end_time, tzinfo=tzinfo)


def session_out_from_row(row: tuple) -> AttendanceSessionOut:
    worked_minutes = None if row[13] is None else int(row[13])
    scheduled_end_at = scheduled_end_at_from_parts(row[5], row[12], row[6])
    return AttendanceSessionOut(
        id=row[0],
        user_uuid=row[1],
        branch_id=row[2],
        branch_name=row[3],
        schedule_id=row[4],
        work_date=row[5],
        check_in_at=row[6],
        check_out_at=row[7],
        source=row[8],
        comment=row[9],
        close_comment=row[10],
        closed_automatically=bool(row[11]),
        scheduled_end_at=scheduled_end_at,
        worked_minutes=worked_minutes,
        created_at=row[14],
        updated_at=row[15],
    )


def midnight_cutoff_from_work_date(work_date_value: date, tz_source: datetime | None) -> datetime:
    tzinfo = tz_source.tzinfo if tz_source and tz_source.tzinfo is not None else timezone.utc
    return datetime.combine(work_date_value + timedelta(days=1), dt_time(0, 0), tzinfo=tzinfo)


def auto_close_midnight_open_sessions(user_uuid: str | None = None) -> None:
    clauses = ["s.check_out_at IS NULL", "s.work_date < CURRENT_DATE"]
    params: list[object] = []
    if user_uuid:
        clauses.append("s.user_uuid = %s")
        params.append(user_uuid)
    where_sql = " AND ".join(clauses)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT s.id, s.work_date, s.check_in_at
            FROM attendance_sessions s
            WHERE {where_sql}
            """,
            params,
        )
        rows = cur.fetchall()
        now = utcnow()
        for session_id, work_date_value, check_in_at in rows:
            cur.execute(
                """
                UPDATE attendance_sessions
                SET
                  check_out_at = %s,
                  close_comment = CASE
                    WHEN close_comment = '' THEN %s
                    ELSE close_comment
                  END,
                  closed_automatically = TRUE,
                  updated_at = %s
                WHERE id = %s
                  AND check_out_at IS NULL
                """,
                (midnight_cutoff_from_work_date(work_date_value, check_in_at), "Автоматически закрыто в 00:00", now, session_id),
            )


def auto_close_overdue_open_sessions(user_uuid: str | None = None) -> None:
    clauses = ["s.check_out_at IS NULL", "s.schedule_id IS NOT NULL", "sc.end_time IS NOT NULL"]
    params: list[object] = []
    if user_uuid:
        clauses.append("s.user_uuid = %s")
        params.append(user_uuid)
    where_sql = " AND ".join(clauses)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT s.id, s.work_date, s.check_in_at, sc.end_time
            FROM attendance_sessions s
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE {where_sql}
            """,
            params,
        )
        rows = cur.fetchall()
        now = utcnow()
        for session_id, work_date_value, check_in_at, end_time_value in rows:
            scheduled_end_at = scheduled_end_at_from_parts(work_date_value, end_time_value, check_in_at)
            if scheduled_end_at is None or now < scheduled_end_at:
                continue
            cur.execute(
                """
                UPDATE attendance_sessions
                SET
                  check_out_at = %s,
                  close_comment = CASE
                    WHEN close_comment = '' THEN %s
                    ELSE close_comment
                  END,
                  closed_automatically = TRUE,
                  updated_at = %s
                WHERE id = %s
                  AND check_out_at IS NULL
                """,
                (scheduled_end_at, "Автоматически закрыто по графику", now, session_id),
            )


def _attendance_autoclose_worker() -> None:
    while True:
        try:
            auto_close_midnight_open_sessions()
            auto_close_overdue_open_sessions()
        except Exception:
            pass
        time.sleep(ATTENDANCE_AUTO_CLOSE_POLL_SECONDS)


def get_open_session(user_uuid: str) -> AttendanceSessionOut | None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              s.id,
              s.user_uuid,
              s.branch_id,
              b.name,
              s.schedule_id,
              s.work_date,
              s.check_in_at,
              s.check_out_at,
              s.source,
              s.comment,
              s.close_comment,
              s.closed_automatically,
              sc.end_time,
              EXTRACT(EPOCH FROM (NOW() - s.check_in_at)) / 60,
              s.created_at,
              s.updated_at
            FROM attendance_sessions s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE s.user_uuid = %s AND s.check_out_at IS NULL
            ORDER BY s.check_in_at DESC
            LIMIT 1
            """,
            (user_uuid,),
        )
        row = cur.fetchone()
    return session_out_from_row(row) if row else None


def get_today_sessions(user_uuid: str) -> list[AttendanceSessionOut]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              s.id,
              s.user_uuid,
              s.branch_id,
              b.name,
              s.schedule_id,
              s.work_date,
              s.check_in_at,
              s.check_out_at,
              s.source,
              s.comment,
              s.close_comment,
              s.closed_automatically,
              sc.end_time,
              EXTRACT(EPOCH FROM (COALESCE(s.check_out_at, NOW()) - s.check_in_at)) / 60,
              s.created_at,
              s.updated_at
            FROM attendance_sessions s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE s.user_uuid = %s AND s.work_date = CURRENT_DATE
            ORDER BY s.check_in_at DESC
            """,
            (user_uuid,),
        )
        rows = cur.fetchall()
    return [session_out_from_row(row) for row in rows]


def get_attendance_session_owner(session_id: uuid.UUID) -> str:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT user_uuid FROM attendance_sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="attendance session not found")
    return str(row[0] or "").strip()


def require_session_access(session_id: uuid.UUID, request: FastAPIRequest) -> str:
    session_user_uuid = get_attendance_session_owner(session_id)
    current_user_uuid = require_user_uuid(request)
    if session_user_uuid == current_user_uuid or is_admin(request):
        return session_user_uuid
    raise HTTPException(status_code=403, detail="forbidden: cannot access another user's attendance session")


def normalize_attendance_issue_kind(raw_issue_kind: object) -> Literal["problem", "resolved"]:
    issue_kind = str(raw_issue_kind or "").strip().lower()
    if issue_kind not in {"problem", "resolved"}:
        raise HTTPException(status_code=500, detail="attendance issue_kind is invalid")
    return issue_kind  # type: ignore[return-value]


@app.on_event("startup")
def _startup() -> None:
    global _attendance_worker_started
    for _ in range(60):
        try:
            init_db()
            if not _attendance_worker_started:
                threading.Thread(target=_attendance_autoclose_worker, daemon=True).start()
                _attendance_worker_started = True
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("staff-db not ready")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "staff", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "staff"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


@app.get("/staff/branches", response_model=list[BranchOut])
def list_branches(request: FastAPIRequest, active_only: bool = True) -> list[BranchOut]:
    user_uuid = require_user_uuid(request)
    allowed_warehouse_ids = warehouses_access_for_user(user_uuid, request)
    if not allowed_warehouse_ids:
        return []
    with db() as conn, conn.cursor() as cur:
        clauses = ["id = ANY(%s::uuid[])"]
        params: list[object] = [allowed_warehouse_ids]
        if active_only:
            clauses.append("is_active = TRUE")
        where_sql = " AND ".join(clauses)
        cur.execute(
            f"""
            SELECT id, name, address, is_active, created_at, updated_at
            FROM staff_branches
            WHERE {where_sql}
            ORDER BY name ASC
            """,
            params,
        )
        rows = cur.fetchall()
    return [branch_out_from_row(row) for row in rows]


@app.post("/staff/branches", response_model=BranchOut, status_code=201)
def create_branch(body: BranchIn, request: FastAPIRequest) -> BranchOut:
    require_admin(request)
    branch_id = uuid.uuid4()
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO staff_branches (id, name, address, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (branch_id, body.name.strip(), body.address.strip(), body.is_active, now, now),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail="branch create failed") from e
        cur.execute(
            "SELECT id, name, address, is_active, created_at, updated_at FROM staff_branches WHERE id = %s",
            (branch_id,),
        )
        row = cur.fetchone()
    assert row is not None
    return branch_out_from_row(row)


@app.put("/staff/branches/{branch_id}", response_model=BranchOut)
def update_branch(branch_id: uuid.UUID, body: BranchIn, request: FastAPIRequest) -> BranchOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE staff_branches
            SET name = %s, address = %s, is_active = %s, updated_at = %s
            WHERE id = %s
            RETURNING id, name, address, is_active, created_at, updated_at
            """,
            (body.name.strip(), body.address.strip(), body.is_active, utcnow(), branch_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="branch not found")
    return branch_out_from_row(row)


def _load_kpk_tree() -> list[KpkChapterTreeOut]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, chapter_no, title FROM staff_kpk_chapters ORDER BY chapter_no ASC"
        )
        chapters = cur.fetchall()
        out: list[KpkChapterTreeOut] = []
        for ch_id, ch_no, ch_title in chapters:
            cur.execute(
                """
                SELECT id, article_no, title FROM staff_kpk_articles
                WHERE chapter_id = %s
                ORDER BY article_no ASC
                """,
                (ch_id,),
            )
            arts_rows = cur.fetchall()
            articles_out: list[KpkArticleOut] = []
            for a_id, a_no, a_title in arts_rows:
                cur.execute(
                    """
                    SELECT id, point_no, description FROM staff_kpk_points
                    WHERE article_id = %s
                    ORDER BY point_no ASC
                    """,
                    (a_id,),
                )
                pts = [
                    KpkPointOut(id=r[0], point_no=int(r[1]), description=str(r[2] or "").strip())
                    for r in cur.fetchall()
                ]
                articles_out.append(
                    KpkArticleOut(
                        id=a_id,
                        article_no=int(a_no),
                        title=str(a_title or "").strip(),
                        points=pts,
                    )
                )
            out.append(
                KpkChapterTreeOut(
                    id=ch_id,
                    chapter_no=int(ch_no),
                    title=str(ch_title or "").strip(),
                    articles=articles_out,
                )
            )
        return out


@app.get("/staff/kpk", response_model=list[KpkChapterTreeOut])
def list_kpk_codex(request: FastAPIRequest) -> list[KpkChapterTreeOut]:
    require_user_uuid(request)
    return _load_kpk_tree()


@app.post("/staff/kpk/chapters", response_model=KpkChapterTreeOut, status_code=201)
def create_kpk_chapter(body: KpkChapterCreateIn, request: FastAPIRequest) -> KpkChapterTreeOut:
    require_admin(request)
    item_id = uuid.uuid4()
    now = utcnow()
    title = body.title.strip()
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO staff_kpk_chapters (id, chapter_no, title, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, chapter_no, title
                """,
                (item_id, int(body.chapter_no), title, now, now),
            )
        except UniqueViolation as exc:
            raise HTTPException(
                status_code=409,
                detail="Глава с таким номером уже существует",
            ) from exc
        row = cur.fetchone()
    assert row is not None
    return KpkChapterTreeOut(id=row[0], chapter_no=int(row[1]), title=str(row[2]), articles=[])


@app.put("/staff/kpk/chapters/{chapter_id}", response_model=KpkChapterTreeOut)
def update_kpk_chapter(
    chapter_id: uuid.UUID, body: KpkChapterUpdateIn, request: FastAPIRequest
) -> KpkChapterTreeOut:
    require_admin(request)
    title = body.title.strip()
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                UPDATE staff_kpk_chapters
                SET chapter_no = %s, title = %s, updated_at = %s
                WHERE id = %s
                RETURNING id, chapter_no, title
                """,
                (int(body.chapter_no), title, utcnow(), chapter_id),
            )
        except UniqueViolation as exc:
            raise HTTPException(
                status_code=409,
                detail="Глава с таким номером уже существует",
            ) from exc
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="chapter not found")
    return KpkChapterTreeOut(id=row[0], chapter_no=int(row[1]), title=str(row[2]), articles=[])


@app.delete("/staff/kpk/chapters/{chapter_id}", status_code=204)
def delete_kpk_chapter(chapter_id: uuid.UUID, request: FastAPIRequest) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM staff_kpk_chapters WHERE id = %s", (chapter_id,))
        if cur.rowcount <= 0:
            raise HTTPException(status_code=404, detail="chapter not found")


@app.post("/staff/kpk/articles", response_model=KpkArticleOut, status_code=201)
def create_kpk_article(body: KpkArticleCreateIn, request: FastAPIRequest) -> KpkArticleOut:
    require_admin(request)
    item_id = uuid.uuid4()
    now = utcnow()
    title = body.title.strip()
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM staff_kpk_chapters WHERE id = %s LIMIT 1", (body.chapter_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="chapter not found")
        try:
            cur.execute(
                """
                INSERT INTO staff_kpk_articles (id, chapter_id, article_no, title, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, article_no, title
                """,
                (item_id, body.chapter_id, int(body.article_no), title, now, now),
            )
        except UniqueViolation as exc:
            raise HTTPException(
                status_code=409,
                detail="В этой главе уже есть статья с таким номером",
            ) from exc
        row = cur.fetchone()
    assert row is not None
    return KpkArticleOut(id=row[0], article_no=int(row[1]), title=str(row[2]), points=[])


@app.put("/staff/kpk/articles/{article_id}", response_model=KpkArticleOut)
def update_kpk_article(
    article_id: uuid.UUID, body: KpkArticleUpdateIn, request: FastAPIRequest
) -> KpkArticleOut:
    require_admin(request)
    title = body.title.strip()
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                UPDATE staff_kpk_articles
                SET article_no = %s, title = %s, updated_at = %s
                WHERE id = %s
                RETURNING id, article_no, title
                """,
                (int(body.article_no), title, utcnow(), article_id),
            )
        except UniqueViolation as exc:
            raise HTTPException(
                status_code=409,
                detail="В этой главе уже есть статья с таким номером",
            ) from exc
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="article not found")
    return KpkArticleOut(id=row[0], article_no=int(row[1]), title=str(row[2]), points=[])


@app.delete("/staff/kpk/articles/{article_id}", status_code=204)
def delete_kpk_article(article_id: uuid.UUID, request: FastAPIRequest) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM staff_kpk_articles WHERE id = %s", (article_id,))
        if cur.rowcount <= 0:
            raise HTTPException(status_code=404, detail="article not found")


@app.post("/staff/kpk/points", response_model=KpkPointOut, status_code=201)
def create_kpk_point(body: KpkPointCreateIn, request: FastAPIRequest) -> KpkPointOut:
    require_admin(request)
    item_id = uuid.uuid4()
    now = utcnow()
    description = body.description.strip()
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM staff_kpk_articles WHERE id = %s LIMIT 1", (body.article_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="article not found")
        try:
            cur.execute(
                """
                INSERT INTO staff_kpk_points (id, article_id, point_no, description, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, point_no, description
                """,
                (item_id, body.article_id, int(body.point_no), description, now, now),
            )
        except UniqueViolation as exc:
            raise HTTPException(
                status_code=409,
                detail="В этой статье уже есть пункт с таким номером",
            ) from exc
        row = cur.fetchone()
    assert row is not None
    return KpkPointOut(id=row[0], point_no=int(row[1]), description=str(row[2]))


@app.put("/staff/kpk/points/{point_id}", response_model=KpkPointOut)
def update_kpk_point(point_id: uuid.UUID, body: KpkPointUpdateIn, request: FastAPIRequest) -> KpkPointOut:
    require_admin(request)
    description = body.description.strip()
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                UPDATE staff_kpk_points
                SET point_no = %s, description = %s, updated_at = %s
                WHERE id = %s
                RETURNING id, point_no, description
                """,
                (int(body.point_no), description, utcnow(), point_id),
            )
        except UniqueViolation as exc:
            raise HTTPException(
                status_code=409,
                detail="В этой статье уже есть пункт с таким номером",
            ) from exc
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="point not found")
    return KpkPointOut(id=row[0], point_no=int(row[1]), description=str(row[2]))


@app.delete("/staff/kpk/points/{point_id}", status_code=204)
def delete_kpk_point(point_id: uuid.UUID, request: FastAPIRequest) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM staff_kpk_points WHERE id = %s", (point_id,))
        if cur.rowcount <= 0:
            raise HTTPException(status_code=404, detail="point not found")


@app.get("/staff/schedules", response_model=list[ScheduleOut])
def list_schedules(
    request: FastAPIRequest,
    user_uuid: str | None = None,
    weekday: int | None = Query(default=None, ge=0, le=6),
    all_users: bool = False,
) -> list[ScheduleOut]:
    if all_users:
        require_admin(request)
        clauses = ["TRUE"]
        params: list[object] = []
    else:
        scoped_user_uuid = resolve_user_scope(request, user_uuid)
        clauses = ["user_uuid = %s"]
        params = [scoped_user_uuid]
    if weekday is not None:
        clauses.append("weekday = %s")
        params.append(weekday)
    where_sql = " AND ".join(clauses)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT s.id, s.user_uuid, s.branch_id, b.name, s.name, s.weekday, s.start_time, s.end_time, s.is_active, s.created_at, s.updated_at
            FROM staff_schedules s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            WHERE {where_sql}
            ORDER BY s.weekday ASC, s.start_time ASC, s.created_at ASC
            """,
            params,
        )
        rows = cur.fetchall()
    return [schedule_out_from_row(row) for row in rows]


@app.post("/staff/schedules", response_model=ScheduleOut, status_code=201)
def create_schedule(body: ScheduleIn, request: FastAPIRequest) -> ScheduleOut:
    require_admin(request)
    ensure_schedule_slot_available(body.user_uuid.strip(), body.weekday)
    schedule_id = uuid.uuid4()
    now = utcnow()
    start_time = parse_hhmm(body.start_time, "start_time")
    end_time = parse_hhmm(body.end_time, "end_time")
    branch_id = sync_branch_from_warehouse(body.branch_id, body.user_uuid.strip(), request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO staff_schedules (
              id, user_uuid, branch_id, name, weekday, start_time, end_time, is_active, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                schedule_id,
                body.user_uuid.strip(),
                branch_id,
                body.name.strip(),
                body.weekday,
                start_time,
                end_time,
                body.is_active,
                now,
                now,
            ),
        )
        row = cur.fetchone()
        cur.execute(
            """
            SELECT s.id, s.user_uuid, s.branch_id, b.name, s.name, s.weekday, s.start_time, s.end_time, s.is_active, s.created_at, s.updated_at
            FROM staff_schedules s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            WHERE s.id = %s
            """,
            (schedule_id,),
        )
        row = cur.fetchone()
    assert row is not None
    return schedule_out_from_row(row)


@app.put("/staff/schedules/{schedule_id}", response_model=ScheduleOut)
def update_schedule(schedule_id: uuid.UUID, body: ScheduleIn, request: FastAPIRequest) -> ScheduleOut:
    require_admin(request)
    ensure_schedule_slot_available(body.user_uuid.strip(), body.weekday, schedule_id)
    branch_id = sync_branch_from_warehouse(body.branch_id, body.user_uuid.strip(), request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE staff_schedules
            SET
              user_uuid = %s,
              branch_id = %s,
              name = %s,
              weekday = %s,
              start_time = %s,
              end_time = %s,
              is_active = %s,
              updated_at = %s
            WHERE id = %s
            RETURNING id
            """,
            (
                body.user_uuid.strip(),
                branch_id,
                body.name.strip(),
                body.weekday,
                parse_hhmm(body.start_time, "start_time"),
                parse_hhmm(body.end_time, "end_time"),
                body.is_active,
                utcnow(),
                schedule_id,
            ),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="schedule not found")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.user_uuid, s.branch_id, b.name, s.name, s.weekday, s.start_time, s.end_time, s.is_active, s.created_at, s.updated_at
            FROM staff_schedules s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            WHERE s.id = %s
            """,
            (schedule_id,),
        )
        row = cur.fetchone()
    return schedule_out_from_row(row)


@app.delete("/staff/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: uuid.UUID, request: FastAPIRequest) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM staff_schedules WHERE id = %s", (schedule_id,))
        if cur.rowcount <= 0:
            raise HTTPException(status_code=404, detail="schedule not found")


@app.get("/staff/attendance/me/status", response_model=AttendanceStatusOut)
def get_my_attendance_status(request: FastAPIRequest) -> AttendanceStatusOut:
    user_uuid = require_user_uuid(request)
    auto_close_midnight_open_sessions(user_uuid)
    auto_close_overdue_open_sessions(user_uuid)
    open_session = get_open_session(user_uuid)
    return AttendanceStatusOut(
        is_checked_in=bool(open_session),
        open_session=open_session,
        today_sessions=get_today_sessions(user_uuid),
    )


@app.post("/staff/attendance/check-in", response_model=AttendanceSessionOut, status_code=201)
def check_in(body: CheckInIn, request: FastAPIRequest) -> AttendanceSessionOut:
    user_uuid = require_user_uuid(request)
    auto_close_midnight_open_sessions(user_uuid)
    auto_close_overdue_open_sessions(user_uuid)
    existing_open_session = get_open_session(user_uuid)
    if existing_open_session:
        raise HTTPException(status_code=400, detail="open attendance session already exists")

    now = utcnow()
    branch_id = sync_branch_from_warehouse(body.branch_id, user_uuid, request)
    schedule_id: uuid.UUID | None = None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, branch_id
            FROM staff_schedules
            WHERE user_uuid = %s
              AND weekday = %s
              AND is_active = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_uuid, now.weekday()),
        )
        schedule_row = cur.fetchone()
        if schedule_row:
            schedule_id = schedule_row[0]
            if branch_id is None:
                branch_id = schedule_row[1]

        session_id = uuid.uuid4()
        cur.execute(
            """
            INSERT INTO attendance_sessions (
              id, user_uuid, branch_id, schedule_id, work_date, check_in_at, source, comment, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                session_id,
                user_uuid,
                branch_id,
                schedule_id,
                now.date(),
                now,
                body.source.strip(),
                body.comment.strip(),
                now,
                now,
            ),
        )
        cur.execute(
            """
            SELECT
              s.id,
              s.user_uuid,
              s.branch_id,
              b.name,
              s.schedule_id,
              s.work_date,
              s.check_in_at,
              s.check_out_at,
              s.source,
              s.comment,
              s.close_comment,
              s.closed_automatically,
              sc.end_time,
              EXTRACT(EPOCH FROM (NOW() - s.check_in_at)) / 60,
              s.created_at,
              s.updated_at
            FROM attendance_sessions s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE s.id = %s
            """,
            (session_id,),
        )
        row = cur.fetchone()
    assert row is not None
    return session_out_from_row(row)


@app.post("/staff/attendance/check-out", response_model=AttendanceSessionOut)
def check_out(body: CheckOutIn, request: FastAPIRequest) -> AttendanceSessionOut:
    user_uuid = require_user_uuid(request)
    auto_close_midnight_open_sessions(user_uuid)
    auto_close_overdue_open_sessions(user_uuid)
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.work_date, s.check_in_at, sc.end_time
            FROM attendance_sessions s
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE s.user_uuid = %s AND s.check_out_at IS NULL
            ORDER BY s.check_in_at DESC
            LIMIT 1
            """,
            (user_uuid,),
        )
        current_row = cur.fetchone()
        if not current_row:
            raise HTTPException(status_code=400, detail="open attendance session not found")
        scheduled_end_at = scheduled_end_at_from_parts(current_row[1], current_row[3], current_row[2])
        if scheduled_end_at is not None and now < scheduled_end_at and not body.comment.strip():
            raise HTTPException(status_code=400, detail="close comment is required for early checkout")

        cur.execute(
            """
            UPDATE attendance_sessions
            SET
              check_out_at = %s,
              close_comment = %s,
              closed_automatically = FALSE,
              updated_at = %s
            WHERE id = %s
            RETURNING id
            """,
            (now, body.comment.strip(), now, current_row[0]),
        )
        updated_row = cur.fetchone()
        if not updated_row:
            raise HTTPException(status_code=400, detail="open attendance session not found")
        cur.execute(
            """
            SELECT
              s.id,
              s.user_uuid,
              s.branch_id,
              b.name,
              s.schedule_id,
              s.work_date,
              s.check_in_at,
              s.check_out_at,
              s.source,
              s.comment,
              s.close_comment,
              s.closed_automatically,
              sc.end_time,
              EXTRACT(EPOCH FROM (COALESCE(s.check_out_at, NOW()) - s.check_in_at)) / 60,
              s.created_at,
              s.updated_at
            FROM attendance_sessions s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE s.id = %s
            """,
            (updated_row[0],),
        )
        row = cur.fetchone()
    assert row is not None
    return session_out_from_row(row)


@app.get("/staff/attendance/sessions", response_model=list[AttendanceSessionOut])
def list_attendance_sessions(
    request: FastAPIRequest,
    user_uuid: str | None = None,
    branch_id: uuid.UUID | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    open_only: bool = False,
    all_users: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AttendanceSessionOut]:
    if all_users:
        require_admin(request)
        auto_close_midnight_open_sessions()
        auto_close_overdue_open_sessions()
        clauses = ["TRUE"]
        params: list[object] = []
    else:
        scoped_user_uuid = resolve_user_scope(request, user_uuid)
        auto_close_midnight_open_sessions(scoped_user_uuid)
        auto_close_overdue_open_sessions(scoped_user_uuid)
        clauses = ["s.user_uuid = %s"]
        params = [scoped_user_uuid]
    parsed_from = parse_iso_date(from_date, "from_date")
    parsed_to = parse_iso_date(to_date, "to_date")
    if branch_id is not None:
        clauses.append("s.branch_id = %s")
        params.append(branch_id)
    if parsed_from is not None:
        clauses.append("s.work_date >= %s")
        params.append(parsed_from)
    if parsed_to is not None:
        clauses.append("s.work_date <= %s")
        params.append(parsed_to)
    if open_only:
        clauses.append("s.check_out_at IS NULL")
    where_sql = " AND ".join(clauses)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
              s.id,
              s.user_uuid,
              s.branch_id,
              b.name,
              s.schedule_id,
              s.work_date,
              s.check_in_at,
              s.check_out_at,
              s.source,
              s.comment,
              s.close_comment,
              s.closed_automatically,
              sc.end_time,
              EXTRACT(EPOCH FROM (COALESCE(s.check_out_at, NOW()) - s.check_in_at)) / 60,
              s.created_at,
              s.updated_at
            FROM attendance_sessions s
            LEFT JOIN staff_branches b ON b.id = s.branch_id
            LEFT JOIN staff_schedules sc ON sc.id = s.schedule_id
            WHERE {where_sql}
            ORDER BY s.check_in_at DESC
            LIMIT %s OFFSET %s
            """,
            [*params, limit, offset],
        )
        rows = cur.fetchall()
    return [session_out_from_row(row) for row in rows]


@app.get("/staff/analytics/summary", response_model=AnalyticsSummaryOut)
def analytics_summary(
    request: FastAPIRequest,
    user_uuid: str | None = None,
    branch_id: uuid.UUID | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    all_users: bool = False,
) -> AnalyticsSummaryOut:
    if all_users:
        require_admin(request)
        auto_close_midnight_open_sessions()
        auto_close_overdue_open_sessions()
        clauses = ["TRUE"]
        params: list[object] = []
    else:
        scoped_user_uuid = resolve_user_scope(request, user_uuid)
        auto_close_midnight_open_sessions(scoped_user_uuid)
        auto_close_overdue_open_sessions(scoped_user_uuid)
        clauses = ["user_uuid = %s"]
        params = [scoped_user_uuid]
    parsed_from = parse_iso_date(from_date, "from_date")
    parsed_to = parse_iso_date(to_date, "to_date")
    if branch_id is not None:
        clauses.append("branch_id = %s")
        params.append(branch_id)
    if parsed_from is not None:
        clauses.append("work_date >= %s")
        params.append(parsed_from)
    if parsed_to is not None:
        clauses.append("work_date <= %s")
        params.append(parsed_to)
    where_sql = " AND ".join(clauses)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
              COUNT(*)::int,
              COUNT(*) FILTER (WHERE check_out_at IS NULL)::int,
              COUNT(*) FILTER (WHERE check_out_at IS NOT NULL)::int,
              COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(check_out_at, NOW()) - check_in_at)) / 60), 0)::int
            FROM attendance_sessions
            WHERE {where_sql}
            """,
            params,
        )
        row = cur.fetchone()
    return AnalyticsSummaryOut(
        total_sessions=int(row[0] or 0),
        open_sessions=int(row[1] or 0),
        finished_sessions=int(row[2] or 0),
        total_worked_minutes=int(row[3] or 0),
    )


@app.get("/staff/attendance/sessions/{session_id}/issues", response_model=list[AttendanceSessionIssueOut])
def list_attendance_session_issues(
    session_id: uuid.UUID, request: FastAPIRequest, limit: int = Query(default=100, ge=1, le=500)
) -> list[AttendanceSessionIssueOut]:
    require_session_access(session_id, request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, session_id, issue_kind, reason, created_by_uuid, created_at
            FROM attendance_session_issue_history
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (session_id, limit),
        )
        rows = cur.fetchall()
    return [
        AttendanceSessionIssueOut(
            id=row[0],
            session_id=row[1],
            issue_kind=normalize_attendance_issue_kind(row[2]),
            reason=row[3],
            created_by_uuid=row[4],
            created_by_name=user_display_name_from_uuid(row[4]),
            created_at=row[5],
        )
        for row in rows
    ]


@app.post("/staff/attendance/sessions/{session_id}/issues", response_model=AttendanceSessionIssueOut, status_code=201)
def create_attendance_session_issue(
    session_id: uuid.UUID, payload: AttendanceSessionIssueCreateIn, request: FastAPIRequest
) -> AttendanceSessionIssueOut:
    require_session_access(session_id, request)
    created_by_uuid = require_user_uuid(request)
    issue_kind = payload.issue_kind
    reason = payload.reason.strip()
    if issue_kind == "problem" and not reason:
        raise HTTPException(status_code=400, detail="reason must not be empty for problem")
    if issue_kind == "resolved" and not reason:
        reason = "Проблема решена"
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO attendance_session_issue_history (id, session_id, issue_kind, reason, created_by_uuid, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, session_id, issue_kind, reason, created_by_uuid, created_at
            """,
            (uuid.uuid4(), session_id, issue_kind, reason, created_by_uuid, now),
        )
        row = cur.fetchone()
    assert row is not None
    return AttendanceSessionIssueOut(
        id=row[0],
        session_id=row[1],
        issue_kind=normalize_attendance_issue_kind(row[2]),
        reason=row[3],
        created_by_uuid=row[4],
        created_by_name=user_display_name_from_uuid(row[4]),
        created_at=row[5],
    )


@app.get("/staff/attendance/sessions/{session_id}/photos", response_model=list[AttendanceSessionPhotoOut])
def list_attendance_session_photos(
    session_id: uuid.UUID, request: FastAPIRequest, limit: int = Query(default=100, ge=1, le=200)
) -> list[AttendanceSessionPhotoOut]:
    require_session_access(session_id, request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, session_id, mime_type, content, created_by_uuid, created_at
            FROM attendance_session_photo_history
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (session_id, limit),
        )
        rows = cur.fetchall()
    return [
        AttendanceSessionPhotoOut(
            id=row[0],
            session_id=row[1],
            mime_type=str(row[2] or "").strip(),
            data_url=photo_data_url(str(row[2] or "").strip(), bytes(row[3] or b"")),
            created_by_uuid=row[4],
            created_by_name=user_display_name_from_uuid(row[4]),
            created_at=row[5],
        )
        for row in rows
    ]


@app.post("/staff/attendance/sessions/{session_id}/photos", response_model=AttendanceSessionPhotoOut, status_code=201)
def create_attendance_session_photo(
    session_id: uuid.UUID, payload: AttendanceSessionPhotoCreateIn, request: FastAPIRequest
) -> AttendanceSessionPhotoOut:
    require_session_access(session_id, request)
    created_by_uuid = require_user_uuid(request)
    mime_type, content = parse_photo_data_url(payload.data_url)
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO attendance_session_photo_history (id, session_id, mime_type, content, created_by_uuid, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, session_id, mime_type, content, created_by_uuid, created_at
            """,
            (uuid.uuid4(), session_id, mime_type, content, created_by_uuid, now),
        )
        row = cur.fetchone()
    assert row is not None
    return AttendanceSessionPhotoOut(
        id=row[0],
        session_id=row[1],
        mime_type=str(row[2] or "").strip(),
        data_url=photo_data_url(str(row[2] or "").strip(), bytes(row[3] or b"")),
        created_by_uuid=row[4],
        created_by_name=user_display_name_from_uuid(row[4]),
        created_at=row[5],
    )


@app.post("/staff/attendance/sessions/{session_id}/comments", response_model=AttendanceSessionCommentOut, status_code=201)
def create_attendance_session_comment(
    session_id: uuid.UUID, payload: AttendanceSessionCommentCreateIn, request: FastAPIRequest
) -> AttendanceSessionCommentOut:
    require_session_access(session_id, request)
    comment = payload.comment.strip()
    if not comment:
        raise HTTPException(status_code=400, detail="comment must not be empty")
    created_by_uuid = require_user_uuid(request)
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO attendance_session_comment_history (id, session_id, comment, created_by_uuid, created_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, session_id, comment, created_by_uuid, created_at
            """,
            (uuid.uuid4(), session_id, comment, created_by_uuid, now),
        )
        row = cur.fetchone()
    assert row is not None
    return AttendanceSessionCommentOut(
        id=row[0],
        session_id=row[1],
        comment=row[2],
        created_by_uuid=row[3],
        created_by_name=user_display_name_from_uuid(row[3]),
        created_at=row[4],
    )


@app.get("/staff/attendance/sessions/{session_id}/comments", response_model=list[AttendanceSessionCommentOut])
def list_attendance_session_comments(
    session_id: uuid.UUID, request: FastAPIRequest, limit: int = Query(default=100, ge=1, le=500)
) -> list[AttendanceSessionCommentOut]:
    require_session_access(session_id, request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, session_id, comment, created_by_uuid, created_at
            FROM attendance_session_comment_history
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (session_id, limit),
        )
        rows = cur.fetchall()
    return [
        AttendanceSessionCommentOut(
            id=row[0],
            session_id=row[1],
            comment=row[2],
            created_by_uuid=row[3],
            created_by_name=user_display_name_from_uuid(row[3]),
            created_at=row[4],
        )
        for row in rows
    ]


def violation_out_from_row(row: tuple) -> ViolationOut:
    return ViolationOut(
        id=row[0],
        user_uuid=row[1],
        user_name=user_display_name_from_uuid(row[1]),
        kpk_point_id=row[2],
        kpk_chapter_no=int(row[3]) if row[3] is not None else None,
        kpk_article_no=int(row[4]) if row[4] is not None else None,
        kpk_point_no=int(row[5]) if row[5] is not None else None,
        kpk_point_description=str(row[6]) if row[6] is not None else None,
        comment=row[7],
        created_by_uuid=row[8],
        created_by_name=user_display_name_from_uuid(row[8]),
        created_at=row[9],
        updated_at=row[10]
    )


@app.get("/staff/violations", response_model=list[ViolationOut])
def list_violations(
    request: FastAPIRequest,
    user_uuid: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[ViolationOut]:
    require_user_uuid(request)
    
    clauses = ["TRUE"]
    params: list[object] = []
    
    if user_uuid:
        clauses.append("v.user_uuid = %s")
        params.append(user_uuid)
    
    parsed_from = parse_iso_date(from_date, "from_date")
    parsed_to = parse_iso_date(to_date, "to_date")
    if parsed_from is not None:
        clauses.append("v.created_at >= %s")
        params.append(parsed_from)
    if parsed_to is not None:
        clauses.append("v.created_at < %s")
        params.append(parsed_to + timedelta(days=1))
        
    where_sql = " AND ".join(clauses)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT 
                v.id, 
                v.user_uuid, 
                v.kpk_point_id,
                ch.chapter_no,
                art.article_no,
                pt.point_no,
                pt.description as point_description,
                v.comment,
                v.created_by_uuid,
                v.created_at,
                v.updated_at
            FROM staff_violations v
            LEFT JOIN staff_kpk_points pt ON pt.id = v.kpk_point_id
            LEFT JOIN staff_kpk_articles art ON art.id = pt.article_id
            LEFT JOIN staff_kpk_chapters ch ON ch.id = art.chapter_id
            WHERE {where_sql}
            ORDER BY v.created_at DESC
            LIMIT %s OFFSET %s
            """,
            [*params, limit, offset],
        )
        rows = cur.fetchall()
    return [violation_out_from_row(row) for row in rows]


@app.post("/staff/violations", response_model=ViolationOut, status_code=201)
def create_violation(body: ViolationCreateIn, request: FastAPIRequest) -> ViolationOut:
    created_by_uuid = require_user_uuid(request)
    item_id = uuid.uuid4()
    now = utcnow()
    comment = body.comment.strip()
    
    with db() as conn, conn.cursor() as cur:
        if body.kpk_point_id is not None:
            cur.execute("SELECT 1 FROM staff_kpk_points WHERE id = %s LIMIT 1", (body.kpk_point_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=400, detail="kpk_point_id not found")
        
        cur.execute(
            """
            INSERT INTO staff_violations (
                id, user_uuid, kpk_point_id, comment, created_by_uuid, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                item_id,
                body.user_uuid.strip(),
                body.kpk_point_id,
                comment,
                created_by_uuid,
                now,
                now,
            )
        )
        
        cur.execute(
            """
            SELECT 
                v.id, 
                v.user_uuid, 
                v.kpk_point_id,
                ch.chapter_no,
                art.article_no,
                pt.point_no,
                pt.description as point_description,
                v.comment,
                v.created_by_uuid,
                v.created_at,
                v.updated_at
            FROM staff_violations v
            LEFT JOIN staff_kpk_points pt ON pt.id = v.kpk_point_id
            LEFT JOIN staff_kpk_articles art ON art.id = pt.article_id
            LEFT JOIN staff_kpk_chapters ch ON ch.id = art.chapter_id
            WHERE v.id = %s
            """,
            (item_id,),
        )
        row = cur.fetchone()
    assert row is not None
    return violation_out_from_row(row)
