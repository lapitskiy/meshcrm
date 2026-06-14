from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.infrastructure.db.connection import get_connection

router = APIRouter(prefix="/settings/recommended-prices", tags=["orders-recommended-prices"])


class RecommendedPriceRowOut(BaseModel):
    work_type_id: UUID
    work_type_name: str
    recommended_price: Decimal | None


class RecommendedPriceSaveItem(BaseModel):
    work_type_id: UUID
    recommended_price: Decimal | None = Field(default=None, ge=0)


class RecommendedPricesSaveIn(BaseModel):
    service_category_id: UUID
    service_object_id: UUID
    items: list[RecommendedPriceSaveItem] = Field(default_factory=list)


def _roles_from_headers(request: Request) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def _is_superadmin(request: Request) -> bool:
    return "superadmin" in _roles_from_headers(request)


def _require_user_uuid(request: Request) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def _accessible_category_ids(conn, request: Request) -> list[UUID] | None:
    if _is_superadmin(request):
        return None
    user_uuid = _require_user_uuid(request)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT service_category_id
            FROM service_category_access
            WHERE user_uuid = %s
            ORDER BY created_at ASC
            """,
            (user_uuid,),
        )
        return [row[0] for row in cur.fetchall()]


def _ensure_category_access(conn, request: Request, service_category_id: UUID) -> None:
    accessible_category_ids = _accessible_category_ids(conn, request)
    if accessible_category_ids is None:
        return
    if service_category_id not in accessible_category_ids:
        raise HTTPException(status_code=403, detail="forbidden for selected service category")


def _ensure_service_object_belongs(conn, service_category_id: UUID, service_object_id: UUID) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM service_objects
            WHERE id = %s AND service_category_id = %s
            """,
            (service_object_id, service_category_id),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=400, detail="service object does not belong to selected category")


def _work_type_ids_for_category(conn, service_category_id: UUID) -> set[UUID]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id
            FROM work_types
            WHERE service_category_id = %s
            """,
            (service_category_id,),
        )
        return {row[0] for row in cur.fetchall()}


@router.get("", response_model=list[RecommendedPriceRowOut])
def list_recommended_prices(
    request: Request,
    service_category_id: UUID = Query(...),
    service_object_id: UUID = Query(...),
) -> list[RecommendedPriceRowOut]:
    conn = None
    try:
        conn = get_connection()
        _ensure_category_access(conn, request, service_category_id)
        _ensure_service_object_belongs(conn, service_category_id, service_object_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    wt.id,
                    wt.name,
                    rp.recommended_price
                FROM work_types wt
                LEFT JOIN recommended_prices rp
                    ON rp.service_category_id = wt.service_category_id
                   AND rp.service_object_id = %s
                   AND rp.work_type_id = wt.id
                WHERE wt.service_category_id = %s
                ORDER BY wt.name ASC
                """,
                (service_object_id, service_category_id),
            )
            rows = cur.fetchall()
        return [
            RecommendedPriceRowOut(
                work_type_id=row[0],
                work_type_name=row[1],
                recommended_price=row[2],
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


@router.put("", response_model=list[RecommendedPriceRowOut])
def save_recommended_prices(payload: RecommendedPricesSaveIn, request: Request) -> list[RecommendedPriceRowOut]:
    conn = None
    try:
        conn = get_connection()
        _ensure_category_access(conn, request, payload.service_category_id)
        _ensure_service_object_belongs(conn, payload.service_category_id, payload.service_object_id)
        valid_work_type_ids = _work_type_ids_for_category(conn, payload.service_category_id)
        incoming_items = list({item.work_type_id: item for item in payload.items}.values())
        unknown_work_type_ids = [item.work_type_id for item in incoming_items if item.work_type_id not in valid_work_type_ids]
        if unknown_work_type_ids:
            raise HTTPException(status_code=400, detail="some work types do not belong to selected category")
        with conn.cursor() as cur:
            for item in incoming_items:
                if item.recommended_price is None:
                    cur.execute(
                        """
                        DELETE FROM recommended_prices
                        WHERE service_category_id = %s
                          AND service_object_id = %s
                          AND work_type_id = %s
                        """,
                        (payload.service_category_id, payload.service_object_id, item.work_type_id),
                    )
                    continue
                cur.execute(
                    """
                    INSERT INTO recommended_prices (
                        service_category_id,
                        service_object_id,
                        work_type_id,
                        recommended_price
                    )
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (service_category_id, service_object_id, work_type_id)
                    DO UPDATE SET
                        recommended_price = EXCLUDED.recommended_price,
                        updated_at = now()
                    """,
                    (
                        payload.service_category_id,
                        payload.service_object_id,
                        item.work_type_id,
                        item.recommended_price,
                    ),
                )
            conn.commit()
        return list_recommended_prices(
            request=request,
            service_category_id=payload.service_category_id,
            service_object_id=payload.service_object_id,
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
