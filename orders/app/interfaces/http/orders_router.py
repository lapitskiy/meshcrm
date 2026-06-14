import base64
import binascii
import json
import os
import re
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
    receipt_issued: bool = False


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
    created_by_name: str = ""
    created_at: datetime
    issue_kind: Literal["return", "problem", "issued"] | None = None
    display_status: str | None = None
    status_selected_manually: bool = False
    receipt_issued: bool = False
    active_callback_date: dt_date | None = None


class OrderListOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class OrderStatusUpdateIn(BaseModel):
    status: str | None = Field(default=None, max_length=120)


class OrderWarehouseUpdateIn(BaseModel):
    warehouse_id: UUID


class OrderServiceObjectUpdateIn(BaseModel):
    service_object_id: UUID


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


class OrderCommentCreateIn(BaseModel):
    comment: str = Field(min_length=1, max_length=4000)


class OrderCommentHistoryOut(BaseModel):
    id: UUID
    comment: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: datetime


class OrderPhotoCreateIn(BaseModel):
    data_url: str = Field(min_length=1, max_length=12_000_000)


class OrderPhotoHistoryOut(BaseModel):
    id: UUID
    mime_type: str
    data_url: str
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


class MonthlyOrdersPointOut(BaseModel):
    month: str
    label: str
    orders_count: int


class MonthlyOrdersChartOut(BaseModel):
    items: list[MonthlyOrdersPointOut]


class MonthlyOrdersByKindPointOut(BaseModel):
    month: str
    label: str
    onsite_count: int
    repair_count: int


class MonthlyOrdersByKindChartOut(BaseModel):
    items: list[MonthlyOrdersByKindPointOut]


class ProblemOrdersStatsOut(BaseModel):
    problem_orders_count: int = 0


class TenantBackfillOut(BaseModel):
    tenant_id: str
    updated: dict[str, int]


class ProblemOrderReminderOut(BaseModel):
    order_id: UUID
    order_number: int | None = None
    serial_model: str = ""
    warehouse_id: UUID | None = None
    created_by_uuid: str | None = None
    problem_since: datetime
    days_overdue: int = 0


class OrderCallbackReminderCreateIn(BaseModel):
    callback_date: dt_date


class OrderCallbackCompleteIn(BaseModel):
    comment: str = Field(default="", max_length=4000)


class OrderCallbackReminderOut(BaseModel):
    id: UUID
    order_id: UUID
    order_number: int | None = None
    serial_model: str = ""
    callback_date: dt_date
    created_by_uuid: str | None = None
    created_at: datetime


class OrderCallbackCompleteOut(BaseModel):
    order: OrderOut
    comment_entry: OrderCommentHistoryOut


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


def _photo_data_url(mime_type: str, content: bytes) -> str:
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _parse_photo_data_url(raw_value: str) -> tuple[str, bytes]:
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


def _order_out_from_row(row, created_by_name: str | None = None) -> OrderOut:
    creator_name = created_by_name
    if creator_name is None:
        creator_name = _user_display_name_from_uuid(row[11])
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
        created_by_name=str(creator_name or "").strip(),
        created_at=row[12],
        issue_kind=_normalize_issue_kind(row[13] if len(row) > 13 else None),
        display_status=_normalize_display_status(row[14] if len(row) > 14 else None),
        status_selected_manually=bool(row[15] if len(row) > 15 else False),
        receipt_issued=bool(row[16] if len(row) > 16 else False),
        active_callback_date=row[17] if len(row) > 17 else None,
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


def _require_tenant_id(request: Request) -> str:
    tenant_id = str(request.headers.get("x-tenant-id", "")).strip()
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing x-tenant-id")
    try:
        UUID(tenant_id)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="invalid x-tenant-id") from exc
    return tenant_id


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


def _is_admin(request: Request) -> bool:
    return bool(_roles_from_headers(request).intersection({"admin", "superadmin"}))


def _shift_month_start(value: dt_date, months: int) -> dt_date:
    total_months = (value.year * 12 + (value.month - 1)) + months
    year = total_months // 12
    month = total_months % 12 + 1
    return dt_date(year, month, 1)


def _require_user_uuid(request: Request) -> str:
    user_uuid = _user_uuid_from_headers(request)
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def _count_problem_orders_for_creator(cur, tenant_id: str, user_uuid: str) -> int:
    cur.execute(
        """
        SELECT COUNT(*)
        FROM orders o
        WHERE o.tenant_id = %s
          AND o.created_by_uuid = %s
          AND o.issue_kind IN ('problem', 'return')
        """,
        (tenant_id, user_uuid),
    )
    row = cur.fetchone()
    return int((row or [0])[0] or 0)


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


