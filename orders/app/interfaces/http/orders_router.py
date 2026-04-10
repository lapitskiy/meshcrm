import json
import os
from datetime import datetime
from datetime import date as dt_date
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.infrastructure.db.connection import get_connection

router = APIRouter(prefix="/orders", tags=["orders"])
KEYCLOAK_INTERNAL_URL = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")
WAREHOUSES_BASE_URL = os.getenv("WAREHOUSES_BASE_URL", "http://warehouses:8000")


class OrderCreateIn(BaseModel):
    order_kind: str = Field(min_length=1, max_length=50)
    service_category_id: UUID | None = None
    service_object_id: UUID | None = None
    serial_model: str = ""
    work_type_ids: list[UUID] = Field(default_factory=list)
    warehouse_id: UUID | None = None
    contact_uuid: UUID | None = None
    related_modules: dict = Field(default_factory=dict)
    status: str | None = Field(default=None, max_length=120)


class OrderOut(BaseModel):
    id: UUID
    order_number: int | None = None
    status: str
    order_kind: str
    service_category_id: UUID | None
    service_object_id: UUID | None
    serial_model: str
    work_type_ids: list[UUID]
    warehouse_id: UUID | None
    contact_uuid: UUID | None
    related_modules: dict
    created_by_uuid: str | None
    created_at: datetime
    issue_kind: Literal["return", "problem", "issued"] | None = None
    display_status: str | None = None
    status_selected_manually: bool = False


class OrderListOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class OrderStatusUpdateIn(BaseModel):
    status: str | None = Field(default=None, max_length=120)


class OrderStatusHistoryOut(BaseModel):
    status: str
    changed_at: datetime


class OrderDisplayStatusUpdateIn(BaseModel):
    display_status: str | None = Field(default=None, max_length=120)


class OrderIssueKindUpdateIn(BaseModel):
    issue_kind: Literal["return", "problem", "issued"] | None = None


class OrderIssueCreateIn(BaseModel):
    issue_kind: Literal["return", "problem"]
    reason: str = Field(min_length=1, max_length=4000)


class OrderIssueHistoryOut(BaseModel):
    id: UUID
    issue_kind: Literal["return", "problem"]
    reason: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: datetime


class OrderCreatorOut(BaseModel):
    user_uuid: str | None = None
    username: str = ""
    email: str = ""
    full_name: str = ""


class UserLiteOut(BaseModel):
    user_uuid: str
    username: str
    email: str
    full_name: str


def _normalize_status_value(raw_status: object) -> str:
    status = str(raw_status or "").strip()
    if not status:
        raise HTTPException(status_code=500, detail="order status is missing")
    return status


def _normalize_issue_kind(raw_issue_kind: object) -> Literal["return", "problem", "issued"] | None:
    issue_kind = str(raw_issue_kind or "").strip().lower()
    if not issue_kind:
        return None
    if issue_kind not in {"return", "problem", "issued"}:
        raise HTTPException(status_code=500, detail="order issue_kind is invalid")
    return issue_kind  # type: ignore[return-value]


def _display_status_for_order_kind(order_kind: str) -> str | None:
    kind = str(order_kind or "").strip().lower()
    if kind == "onsite":
        return "Выдано"
    if kind == "repair":
        return "Принят в ремонт"
    return None


def _normalize_display_status(raw_display_status: object) -> str | None:
    value = str(raw_display_status or "").strip()
    return value or None


def _order_out_from_row(row) -> OrderOut:
    return OrderOut(
        id=row[0],
        order_number=row[1],
        status=_normalize_status_value(row[2]),
        order_kind=row[3],
        service_category_id=row[4],
        service_object_id=row[5],
        serial_model=row[6] or "",
        work_type_ids=[UUID(str(x)) for x in (row[7] or [])],
        warehouse_id=row[8],
        contact_uuid=row[9],
        related_modules=row[10] or {},
        created_by_uuid=row[11],
        created_at=row[12],
        issue_kind=_normalize_issue_kind(row[13] if len(row) > 13 else None),
        display_status=_normalize_display_status(row[14] if len(row) > 14 else None),
        status_selected_manually=bool(row[15] if len(row) > 15 else False),
    )


