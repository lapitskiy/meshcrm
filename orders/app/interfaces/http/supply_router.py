from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.infrastructure.db.connection import get_connection
from app.interfaces.http.orders_router import (
    _fetch_accessible_warehouse_ids,
    _is_superadmin,
    _photo_data_url,
    _parse_photo_data_url,
    _require_tenant_id,
    _require_user_uuid,
    _user_display_name_from_uuid,
)

router = APIRouter(prefix="/supply", tags=["orders-supply"])


class SupplyRequestCreateIn(BaseModel):
    order_id: UUID
    service_category_id: UUID
    request_text: str = Field(min_length=1, max_length=4000)
    photos: list[str] = Field(default_factory=list, max_length=20)


class SupplyRequestOut(BaseModel):
    id: UUID
    order_id: UUID
    order_number: int | None = None
    order_status: str = ""
    order_serial_model: str = ""
    service_category_id: UUID
    service_category_name: str = ""
    request_text: str
    display_status: str | None = None
    photos_count: int = 0
    preview_photo_data_url: str | None = None
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: str


class SupplyRequestListOut(BaseModel):
    items: list[SupplyRequestOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class SupplyRequestDisplayStatusUpdateIn(BaseModel):
    display_status: str | None = Field(default=None, max_length=120)


class SupplyRequestStatusHistoryOut(BaseModel):
    status: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    changed_at: str


class SupplyRequestPhotoOut(BaseModel):
    id: UUID
    mime_type: str
    data_url: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: str


class SupplyRequestCommentCreateIn(BaseModel):
    comment: str = Field(min_length=1, max_length=4000)


class SupplyRequestCommentOut(BaseModel):
    id: UUID
    comment: str
    created_by_uuid: str | None = None
    created_by_name: str = ""
    created_at: str


class SupplyRequestReminderOut(BaseModel):
    supply_request_id: UUID
    order_id: UUID
    order_number: int | None = None
    serial_model: str = ""
    created_at: str
    days_overdue: int = 0


def _normalize_display_status(raw_display_status: object) -> str | None:
    value = str(raw_display_status or "").strip()
    return value or None


def _build_access_sql(request: Request, params: list) -> str:
    tenant_id = _require_tenant_id(request)
    params.append(tenant_id)
    tenant_sql = " AND o.tenant_id = %s"
    if _is_superadmin(request):
        return tenant_sql
    user_uuid = _require_user_uuid(request)
    accessible_warehouse_ids = _fetch_accessible_warehouse_ids(request)
    if not accessible_warehouse_ids:
        return " AND FALSE"
    params.extend([accessible_warehouse_ids, user_uuid])
    return tenant_sql + """
        AND o.warehouse_id IS NOT NULL
        AND o.warehouse_id = ANY(%s::uuid[])
        AND EXISTS (
            SELECT 1
            FROM service_category_access sca
            WHERE sca.service_category_id = o.service_category_id
              AND sca.user_uuid = %s
        )
    """


def _ensure_selected_category_access(cur, request: Request, service_category_id: UUID) -> str:
    if _is_superadmin(request):
        cur.execute("SELECT name FROM service_categories WHERE id = %s", (service_category_id,))
    else:
        cur.execute(
            """
            SELECT sc.name
            FROM service_categories sc
            JOIN service_category_access sca ON sca.service_category_id = sc.id
            WHERE sc.id = %s AND sca.user_uuid = %s
            """,
            (service_category_id, _require_user_uuid(request)),
        )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=403, detail="forbidden for selected service category")
    return str(row[0] or "").strip()


def _fetch_order_for_supply(cur, request: Request, order_id: UUID) -> tuple[int | None, str, str]:
    params: list = [order_id]
    access_sql = _build_access_sql(request, params)
    cur.execute(
        """
        SELECT o.order_number, o.status, o.serial_model
        FROM orders o
        WHERE o.id = %s
        """
        + access_sql
        + """
        LIMIT 1
        """,
        tuple(params),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="order not found or unavailable")
    return row[0], str(row[1] or "").strip(), str(row[2] or "").strip()


def _ensure_supply_request_access(cur, request: Request, supply_request_id: UUID) -> None:
    tenant_id = _require_tenant_id(request)
    params: list = [supply_request_id, tenant_id]
    access_sql = _build_access_sql(request, params)
    cur.execute(
        """
        SELECT 1
        FROM supply_requests sr
        JOIN orders o ON o.id = sr.order_id
        WHERE sr.id = %s
          AND sr.tenant_id = %s
        """
        + access_sql
        + """
        LIMIT 1
        """,
        tuple(params),
    )
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail="supply request not found or unavailable")


