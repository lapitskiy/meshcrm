import json
import os
from datetime import datetime
from datetime import date as dt_date
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


class OrderCreateIn(BaseModel):
    order_kind: str = Field(min_length=1, max_length=50)
    service_category_id: UUID | None = None
    service_object_id: UUID | None = None
    serial_model: str = ""
    work_type_ids: list[UUID] = Field(default_factory=list)
    warehouse_id: UUID | None = None
    contact_uuid: UUID | None = None
    related_modules: dict = Field(default_factory=dict)


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


class OrderListOut(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class OrderStatusUpdateIn(BaseModel):
    status: str = Field(min_length=1, max_length=120)


class OrderStatusHistoryOut(BaseModel):
    status: str
    changed_at: datetime


class OrderCreatorOut(BaseModel):
    user_uuid: str | None = None
    username: str = ""
    email: str = ""
    full_name: str = ""


def _user_uuid_from_headers(request: Request) -> str | None:
    value = str(request.headers.get("x-user-uuid", "")).strip()
    return value or None


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
            cur.execute(
                """
                INSERT INTO orders (
                  id, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s)
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at
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
                ),
            )
            row = cur.fetchone()
            cur.execute(
                """
                INSERT INTO order_status_history (id, order_id, status)
                VALUES (%s, %s, %s)
                """,
                (uuid4(), row[0], row[2] or "Новый"),
            )
        conn.commit()
        return OrderOut(
            id=row[0],
            order_number=row[1],
            status=row[2] or "Новый",
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
        )
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
        next_status = payload.status.strip()
        if not next_status:
            raise HTTPException(status_code=400, detail="status must not be empty")
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM orders WHERE id = %s", (order_id,))
            current = cur.fetchone()
            if not current:
                conn.rollback()
                raise HTTPException(status_code=404, detail="order not found")
            current_status = str(current[0] or "Новый")
            if current_status == next_status:
                cur.execute(
                    """
                    SELECT
                      id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                      work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at
                    FROM orders
                    WHERE id = %s
                    """,
                    (order_id,),
                )
                same_row = cur.fetchone()
                return OrderOut(
                    id=same_row[0],
                    order_number=same_row[1],
                    status=same_row[2] or "Новый",
                    order_kind=same_row[3],
                    service_category_id=same_row[4],
                    service_object_id=same_row[5],
                    serial_model=same_row[6] or "",
                    work_type_ids=[UUID(str(x)) for x in (same_row[7] or [])],
                    warehouse_id=same_row[8],
                    contact_uuid=same_row[9],
                    related_modules=same_row[10] or {},
                    created_by_uuid=same_row[11],
                    created_at=same_row[12],
                )
            cur.execute(
                """
                UPDATE orders
                SET status = %s
                WHERE id = %s
                RETURNING
                  id, order_number, status, order_kind, service_category_id, service_object_id, serial_model,
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at
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
        return OrderOut(
            id=row[0],
            order_number=row[1],
            status=row[2] or "Новый",
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
        )
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
        token = _keycloak_admin_token()
        req = UrlRequest(
            f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_uuid}",
            headers={"authorization": f"Bearer {token}"},
            method="GET",
        )
        with urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
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


@router.get("", response_model=OrderListOut)
def list_orders(
    page: int = 1,
    page_size: int = 20,
    order_kind: str | None = None,
    service_category_id: UUID | None = None,
    work_type_id: UUID | None = None,
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
                  work_type_ids, warehouse_id, contact_uuid, related_modules, created_by_uuid, created_at
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
            OrderOut(
                id=row[0],
                order_number=row[1],
                status=row[2] or "Новый",
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
            )
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