def _user_display_names_by_uuid(user_uuids: list[str | None]) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_uid in user_uuids:
        uid = str(raw_uid or "").strip()
        if uid and uid not in result:
            result[uid] = _user_display_name_from_uuid(uid)
    return result


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
    tenant_id = _require_tenant_id(request)
    req = UrlRequest(
        f"{WAREHOUSES_BASE_URL}/warehouses/accessible",
        headers={
            "x-user-uuid": user_uuid,
            "x-user-roles": ",".join(sorted(_roles_from_headers(request))),
            "x-tenant-id": tenant_id,
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


def _ensure_order_update_access(cur, request: Request, order_id: UUID, accessible_warehouse_ids: list[str]) -> None:
    tenant_id = _require_tenant_id(request)
    if _is_superadmin(request):
        cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="order not found")
        return
    user_uuid = _require_user_uuid(request)
    cur.execute(
        """
        SELECT 1
        FROM orders o
        WHERE o.id = %s
          AND o.tenant_id = %s
          AND o.warehouse_id IS NOT NULL
          AND o.warehouse_id = ANY(%s::uuid[])
          AND EXISTS (
              SELECT 1
              FROM service_category_access sca
              WHERE sca.service_category_id = o.service_category_id
                AND sca.user_uuid = %s
          )
        """,
        (order_id, tenant_id, accessible_warehouse_ids, user_uuid),
    )
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail="order not found")


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