def _ensure_status_exists(cur, status: str) -> None:
    cur.execute("SELECT 1 FROM statuses WHERE name = %s LIMIT 1", (status,))
    if cur.fetchone() is None:
        raise HTTPException(status_code=400, detail=f"status '{status}' does not exist in settings")


def _resolve_initial_status(cur, explicit_status: str | None) -> str:
    candidate = str(explicit_status or "").strip()
    if candidate:
        _ensure_status_exists(cur, candidate)
        return candidate
    cur.execute(
        """
        SELECT name
        FROM statuses
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=400, detail="statuses are not configured")
    return _normalize_status_value(row[0])


def _user_uuid_from_headers(request: Request) -> str | None:
    value = str(request.headers.get("x-user-uuid", "")).strip()
    return value or None


def _roles_from_headers(request: Request) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def _require_superadmin(request: Request) -> None:
    if "superadmin" in _roles_from_headers(request):
        return
    raise HTTPException(status_code=403, detail="forbidden: superadmin role required")


def _is_superadmin(request: Request) -> bool:
    return "superadmin" in _roles_from_headers(request)


def _require_user_uuid(request: Request) -> str:
    user_uuid = _user_uuid_from_headers(request)
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def _fetch_keycloak_user(user_uuid: str) -> dict:
    token = _keycloak_admin_token()
    req = UrlRequest(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_uuid}",
        headers={"authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def _user_display_name_from_uuid(user_uuid: str | None) -> str:
    uid = str(user_uuid or "").strip()
    if not uid:
        return ""
    try:
        payload = _fetch_keycloak_user(uid)
    except Exception:
        return uid
    return _user_lite_from_keycloak_payload(uid, payload).full_name


def _user_lite_from_keycloak_payload(user_uuid: str, payload: dict) -> UserLiteOut:
    first = str(payload.get("firstName") or "").strip()
    last = str(payload.get("lastName") or "").strip()
    full_name = (f"{first} {last}").strip() or str(payload.get("username") or "").strip() or user_uuid
    return UserLiteOut(
        user_uuid=user_uuid,
        username=str(payload.get("username") or "").strip(),
        email=str(payload.get("email") or "").strip(),
        full_name=full_name,
    )


def _fetch_accessible_warehouse_ids(request: Request) -> list[str]:
    user_uuid = _require_user_uuid(request)
    req = UrlRequest(
        f"{WAREHOUSES_BASE_URL}/warehouses/accessible",
        headers={
            "x-user-uuid": user_uuid,
            "x-user-roles": ",".join(sorted(_roles_from_headers(request))),
        },
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8") or "[]")
    out: list[str] = []
    for row in payload or []:
        warehouse_id = str((row or {}).get("id") or "").strip()
        if warehouse_id:
            out.append(warehouse_id)
    return out


def _keycloak_admin_token() -> str:
    data = urlencode(
        {
            "client_id": "admin-cli",
            "grant_type": "password",
            "username": KEYCLOAK_ADMIN_USER,
            "password": KEYCLOAK_ADMIN_PASSWORD,
        }
    ).encode()
    req = UrlRequest(
        f"{KEYCLOAK_INTERNAL_URL}/realms/master/protocol/openid-connect/token",
        data=data,
        headers={"content-type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(req, timeout=10) as resp:
        payload = resp.read().decode("utf-8")
    token = str((json.loads(payload) or {}).get("access_token") or "")
    if not token:
        raise HTTPException(status_code=502, detail="failed to get keycloak admin token")
    return token


@router.post("", response_model=OrderOut, status_code=201)
def create_order(payload: OrderCreateIn, request: Request) -> OrderOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            initial_status = _resolve_initial_status(cur, payload.status)
            display_status = _display_status_for_order_kind(payload.order_kind)
            cur.execute(
                """
                INSERT INTO orders (
                  id, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, status, display_status, status_selected_manually
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s, %s, %s, %s)
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                """,
                (
                    uuid4(),
                    payload.order_kind.strip(),
                    payload.service_category_id,
                    payload.service_object_id,
                    payload.serial_model.strip(),
                    json.dumps([str(x) for x in payload.work_type_ids]),
                    payload.warehouse_id,
                    payload.contact_uuid,
                    json.dumps(payload.related_modules or {}),
                    _user_uuid_from_headers(request),
                    initial_status,
                    display_status,
                    False,
                ),
            )
            row = cur.fetchone()
            cur.execute(
                """
                INSERT INTO order_status_history (id, order_id, status)
                VALUES (%s, %s, %s)
                """,
                (uuid4(), row[0], _normalize_status_value(row[2])),
            )
            if row[14]:
                cur.execute(
                    """
                    INSERT INTO order_status_history (id, order_id, status)
                    VALUES (%s, %s, %s)
                    """,
                    (uuid4(), row[0], str(row[14])),
                )
        conn.commit()
        return _order_out_from_row(row)
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{order_id}/status", response_model=OrderOut)
def update_order_status(order_id: UUID, payload: OrderStatusUpdateIn) -> OrderOut:
    conn = None
    try:
        next_status = str(payload.status or "").strip()
        conn = get_connection()
        with conn.cursor() as cur:
            if not next_status:
                cur.execute(
                    """
                    UPDATE orders
                    SET status_selected_manually = FALSE
                    WHERE id = %s
                    RETURNING
                      id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                      work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                    """,
                    (order_id,),
                )
                cleared_row = cur.fetchone()
                if cleared_row is None:
                    conn.rollback()
                    raise HTTPException(status_code=404, detail="order not found")
                conn.commit()
                return _order_out_from_row(cleared_row)
            _ensure_status_exists(cur, next_status)
            cur.execute("SELECT status FROM orders WHERE id = %s", (order_id,))
            current = cur.fetchone()
            if not current:
                conn.rollback()
                raise HTTPException(status_code=404, detail="order not found")
            current_status = _normalize_status_value(current[0])
            if current_status == next_status:
                cur.execute(
                    """
                    SELECT
                      id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                      work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                    FROM orders
                    WHERE id = %s
                    """,
                    (order_id,),
                )
                same_row = cur.fetchone()
                return _order_out_from_row(same_row)
            cur.execute(
                """
                UPDATE orders
                SET status = %s, status_selected_manually = TRUE
                WHERE id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                """,
                (next_status, order_id),
            )
            row = cur.fetchone()
            cur.execute(
                """
                INSERT INTO order_status_history (id, order_id, status)
                VALUES (%s, %s, %s)
                """,
                (uuid4(), order_id, next_status),
            )
        conn.commit()
        return _order_out_from_row(row)
    except HTTPException:
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/{order_id}/status-history", response_model=list[OrderStatusHistoryOut])
def list_order_status_history(order_id: UUID, limit: int = 30) -> list[OrderStatusHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 200))
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, changed_at
                FROM order_status_history
                WHERE order_id = %s
                ORDER BY changed_at DESC
                LIMIT %s
                """,
                (order_id, safe_limit),
            )
            rows = cur.fetchall()
        return [OrderStatusHistoryOut(status=row[0], changed_at=row[1]) for row in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("/{order_id}/issues", response_model=OrderIssueHistoryOut, status_code=201)
def create_order_issue(order_id: UUID, payload: OrderIssueCreateIn, request: Request) -> OrderIssueHistoryOut:
    conn = None
    try:
        reason = payload.reason.strip()
        if not reason:
            raise HTTPException(status_code=400, detail="reason must not be empty")
        user_uuid = _require_user_uuid(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s", (order_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute("UPDATE orders SET issue_kind = %s WHERE id = %s", (payload.issue_kind, order_id))
            cur.execute(
                """
                INSERT INTO order_issue_history (id, order_id, issue_kind, reason, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, issue_kind, reason, created_by_uuid, created_at
                """,
                (uuid4(), order_id, payload.issue_kind, reason, user_uuid),
            )
            row = cur.fetchone()
        conn.commit()
        return OrderIssueHistoryOut(
            id=row[0],
            issue_kind=_normalize_issue_kind(row[1]),
            reason=row[2],
            created_by_uuid=row[3],
            created_by_name=_user_display_name_from_uuid(row[3]),
            created_at=row[4],
        )
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{order_id}/issue-kind", response_model=OrderOut)
def update_order_issue_kind(order_id: UUID, payload: OrderIssueKindUpdateIn) -> OrderOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE orders
                SET issue_kind = %s
                WHERE id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                """,
                (payload.issue_kind, order_id),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="order not found")
        conn.commit()
        return _order_out_from_row(row)
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{order_id}/display-status", response_model=OrderOut)
def update_order_display_status(order_id: UUID, payload: OrderDisplayStatusUpdateIn) -> OrderOut:
    conn = None
    try:
        next_display_status = _normalize_display_status(payload.display_status)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT display_status FROM orders WHERE id = %s", (order_id,))
            current = cur.fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="order not found")
            current_display_status = _normalize_display_status(current[0])
            cur.execute(
                """
                UPDATE orders
                SET display_status = %s
                WHERE id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                """,
                (next_display_status, order_id),
            )
            row = cur.fetchone()
            if current_display_status != next_display_status and next_display_status:
                cur.execute(
                    """
                    INSERT INTO order_status_history (id, order_id, status)
                    VALUES (%s, %s, %s)
                    """,
                    (uuid4(), order_id, next_display_status),
                )
        conn.commit()
        return _order_out_from_row(row)
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except Exception as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/{order_id}/issues", response_model=list[OrderIssueHistoryOut])
def list_order_issues(order_id: UUID, limit: int = 100) -> list[OrderIssueHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 500))
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s", (order_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                SELECT id, issue_kind, reason, created_by_uuid, created_at
                FROM order_issue_history
                WHERE order_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (order_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            OrderIssueHistoryOut(
                id=row[0],
                issue_kind=_normalize_issue_kind(row[1]),
                reason=row[2],
                created_by_uuid=row[3],
                created_by_name=_user_display_name_from_uuid(row[3]),
                created_at=row[4],
            )
            for row in rows
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/{order_id}/creator", response_model=OrderCreatorOut)
def get_order_creator(order_id: UUID) -> OrderCreatorOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT created_by_uuid FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="order not found")
        user_uuid = str(row[0] or "").strip()
        if not user_uuid:
            return OrderCreatorOut(user_uuid=None, username="", email="", full_name="")
        payload = _fetch_keycloak_user(user_uuid)
        first = str(payload.get("firstName") or "").strip()
        last = str(payload.get("lastName") or "").strip()
        full_name = (f"{first} {last}").strip()
        return OrderCreatorOut(
            user_uuid=user_uuid,
            username=str(payload.get("username") or ""),
            email=str(payload.get("email") or ""),
            full_name=full_name,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/creators/search", response_model=list[UserLiteOut])
def search_creators(q: str, request: Request) -> list[UserLiteOut]:
    _require_superadmin(request)
    term = q.strip()
    if len(term) < 2:
        return []
    token = _keycloak_admin_token()
    req = UrlRequest(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users?search={term}&max=20",
        headers={"authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8") or "[]")
    out: list[UserLiteOut] = []
    for row in payload or []:
        user_uuid = str((row or {}).get("id") or "").strip()
        if not user_uuid:
            continue
        first = str((row or {}).get("firstName") or "").strip()
        last = str((row or {}).get("lastName") or "").strip()
        full_name = f"{first} {last}".strip() or str((row or {}).get("username") or "").strip() or user_uuid
        out.append(
            UserLiteOut(
                user_uuid=user_uuid,
                username=str((row or {}).get("username") or "").strip(),
                email=str((row or {}).get("email") or "").strip(),
                full_name=full_name,
            )
        )
    return out


@router.get("/creators/options", response_model=list[UserLiteOut])
def list_creator_options(request: Request, q: str | None = None) -> list[UserLiteOut]:
    _require_superadmin(request)
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT created_by_uuid
                FROM orders
                WHERE created_by_uuid IS NOT NULL
                  AND created_by_uuid <> ''
                ORDER BY created_by_uuid
                """
            )
            rows = cur.fetchall()
        term = str(q or "").strip().lower()
        out: list[UserLiteOut] = []
        for row in rows:
            user_uuid = str(row[0] or "").strip()
            if not user_uuid:
                continue
            try:
                payload = _fetch_keycloak_user(user_uuid)
            except Exception:
                continue
            item = _user_lite_from_keycloak_payload(user_uuid, payload)
            haystack = f"{item.full_name} {item.username} {item.email}".lower()
            if term and term not in haystack:
                continue
            out.append(item)
        out.sort(key=lambda item: (item.full_name.lower(), item.email.lower(), item.username.lower()))
        return out[:50]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("", response_model=OrderListOut)
def list_orders(
    request: Request,
    page: int = 1,
    page_size: int = 20,
    order_kind: str | None = None,
    service_category_id: UUID | None = None,
    work_type_id: UUID | None = None,
    warehouse_id: UUID | None = None,
    created_by_uuid: str | None = None,
    search: str | None = None,
    created_from: str | None = None,  # YYYY-MM-DD
    created_to: str | None = None,  # YYYY-MM-DD
) -> OrderListOut:
    conn = None
    try:
        safe_page = max(1, int(page))
        safe_page_size = max(1, min(int(page_size), 100))
        offset = (safe_page - 1) * safe_page_size
        where_parts: list[str] = []
        params: list = []

        if not _is_superadmin(request):
            user_uuid = _require_user_uuid(request)
            accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
            if not accessible_warehouse_ids:
                where_parts.append("FALSE")
            else:
                where_parts.append("o.warehouse_id IS NOT NULL")
                where_parts.append("o.warehouse_id = ANY(%s::uuid[])")
                params.append(accessible_warehouse_ids)
            where_parts.append(
                """
                EXISTS (
                    SELECT 1
                    FROM service_category_access sca
                    WHERE sca.service_category_id = o.service_category_id
                      AND sca.user_uuid = %s
                )
                """
            )
            params.append(user_uuid)

        if order_kind and str(order_kind).strip():
            where_parts.append("o.order_kind = %s")
            params.append(str(order_kind).strip())
        if service_category_id:
            where_parts.append("o.service_category_id = %s")
            params.append(service_category_id)
        if work_type_id:
            where_parts.append(
                """
                EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(o.work_type_ids, '[]'::jsonb)) AS wt(value)
                    WHERE wt.value::uuid = %s
                )
                """
            )
            params.append(work_type_id)
        if warehouse_id:
            where_parts.append("o.warehouse_id = %s")
            params.append(warehouse_id)
        if created_by_uuid and str(created_by_uuid).strip():
            _require_superadmin(request)
            where_parts.append("o.created_by_uuid = %s")
            params.append(str(created_by_uuid).strip())
        if search and str(search).strip():
            term = f"%{str(search).strip()}%"
            where_parts.append(
                """
                (
                    CAST(o.order_number AS TEXT) ILIKE %s
                    OR o.serial_model ILIKE %s
                    OR COALESCE(o.related_modules::text, '') ILIKE %s
                    OR EXISTS (
                        SELECT 1
                        FROM service_objects so
                        WHERE so.id = o.service_object_id
                          AND so.name ILIKE %s
                    )
                )
                """
            )
            params.extend([term, term, term, term])

        if created_from and str(created_from).strip():
            try:
                dt_date.fromisoformat(str(created_from).strip())
            except Exception as exc:
                raise HTTPException(status_code=400, detail="created_from must be YYYY-MM-DD") from exc
            where_parts.append("o.created_at >= (%s::date)")
            params.append(str(created_from).strip())

        if created_to and str(created_to).strip():
            try:
                dt_date.fromisoformat(str(created_to).strip())
            except Exception as exc:
                raise HTTPException(status_code=400, detail="created_to must be YYYY-MM-DD") from exc
            # inclusive date: created_at < (created_to + 1 day)
            where_parts.append("o.created_at < ((%s::date) + INTERVAL '1 day')")
            params.append(str(created_to).strip())

        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM orders o {where_sql}", tuple(params))
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                """
                SELECT
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually
                FROM orders o
                """
                + where_sql
                + """
                ORDER BY o.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [safe_page_size, offset]),
            )
            rows = cur.fetchall()
        items = [
            _order_out_from_row(row)
            for row in rows
        ]
        total_pages = (total + safe_page_size - 1) // safe_page_size if total else 1
        return OrderListOut(
            items=items,
            total=total,
            page=safe_page,
            page_size=safe_page_size,
            total_pages=total_pages,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()
