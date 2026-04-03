from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from app.application.service_objects.dto import CreateServiceObjectIn, ServiceObjectOut, UpdateServiceObjectIn
from app.application.service_objects.use_cases import ServiceObjectUseCases
from app.infrastructure.db.connection import get_connection
from app.infrastructure.repositories.psycopg_service_object_repository import PsycopgServiceObjectRepository

router = APIRouter(prefix="/settings/service-objects", tags=["orders-service-objects"])


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


@router.get("", response_model=list[ServiceObjectOut])
def list_service_objects(
    request: Request,
    service_category_id: UUID | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[ServiceObjectOut]:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceObjectUseCases(PsycopgServiceObjectRepository(conn))
        accessible_category_ids = _accessible_category_ids(conn, request)
        return [
            ServiceObjectOut.model_validate(item)
            for item in use_cases.list_all(
                service_category_id=service_category_id,
                accessible_category_ids=accessible_category_ids,
                name_query=q,
                limit=limit,
            )
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("", response_model=ServiceObjectOut, status_code=201)
def create_service_object(payload: CreateServiceObjectIn) -> ServiceObjectOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceObjectUseCases(PsycopgServiceObjectRepository(conn))
        return ServiceObjectOut.model_validate(use_cases.create(payload))
    except ValueError as exc:
        message = str(exc)
        if message == "Service category not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{object_id}", response_model=ServiceObjectOut)
def update_service_object(object_id: UUID, payload: UpdateServiceObjectIn) -> ServiceObjectOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceObjectUseCases(PsycopgServiceObjectRepository(conn))
        return ServiceObjectOut.model_validate(use_cases.update(object_id=object_id, payload=payload))
    except ValueError as exc:
        message = str(exc)
        if message in ("Service category not found", "Service object not found"):
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/{object_id}", status_code=204)
def delete_service_object(object_id: UUID) -> None:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceObjectUseCases(PsycopgServiceObjectRepository(conn))
        use_cases.delete(object_id=object_id)
    except ValueError as exc:
        message = str(exc)
        if message == "Service object not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()