@router.post("/tenant/backfill", response_model=TenantBackfillOut)
def backfill_legacy_orders_tenant(request: Request) -> TenantBackfillOut:
    if not _is_admin(request):
        raise HTTPException(status_code=403, detail="forbidden: admin role required")
    tenant_id = _require_tenant_id(request)
    conn = None
    try:
        conn = get_connection()
        updated: dict[str, int] = {}
        with conn.cursor() as cur:
            statements = [
                ("orders", "UPDATE orders SET tenant_id = %s WHERE NULLIF(tenant_id, '') IS NULL", (tenant_id,)),
                ("order_status_history", """
                    UPDATE order_status_history h SET tenant_id = o.tenant_id
                    FROM orders o WHERE h.order_id = o.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("order_issue_history", """
                    UPDATE order_issue_history h SET tenant_id = o.tenant_id
                    FROM orders o WHERE h.order_id = o.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("order_comment_history", """
                    UPDATE order_comment_history h SET tenant_id = o.tenant_id
                    FROM orders o WHERE h.order_id = o.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("order_photo_history", """
                    UPDATE order_photo_history h SET tenant_id = o.tenant_id
                    FROM orders o WHERE h.order_id = o.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("order_callback_reminders", """
                    UPDATE order_callback_reminders h SET tenant_id = o.tenant_id
                    FROM orders o WHERE h.order_id = o.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("supply_requests", """
                    UPDATE supply_requests sr SET tenant_id = o.tenant_id
                    FROM orders o WHERE sr.order_id = o.id AND NULLIF(sr.tenant_id, '') IS NULL
                """, ()),
                ("supply_request_photos", """
                    UPDATE supply_request_photos h SET tenant_id = sr.tenant_id
                    FROM supply_requests sr WHERE h.supply_request_id = sr.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("supply_request_status_history", """
                    UPDATE supply_request_status_history h SET tenant_id = sr.tenant_id
                    FROM supply_requests sr WHERE h.supply_request_id = sr.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("supply_request_comment_history", """
                    UPDATE supply_request_comment_history h SET tenant_id = sr.tenant_id
                    FROM supply_requests sr WHERE h.supply_request_id = sr.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("order_reports", "UPDATE order_reports SET tenant_id = %s WHERE NULLIF(tenant_id, '') IS NULL", (tenant_id,)),
                ("order_report_lines", """
                    UPDATE order_report_lines l SET tenant_id = r.tenant_id
                    FROM order_reports r WHERE l.report_id = r.id AND NULLIF(l.tenant_id, '') IS NULL
                """, ()),
                ("order_report_issue_history", """
                    UPDATE order_report_issue_history h SET tenant_id = r.tenant_id
                    FROM order_reports r WHERE h.report_id = r.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
                ("order_report_comment_history", """
                    UPDATE order_report_comment_history h SET tenant_id = r.tenant_id
                    FROM order_reports r WHERE h.report_id = r.id AND NULLIF(h.tenant_id, '') IS NULL
                """, ()),
            ]
            for table_name, sql, params in statements:
                cur.execute(sql, params)
                updated[table_name] = int(cur.rowcount or 0)
        conn.commit()
        return TenantBackfillOut(tenant_id=tenant_id, updated=updated)
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


@router.post("", response_model=OrderOut, status_code=201)
def create_order(payload: OrderCreateIn, request: Request) -> OrderOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            tenant_id = _require_tenant_id(request)
            initial_status = _resolve_initial_status(cur, payload.status)
            display_status = _display_status_for_order_kind(payload.order_kind)
            issue_kind = "problem" if not payload.receipt_issued else None
            created_by_uuid = _require_user_uuid(request)
            cur.execute(
                """
                INSERT INTO orders (
                  tenant_id,
                  id, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, status, issue_kind, display_status, status_selected_manually, receipt_issued
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (
                    tenant_id,
                    uuid4(),
                    payload.order_kind.strip(),
                    payload.service_category_id,
                    payload.service_object_id,
                    payload.serial_model.strip(),
                    json.dumps([str(x) for x in payload.work_type_ids]),
                    payload.warehouse_id,
                    payload.contact_uuid,
                    json.dumps(payload.related_modules or {}),
                    created_by_uuid,
                    initial_status,
                    issue_kind,
                    display_status,
                    False,
                    payload.receipt_issued,
                ),
            )
            row = cur.fetchone()
            if payload.service_object_id is not None:
                cur.execute(
                    "UPDATE service_objects SET usage_count = usage_count + 1 WHERE id = %s",
                    (payload.service_object_id,),
                )
            used_work_type_ids = list(dict.fromkeys(payload.work_type_ids))
            if used_work_type_ids:
                cur.execute(
                    "UPDATE work_types SET usage_count = usage_count + 1 WHERE id = ANY(%s)",
                    (used_work_type_ids,),
                )
            if row[16]:
                cur.execute(
                    """
                    INSERT INTO order_status_history (tenant_id, id, order_id, status)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), row[0], "Квитанция выдана"),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO order_issue_history (tenant_id, id, order_id, issue_kind, reason, created_by_uuid)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), row[0], "problem", "Квитанция не выдана", created_by_uuid),
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
def update_order_status(order_id: UUID, payload: OrderStatusUpdateIn, request: Request) -> OrderOut:
    conn = None
    try:
        next_status = str(payload.status or "").strip()
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            if not next_status:
                cur.execute(
                    """
                    UPDATE orders
                    SET status_selected_manually = FALSE
                    WHERE id = %s AND tenant_id = %s
                    RETURNING
                      id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                      work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                    """,
                    (order_id, tenant_id),
                )
                cleared_row = cur.fetchone()
                if cleared_row is None:
                    conn.rollback()
                    raise HTTPException(status_code=404, detail="order not found")
                conn.commit()
                return _order_out_from_row(cleared_row)
            _ensure_status_exists(cur, next_status)
            cur.execute("SELECT status FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            current = cur.fetchone()
            if not current:
                conn.rollback()
                raise HTTPException(status_code=404, detail="order not found")
            current_status = _normalize_status_value(current[0])
            if current_status == next_status:
                cur.execute(
                    """
                    UPDATE orders
                    SET status_selected_manually = TRUE
                    WHERE id = %s AND tenant_id = %s
                    RETURNING
                      id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                      work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                    """,
                    (order_id, tenant_id),
                )
                same_row = cur.fetchone()
                conn.commit()
                return _order_out_from_row(same_row)
            cur.execute(
                """
                UPDATE orders
                SET status = %s, status_selected_manually = TRUE
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (next_status, order_id, tenant_id),
            )
            row = cur.fetchone()
            if row is None:
                conn.rollback()
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                INSERT INTO order_status_history (tenant_id, id, order_id, status)
                VALUES (%s, %s, %s, %s)
                """,
                (tenant_id, uuid4(), order_id, next_status),
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


@router.put("/{order_id}/warehouse", response_model=OrderOut)
def update_order_warehouse(order_id: UUID, payload: OrderWarehouseUpdateIn, request: Request) -> OrderOut:
    conn = None
    try:
        accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
        if str(payload.warehouse_id) not in {str(x) for x in accessible_warehouse_ids}:
            raise HTTPException(status_code=403, detail="forbidden for selected warehouse")
        conn = get_connection()
        with conn.cursor() as cur:
            tenant_id = _require_tenant_id(request)
            _ensure_order_update_access(cur, request, order_id, accessible_warehouse_ids)
            cur.execute(
                """
                UPDATE orders
                SET warehouse_id = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (payload.warehouse_id, order_id, tenant_id),
            )
            row = cur.fetchone()
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


@router.put("/{order_id}/service-object", response_model=OrderOut)
def update_order_service_object(order_id: UUID, payload: OrderServiceObjectUpdateIn, request: Request) -> OrderOut:
    if not _is_admin(request):
        raise HTTPException(status_code=403, detail="forbidden: admin role required")
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            tenant_id = _require_tenant_id(request)
            cur.execute(
                "SELECT service_category_id, service_object_id FROM orders WHERE id = %s AND tenant_id = %s",
                (order_id, tenant_id),
            )
            order_row = cur.fetchone()
            if order_row is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                "SELECT 1 FROM service_objects WHERE id = %s AND service_category_id = %s",
                (payload.service_object_id, order_row[0]),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=400, detail="service object is not available for order category")
            previous_service_object_id = order_row[1]
            cur.execute(
                """
                UPDATE orders
                SET service_object_id = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (payload.service_object_id, order_id, tenant_id),
            )
            row = cur.fetchone()
            if previous_service_object_id != payload.service_object_id:
                if previous_service_object_id is not None:
                    cur.execute(
                        "UPDATE service_objects SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = %s",
                        (previous_service_object_id,),
                    )
                cur.execute(
                    "UPDATE service_objects SET usage_count = usage_count + 1 WHERE id = %s",
                    (payload.service_object_id,),
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


@router.get("/{order_id}/status-history", response_model=list[OrderStatusHistoryOut])
def list_order_status_history(order_id: UUID, request: Request, limit: int = 30) -> list[OrderStatusHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 200))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, changed_at
                FROM order_status_history
                WHERE order_id = %s AND tenant_id = %s
                ORDER BY changed_at DESC
                LIMIT %s
                """,
                (order_id, tenant_id, safe_limit),
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
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute("UPDATE orders SET issue_kind = %s WHERE id = %s AND tenant_id = %s", (payload.issue_kind, order_id, tenant_id))
            cur.execute(
                """
                INSERT INTO order_issue_history (tenant_id, id, order_id, issue_kind, reason, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, issue_kind, reason, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), order_id, payload.issue_kind, reason, user_uuid),
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


@router.post("/{order_id}/callback-reminders", response_model=OrderCallbackReminderOut, status_code=201)
def create_order_callback_reminder(
    order_id: UUID,
    payload: OrderCallbackReminderCreateIn,
    request: Request,
) -> OrderCallbackReminderOut:
    conn = None
    try:
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        reminder_text = f"Связаться: позвонить {payload.callback_date.strftime('%d.%m.%Y')}"
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute("UPDATE order_callback_reminders SET active = FALSE WHERE order_id = %s AND tenant_id = %s AND active = TRUE", (order_id, tenant_id))
            cur.execute("UPDATE orders SET issue_kind = 'problem' WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            cur.execute(
                """
                INSERT INTO order_issue_history (tenant_id, id, order_id, issue_kind, reason, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (tenant_id, uuid4(), order_id, "problem", reminder_text, user_uuid),
            )
            cur.execute(
                """
                INSERT INTO order_callback_reminders (tenant_id, id, order_id, callback_date, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, order_id, callback_date, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), order_id, payload.callback_date, user_uuid),
            )
            row = cur.fetchone()
            cur.execute("SELECT order_number, serial_model FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            order_row = cur.fetchone()
        conn.commit()
        return OrderCallbackReminderOut(
            id=row[0],
            order_id=row[1],
            order_number=order_row[0] if order_row else None,
            serial_model=str((order_row or ["", ""])[1] or "").strip(),
            callback_date=row[2],
            created_by_uuid=row[3],
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


@router.get("/callback-reminders/due", response_model=list[OrderCallbackReminderOut])
def list_due_order_callback_reminders(request: Request, limit: int = 20) -> list[OrderCallbackReminderOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 1000))
        tenant_id = _require_tenant_id(request)
        where_parts = ["o.tenant_id = %s", "ocr.tenant_id = %s", "ocr.active = TRUE", "ocr.callback_date <= CURRENT_DATE"]
        params: list = [tenant_id, tenant_id]
        if not _is_admin(request):
            user_uuid = _require_user_uuid(request)
            where_parts.append("o.created_by_uuid = %s")
            params.append(user_uuid)
        where_sql = f"WHERE {' AND '.join(where_parts)}"
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ocr.id, ocr.order_id, o.order_number, o.serial_model,
                       ocr.callback_date, ocr.created_by_uuid, ocr.created_at
                FROM order_callback_reminders ocr
                JOIN orders o ON o.id = ocr.order_id
                """
                + where_sql
                + """
                ORDER BY ocr.callback_date ASC, o.order_number ASC NULLS LAST
                LIMIT %s
                """,
                tuple(params + [safe_limit]),
            )
            rows = cur.fetchall()
        return [
            OrderCallbackReminderOut(
                id=row[0],
                order_id=row[1],
                order_number=row[2],
                serial_model=str(row[3] or "").strip(),
                callback_date=row[4],
                created_by_uuid=row[5],
                created_at=row[6],
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


@router.post("/{order_id}/callback-complete", response_model=OrderCallbackCompleteOut)
def complete_order_callback(order_id: UUID, payload: OrderCallbackCompleteIn, request: Request) -> OrderCallbackCompleteOut:
    conn = None
    try:
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        extra_comment = str(payload.comment or "").strip()
        final_comment = "Отзвонились"
        if extra_comment:
            final_comment = f"{final_comment}. {extra_comment}"
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM order_callback_reminders WHERE order_id = %s AND tenant_id = %s AND active = TRUE LIMIT 1",
                (order_id, tenant_id),
            )
            has_active_callback = cur.fetchone() is not None
            cur.execute(
                """
                UPDATE orders
                SET
                  status_selected_manually = FALSE,
                  issue_kind = CASE
                    WHEN %s AND issue_kind = 'problem' THEN NULL
                    ELSE issue_kind
                  END
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (has_active_callback, order_id, tenant_id),
            )
            order_row = cur.fetchone()
            if order_row is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute("UPDATE order_callback_reminders SET active = FALSE WHERE order_id = %s AND tenant_id = %s AND active = TRUE", (order_id, tenant_id))
            cur.execute(
                """
                INSERT INTO order_comment_history (tenant_id, id, order_id, comment, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, comment, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), order_id, final_comment, user_uuid),
            )
            comment_row = cur.fetchone()
        conn.commit()
        return OrderCallbackCompleteOut(
            order=_order_out_from_row(order_row),
            comment_entry=OrderCommentHistoryOut(
                id=comment_row[0],
                comment=comment_row[1],
                created_by_uuid=comment_row[2],
                created_by_name=_user_display_name_from_uuid(comment_row[2]),
                created_at=comment_row[3],
            ),
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
def update_order_issue_kind(order_id: UUID, payload: OrderIssueKindUpdateIn, request: Request) -> OrderOut:
    conn = None
    try:
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT issue_kind FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            current = cur.fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="order not found")
            current_issue_kind = _normalize_issue_kind(current[0])
            if current_issue_kind == "problem" and payload.issue_kind is None and not _is_admin(request):
                raise HTTPException(status_code=403, detail="forbidden: admin role required")
            cur.execute(
                """
                UPDATE orders
                SET issue_kind = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (payload.issue_kind, order_id, tenant_id),
            )
            row = cur.fetchone()
            if payload.issue_kind == "problem" and current_issue_kind != "problem":
                cur.execute(
                    """
                    INSERT INTO order_issue_history (tenant_id, id, order_id, issue_kind, reason, created_by_uuid)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), order_id, "problem", "Проблема отмечена", user_uuid),
                )
            if current_issue_kind in {"problem", "return"} and payload.issue_kind is None:
                cur.execute("UPDATE order_callback_reminders SET active = FALSE WHERE order_id = %s AND tenant_id = %s AND active = TRUE", (order_id, tenant_id))
                cur.execute(
                    """
                    INSERT INTO order_status_history (tenant_id, id, order_id, status)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), order_id, "Проблема снята"),
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


@router.put("/{order_id}/display-status", response_model=OrderOut)
def update_order_display_status(order_id: UUID, payload: OrderDisplayStatusUpdateIn, request: Request) -> OrderOut:
    conn = None
    try:
        next_display_status = _normalize_display_status(payload.display_status)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT display_status FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            current = cur.fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="order not found")
            current_display_status = _normalize_display_status(current[0])
            cur.execute(
                """
                UPDATE orders
                SET display_status = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued
                """,
                (next_display_status, order_id, tenant_id),
            )
            row = cur.fetchone()
            if current_display_status != next_display_status and next_display_status:
                cur.execute(
                    """
                    INSERT INTO order_status_history (tenant_id, id, order_id, status)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), order_id, next_display_status),
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
def list_order_issues(order_id: UUID, request: Request, limit: int = 100) -> list[OrderIssueHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 500))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                SELECT id, issue_kind, reason, created_by_uuid, created_at
                FROM order_issue_history
                WHERE order_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (order_id, tenant_id, safe_limit),
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


@router.post("/{order_id}/comments", response_model=OrderCommentHistoryOut, status_code=201)
def create_order_comment(order_id: UUID, payload: OrderCommentCreateIn, request: Request) -> OrderCommentHistoryOut:
    conn = None
    try:
        comment = payload.comment.strip()
        if not comment:
            raise HTTPException(status_code=400, detail="comment must not be empty")
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                INSERT INTO order_comment_history (tenant_id, id, order_id, comment, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, comment, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), order_id, comment, user_uuid),
            )
            row = cur.fetchone()
        conn.commit()
        return OrderCommentHistoryOut(
            id=row[0],
            comment=row[1],
            created_by_uuid=row[2],
            created_by_name=_user_display_name_from_uuid(row[2]),
            created_at=row[3],
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


@router.get("/{order_id}/comments", response_model=list[OrderCommentHistoryOut])
def list_order_comments(order_id: UUID, request: Request, limit: int = 100) -> list[OrderCommentHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 500))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                SELECT id, comment, created_by_uuid, created_at
                FROM order_comment_history
                WHERE order_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (order_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            OrderCommentHistoryOut(
                id=row[0],
                comment=row[1],
                created_by_uuid=row[2],
                created_by_name=_user_display_name_from_uuid(row[2]),
                created_at=row[3],
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


@router.post("/{order_id}/photos", response_model=OrderPhotoHistoryOut, status_code=201)
def create_order_photo(order_id: UUID, payload: OrderPhotoCreateIn, request: Request) -> OrderPhotoHistoryOut:
    conn = None
    try:
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        mime_type, content = _parse_photo_data_url(payload.data_url)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                INSERT INTO order_photo_history (tenant_id, id, order_id, mime_type, content, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, mime_type, content, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), order_id, mime_type, content, user_uuid),
            )
            row = cur.fetchone()
        conn.commit()
        return OrderPhotoHistoryOut(
            id=row[0],
            mime_type=str(row[1] or "").strip(),
            data_url=_photo_data_url(str(row[1] or "").strip(), bytes(row[2] or b"")),
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


@router.get("/{order_id}/photos", response_model=list[OrderPhotoHistoryOut])
def list_order_photos(order_id: UUID, request: Request, limit: int = 100) -> list[OrderPhotoHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 200))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                SELECT id, mime_type, content, created_by_uuid, created_at
                FROM order_photo_history
                WHERE order_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (order_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            OrderPhotoHistoryOut(
                id=row[0],
                mime_type=str(row[1] or "").strip(),
                data_url=_photo_data_url(str(row[1] or "").strip(), bytes(row[2] or b"")),
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
def get_order_creator(order_id: UUID, request: Request) -> OrderCreatorOut:
    conn = None
    try:
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT created_by_uuid FROM orders WHERE id = %s AND tenant_id = %s", (order_id, tenant_id))
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
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT created_by_uuid
                FROM orders
                WHERE tenant_id = %s
                  AND created_by_uuid IS NOT NULL
                  AND created_by_uuid <> ''
                ORDER BY created_by_uuid
                """
                ,
                (tenant_id,),
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


@router.get("/problem-stats/me", response_model=ProblemOrdersStatsOut)
def get_problem_orders_stats_me(request: Request) -> ProblemOrdersStatsOut:
    conn = None
    try:
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            count = _count_problem_orders_for_creator(cur, tenant_id, user_uuid)
        return ProblemOrdersStatsOut(problem_orders_count=count)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/problem-reminders", response_model=list[ProblemOrderReminderOut])
def list_problem_order_reminders(request: Request, limit: int = 20) -> list[ProblemOrderReminderOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 1000))
        tenant_id = _require_tenant_id(request)
        where_parts: list[str] = [
            "o.tenant_id = %s",
            """
            (
              COALESCE(o.issue_kind, '') IN ('problem', 'return')
              OR (
                COALESCE(o.display_status, '') <> 'Выдано'
                AND o.order_kind = 'repair'
                AND ph.problem_since <= (NOW() - INTERVAL '4 days')
              )
            )
            """,
        ]
        params: list = [tenant_id]
        if not _is_admin(request):
            user_uuid = _require_user_uuid(request)
            where_parts.append("o.created_by_uuid = %s")
            params.append(user_uuid)
        where_sql = f"WHERE {' AND '.join(where_parts)}"
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  o.id,
                  o.order_number,
                  o.serial_model,
                  o.warehouse_id,
                  o.created_by_uuid,
                  ph.problem_since,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ph.problem_since)) / 86400)::int) AS days_overdue
                FROM orders o
                JOIN (
                  SELECT
                    o2.id AS order_id,
                    CASE
                      WHEN COALESCE(o2.issue_kind, '') IN ('problem', 'return') THEN
                        COALESCE((SELECT MAX(oih.created_at) FROM order_issue_history oih WHERE oih.order_id = o2.id AND oih.issue_kind = o2.issue_kind), o2.created_at)
                      ELSE
                        GREATEST(
                          o2.created_at,
                          COALESCE((SELECT MAX(osh.changed_at) FROM order_status_history osh WHERE osh.order_id = o2.id), o2.created_at),
                          COALESCE((SELECT MAX(oih.created_at) FROM order_issue_history oih WHERE oih.order_id = o2.id), o2.created_at),
                          COALESCE((SELECT MAX(och.created_at) FROM order_comment_history och WHERE och.order_id = o2.id), o2.created_at),
                          COALESCE((SELECT MAX(oph.created_at) FROM order_photo_history oph WHERE oph.order_id = o2.id), o2.created_at)
                        )
                    END AS problem_since
                  FROM orders o2
                ) ph ON ph.order_id = o.id
                """
                + where_sql
                + """
                ORDER BY
                  CASE WHEN COALESCE(o.issue_kind, '') IN ('problem', 'return') THEN 0 ELSE 1 END,
                  CASE WHEN COALESCE(o.issue_kind, '') IN ('problem', 'return') THEN ph.problem_since END DESC,
                  ph.problem_since ASC,
                  o.order_number ASC NULLS LAST
                LIMIT %s
                """,
                tuple(params + [safe_limit]),
            )
            rows = cur.fetchall()
        return [
            ProblemOrderReminderOut(
                order_id=row[0],
                order_number=row[1],
                serial_model=str(row[2] or "").strip(),
                warehouse_id=row[3],
                created_by_uuid=row[4],
                problem_since=row[5],
                days_overdue=int(row[6] or 0),
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


@router.get("/stats/monthly-orders", response_model=MonthlyOrdersChartOut)
def get_monthly_orders_chart(request: Request) -> MonthlyOrdersChartOut:
    conn = None
    try:
        current_month = dt_date.today().replace(day=1)
        start_month = _shift_month_start(current_month, -11)
        end_month = _shift_month_start(current_month, 1)
        tenant_id = _require_tenant_id(request)

        where_parts: list[str] = [
            "o.tenant_id = %s",
            "o.created_at >= %s",
            "o.created_at < %s",
        ]
        params: list = [tenant_id, start_month.isoformat(), end_month.isoformat()]
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

        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT date_trunc('month', o.created_at)::date AS month_start, COUNT(*)::int AS orders_count
                FROM orders o
                WHERE
                """
                + " AND ".join(where_parts)
                + """
                GROUP BY month_start
                ORDER BY month_start ASC
                """,
                tuple(params),
            )
            rows = cur.fetchall()

        counts_by_month = {row[0].isoformat(): int(row[1] or 0) for row in rows}
        month_labels = {
            1: "янв",
            2: "фев",
            3: "мар",
            4: "апр",
            5: "май",
            6: "июн",
            7: "июл",
            8: "авг",
            9: "сен",
            10: "окт",
            11: "ноя",
            12: "дек",
        }
        items: list[MonthlyOrdersPointOut] = []
        cursor = start_month
        while cursor < end_month:
            month_key = cursor.isoformat()
            items.append(
                MonthlyOrdersPointOut(
                    month=month_key,
                    label=f"{month_labels[cursor.month]} {str(cursor.year)[-2:]}",
                    orders_count=counts_by_month.get(month_key, 0),
                )
            )
            cursor = _shift_month_start(cursor, 1)
        return MonthlyOrdersChartOut(items=items)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/stats/monthly-orders-by-kind", response_model=MonthlyOrdersByKindChartOut)
def get_monthly_orders_by_kind_chart(request: Request) -> MonthlyOrdersByKindChartOut:
    conn = None
    try:
        current_month = dt_date.today().replace(day=1)
        start_month = _shift_month_start(current_month, -11)
        end_month = _shift_month_start(current_month, 1)
        tenant_id = _require_tenant_id(request)

        where_parts: list[str] = [
            "o.tenant_id = %s",
            "o.created_at >= %s",
            "o.created_at < %s",
        ]
        params: list = [tenant_id, start_month.isoformat(), end_month.isoformat()]
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

        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  date_trunc('month', o.created_at)::date AS month_start,
                  COALESCE(o.order_kind, '') AS order_kind,
                  COUNT(*)::int AS orders_count
                FROM orders o
                WHERE
                """
                + " AND ".join(where_parts)
                + """
                GROUP BY month_start, order_kind
                ORDER BY month_start ASC, order_kind ASC
                """,
                tuple(params),
            )
            rows = cur.fetchall()

        counts_by_month_and_kind: dict[tuple[str, str], int] = {}
        for row in rows:
            month_key = row[0].isoformat()
            order_kind = str(row[1] or "").strip().lower()
            counts_by_month_and_kind[(month_key, order_kind)] = int(row[2] or 0)
        month_labels = {
            1: "янв",
            2: "фев",
            3: "мар",
            4: "апр",
            5: "май",
            6: "июн",
            7: "июл",
            8: "авг",
            9: "сен",
            10: "окт",
            11: "ноя",
            12: "дек",
        }
        items: list[MonthlyOrdersByKindPointOut] = []
        cursor = start_month
        while cursor < end_month:
            month_key = cursor.isoformat()
            items.append(
                MonthlyOrdersByKindPointOut(
                    month=month_key,
                    label=f"{month_labels[cursor.month]} {str(cursor.year)[-2:]}",
                    onsite_count=counts_by_month_and_kind.get((month_key, "onsite"), 0),
                    repair_count=counts_by_month_and_kind.get((month_key, "repair"), 0),
                )
            )
            cursor = _shift_month_start(cursor, 1)
        return MonthlyOrdersByKindChartOut(items=items)
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
    order_ids: str | None = None,
    order_kind: str | None = None,
    issue_kind: Literal["return", "problem", "issued"] | None = None,
    service_category_id: UUID | None = None,
    service_object_id: UUID | None = None,
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
        tenant_id = _require_tenant_id(request)
        where_parts: list[str] = ["o.tenant_id = %s"]
        params: list = [tenant_id]

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
        if order_ids and str(order_ids).strip():
            parsed_ids: list[UUID] = []
            for raw_part in str(order_ids).split(","):
                part = str(raw_part or "").strip()
                if not part:
                    continue
                try:
                    parsed_ids.append(UUID(part))
                except Exception as exc:
                    raise HTTPException(status_code=400, detail=f"invalid order_ids value: {part}") from exc
            if parsed_ids:
                where_parts.append("o.id = ANY(%s::uuid[])")
                params.append(parsed_ids)
        if issue_kind:
            where_parts.append("o.issue_kind = %s")
            params.append(issue_kind)
        if service_category_id:
            where_parts.append("o.service_category_id = %s")
            params.append(service_category_id)
        if service_object_id:
            where_parts.append("o.service_object_id = %s")
            params.append(service_object_id)
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
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at, issue_kind, display_status, status_selected_manually, receipt_issued,
                  (
                    SELECT ocr.callback_date
                    FROM order_callback_reminders ocr
                    WHERE ocr.order_id = o.id
                      AND ocr.tenant_id = o.tenant_id
                      AND ocr.active = TRUE
                    ORDER BY ocr.callback_date ASC, ocr.created_at DESC
                    LIMIT 1
                  ) AS active_callback_date
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
        created_by_names = _user_display_names_by_uuid([row[11] for row in rows])
        items = [
            _order_out_from_row(row, created_by_names.get(str(row[11] or "").strip(), ""))
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