def _row_to_supply_request_out(row) -> SupplyRequestOut:
    preview_data_url = None
    if row[11] and row[12]:
        preview_data_url = _photo_data_url(str(row[11] or "").strip(), bytes(row[12] or b""))
    return SupplyRequestOut(
        id=row[0],
        order_id=row[1],
        order_number=row[2],
        order_status=str(row[3] or "").strip(),
        order_serial_model=str(row[4] or "").strip(),
        service_category_id=row[5],
        service_category_name=str(row[6] or "").strip(),
        request_text=str(row[7] or "").strip(),
        display_status=_normalize_display_status(row[8]),
        photos_count=int(row[9] or 0),
        created_by_uuid=row[10],
        preview_photo_data_url=preview_data_url,
        created_by_name=_user_display_name_from_uuid(row[10]),
        created_at=row[13].isoformat(),
    )


@router.post("", response_model=SupplyRequestOut, status_code=201)
def create_supply_request(payload: SupplyRequestCreateIn, request: Request) -> SupplyRequestOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            tenant_id = _require_tenant_id(request)
            order_number, order_status, order_serial_model = _fetch_order_for_supply(cur, request, payload.order_id)
            service_category_name = _ensure_selected_category_access(cur, request, payload.service_category_id)
            created_by_uuid = _require_user_uuid(request)
            supply_request_id = uuid4()
            cur.execute(
                """
                INSERT INTO supply_requests (tenant_id, id, order_id, service_category_id, request_text, created_by_uuid, display_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING created_at
                """,
                (
                    tenant_id,
                    supply_request_id,
                    payload.order_id,
                    payload.service_category_id,
                    payload.request_text.strip(),
                    created_by_uuid,
                    None,
                ),
            )
            created_at = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO supply_request_status_history (tenant_id, id, supply_request_id, status, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (tenant_id, uuid4(), supply_request_id, "Создана", created_by_uuid),
            )
            preview_mime_type = None
            preview_content = None
            for index, raw_photo in enumerate(payload.photos):
                mime_type, content = _parse_photo_data_url(raw_photo)
                if index == 0:
                    preview_mime_type = mime_type
                    preview_content = content
                cur.execute(
                    """
                    INSERT INTO supply_request_photos (tenant_id, id, supply_request_id, mime_type, content, created_by_uuid)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), supply_request_id, mime_type, content, created_by_uuid),
                )
        conn.commit()
        return SupplyRequestOut(
            id=supply_request_id,
            order_id=payload.order_id,
            order_number=order_number,
            order_status=order_status,
            order_serial_model=order_serial_model,
            service_category_id=payload.service_category_id,
            service_category_name=service_category_name,
            request_text=payload.request_text.strip(),
            display_status=None,
            photos_count=len(payload.photos),
            preview_photo_data_url=_photo_data_url(preview_mime_type, preview_content) if preview_mime_type and preview_content else None,
            created_by_uuid=created_by_uuid,
            created_by_name=_user_display_name_from_uuid(created_by_uuid),
            created_at=created_at.isoformat(),
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


@router.get("", response_model=SupplyRequestListOut)
def list_supply_requests(
    request: Request,
    page: int = 1,
    page_size: int = 20,
    search: str | None = Query(default=None),
) -> SupplyRequestListOut:
    conn = None
    try:
        safe_page = max(1, int(page))
        safe_page_size = max(1, min(int(page_size), 100))
        offset = (safe_page - 1) * safe_page_size
        tenant_id = _require_tenant_id(request)
        where_parts: list[str] = ["sr.tenant_id = %s"]
        params: list = [tenant_id]
        if search and str(search).strip():
            term = f"%{str(search).strip()}%"
            where_parts.append(
                """
                (
                    CAST(o.order_number AS TEXT) ILIKE %s
                    OR sr.request_text ILIKE %s
                    OR COALESCE(sc.name, '') ILIKE %s
                    OR COALESCE(o.serial_model, '') ILIKE %s
                )
                """
            )
            params.extend([term, term, term, term])
        access_sql = _build_access_sql(request, params).strip()
        if access_sql:
            if access_sql.startswith("AND "):
                access_sql = access_sql[4:]
            where_parts.append(access_sql)
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM supply_requests sr
                JOIN orders o ON o.id = sr.order_id
                JOIN service_categories sc ON sc.id = sr.service_category_id
                """
                + where_sql,
                tuple(params),
            )
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                """
                SELECT
                  sr.id,
                  sr.order_id,
                  o.order_number,
                  o.status,
                  o.serial_model,
                  sr.service_category_id,
                  sc.name,
                  sr.request_text,
                  sr.display_status,
                  COALESCE(pc.photos_count, 0) AS photos_count,
                  sr.created_by_uuid,
                  pp.mime_type,
                  pp.content,
                  sr.created_at
                FROM supply_requests sr
                JOIN orders o ON o.id = sr.order_id
                JOIN service_categories sc ON sc.id = sr.service_category_id
                LEFT JOIN LATERAL (
                  SELECT COUNT(*)::int AS photos_count
                  FROM supply_request_photos sp
                  WHERE sp.supply_request_id = sr.id
                    AND sp.tenant_id = sr.tenant_id
                ) pc ON TRUE
                LEFT JOIN LATERAL (
                  SELECT mime_type, content
                  FROM supply_request_photos sp
                  WHERE sp.supply_request_id = sr.id
                    AND sp.tenant_id = sr.tenant_id
                  ORDER BY sp.created_at DESC
                  LIMIT 1
                ) pp ON TRUE
                """
                + where_sql
                + """
                ORDER BY sr.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [safe_page_size, offset]),
            )
            rows = cur.fetchall()
        items = [_row_to_supply_request_out(row) for row in rows]
        total_pages = (total + safe_page_size - 1) // safe_page_size if total else 1
        return SupplyRequestListOut(
            items=items,
            total=total,
            page=safe_page,
            page_size=safe_page_size,
            total_pages=total_pages,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/reminders", response_model=list[SupplyRequestReminderOut])
def list_supply_request_reminders(request: Request, limit: int = 20) -> list[SupplyRequestReminderOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 100))
        tenant_id = _require_tenant_id(request)
        params: list = [tenant_id]
        where_parts: list[str] = [
            "sr.tenant_id = %s",
            "COALESCE(sr.display_status, '') <> 'Закрыто'",
            "sr.created_at <= (NOW() - INTERVAL '3 days')",
        ]
        access_sql = _build_access_sql(request, params).strip()
        if access_sql:
            if access_sql.startswith("AND "):
                access_sql = access_sql[4:]
            where_parts.append(access_sql)
        where_sql = f"WHERE {' AND '.join(where_parts)}"
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  sr.id,
                  sr.order_id,
                  o.order_number,
                  o.serial_model,
                  sr.created_at,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - sr.created_at)) / 86400)::int) AS days_overdue
                FROM supply_requests sr
                JOIN orders o ON o.id = sr.order_id
                """
                + where_sql
                + """
                ORDER BY sr.created_at ASC, o.order_number ASC NULLS LAST
                LIMIT %s
                """,
                tuple(params + [safe_limit]),
            )
            rows = cur.fetchall()
        return [
            SupplyRequestReminderOut(
                supply_request_id=row[0],
                order_id=row[1],
                order_number=row[2],
                serial_model=str(row[3] or "").strip(),
                created_at=row[4].isoformat(),
                days_overdue=int(row[5] or 0),
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


@router.put("/{supply_request_id}/display-status", response_model=SupplyRequestOut)
def update_supply_request_display_status(
    supply_request_id: UUID, payload: SupplyRequestDisplayStatusUpdateIn, request: Request
) -> SupplyRequestOut:
    conn = None
    try:
        next_display_status = _normalize_display_status(payload.display_status)
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_supply_request_access(cur, request, supply_request_id)
            cur.execute("SELECT display_status FROM supply_requests WHERE id = %s AND tenant_id = %s", (supply_request_id, tenant_id))
            current_row = cur.fetchone()
            if current_row is None:
                raise HTTPException(status_code=404, detail="supply request not found")
            current_display_status = _normalize_display_status(current_row[0])
            cur.execute(
                """
                UPDATE supply_requests sr
                SET display_status = %s
                FROM orders o, service_categories sc
                WHERE sr.id = %s
                  AND sr.tenant_id = %s
                  AND o.id = sr.order_id
                  AND sc.id = sr.service_category_id
                RETURNING
                  sr.id,
                  sr.order_id,
                  o.order_number,
                  o.status,
                  o.serial_model,
                  sr.service_category_id,
                  sc.name,
                  sr.request_text,
                  sr.display_status,
                  (
                    SELECT COUNT(*)::int
                    FROM supply_request_photos sp
                    WHERE sp.supply_request_id = sr.id
                      AND sp.tenant_id = sr.tenant_id
                  ) AS photos_count,
                  sr.created_by_uuid,
                  (
                    SELECT sp.mime_type
                    FROM supply_request_photos sp
                    WHERE sp.supply_request_id = sr.id
                      AND sp.tenant_id = sr.tenant_id
                    ORDER BY sp.created_at DESC
                    LIMIT 1
                  ) AS preview_mime_type,
                  (
                    SELECT sp.content
                    FROM supply_request_photos sp
                    WHERE sp.supply_request_id = sr.id
                    ORDER BY sp.created_at DESC
                    LIMIT 1
                  ) AS preview_content,
                  sr.created_at
                """,
                (next_display_status, supply_request_id, tenant_id),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="supply request not found")
            if current_display_status != next_display_status and next_display_status:
                cur.execute(
                    """
                    INSERT INTO supply_request_status_history (tenant_id, id, supply_request_id, status, created_by_uuid)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (tenant_id, uuid4(), supply_request_id, next_display_status, user_uuid),
                )
        conn.commit()
        return _row_to_supply_request_out(row)
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


@router.get("/{supply_request_id}/status-history", response_model=list[SupplyRequestStatusHistoryOut])
def list_supply_request_status_history(
    supply_request_id: UUID, request: Request, limit: int = 100
) -> list[SupplyRequestStatusHistoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 200))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_supply_request_access(cur, request, supply_request_id)
            cur.execute(
                """
                SELECT status, created_by_uuid, changed_at
                FROM supply_request_status_history
                WHERE supply_request_id = %s AND tenant_id = %s
                ORDER BY changed_at DESC
                LIMIT %s
                """,
                (supply_request_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            SupplyRequestStatusHistoryOut(
                status=str(row[0] or "").strip(),
                created_by_uuid=row[1],
                created_by_name=_user_display_name_from_uuid(row[1]),
                changed_at=row[2].isoformat(),
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


@router.get("/{supply_request_id}/photos", response_model=list[SupplyRequestPhotoOut])
def list_supply_request_photos(supply_request_id: UUID, request: Request, limit: int = 100) -> list[SupplyRequestPhotoOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 200))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_supply_request_access(cur, request, supply_request_id)
            cur.execute(
                """
                SELECT id, mime_type, content, created_by_uuid, created_at
                FROM supply_request_photos
                WHERE supply_request_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (supply_request_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            SupplyRequestPhotoOut(
                id=row[0],
                mime_type=str(row[1] or "").strip(),
                data_url=_photo_data_url(str(row[1] or "").strip(), bytes(row[2] or b"")),
                created_by_uuid=row[3],
                created_by_name=_user_display_name_from_uuid(row[3]),
                created_at=row[4].isoformat(),
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


@router.post("/{supply_request_id}/comments", response_model=SupplyRequestCommentOut, status_code=201)
def create_supply_request_comment(
    supply_request_id: UUID, payload: SupplyRequestCommentCreateIn, request: Request
) -> SupplyRequestCommentOut:
    conn = None
    try:
        comment = payload.comment.strip()
        if not comment:
            raise HTTPException(status_code=400, detail="comment must not be empty")
        user_uuid = _require_user_uuid(request)
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_supply_request_access(cur, request, supply_request_id)
            cur.execute(
                """
                INSERT INTO supply_request_comment_history (tenant_id, id, supply_request_id, comment, created_by_uuid)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, comment, created_by_uuid, created_at
                """,
                (tenant_id, uuid4(), supply_request_id, comment, user_uuid),
            )
            row = cur.fetchone()
        conn.commit()
        return SupplyRequestCommentOut(
            id=row[0],
            comment=str(row[1] or "").strip(),
            created_by_uuid=row[2],
            created_by_name=_user_display_name_from_uuid(row[2]),
            created_at=row[3].isoformat(),
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


@router.get("/{supply_request_id}/comments", response_model=list[SupplyRequestCommentOut])
def list_supply_request_comments(
    supply_request_id: UUID, request: Request, limit: int = 100
) -> list[SupplyRequestCommentOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 200))
        tenant_id = _require_tenant_id(request)
        conn = get_connection()
        with conn.cursor() as cur:
            _ensure_supply_request_access(cur, request, supply_request_id)
            cur.execute(
                """
                SELECT id, comment, created_by_uuid, created_at
                FROM supply_request_comment_history
                WHERE supply_request_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (supply_request_id, tenant_id, safe_limit),
            )
            rows = cur.fetchall()
        return [
            SupplyRequestCommentOut(
                id=row[0],
                comment=str(row[1] or "").strip(),
                created_by_uuid=row[2],
                created_by_name=_user_display_name_from_uuid(row[2]),
                created_at=row[3].isoformat(),
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
