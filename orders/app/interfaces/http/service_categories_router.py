import json
import os
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.application.service_categories.dto import (
    CreateServiceCategoryIn,
    ServiceCategoryOut,
    UpdateServiceCategoryIn,
)
from app.application.service_categories.use_cases import ServiceCategoryUseCases
from app.infrastructure.db.connection import get_connection
from app.infrastructure.repositories.psycopg_service_category_repository import PsycopgServiceCategoryRepository

router = APIRouter(prefix="/settings/service-categories", tags=["orders-service-categories"])

SUPERADMIN_ROLE = "superadmin"
KEYCLOAK_INTERNAL_URL = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")


class UserLiteOut(BaseModel):
    user_uuid: str
    username: str
    email: str
    full_name: str


class CategoryAccessReplaceIn(BaseModel):
    category_ids: list[UUID] = Field(default_factory=list)


class CategoryAccessOut(BaseModel):
    user_uuid: str
    category_ids: list[UUID]


class CategoryAccessibleSummaryOut(BaseModel):
    total_count: int
    accessible_count: int


def _roles_from_headers(request: Request) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def _require_superadmin(request: Request) -> None:
    roles = _roles_from_headers(request)
    if SUPERADMIN_ROLE in roles:
        return
    raise HTTPException(status_code=403, detail="forbidden: superadmin role required")


def _require_user_uuid(request: Request) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


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


@router.get("", response_model=list[ServiceCategoryOut])
def list_service_categories() -> list[ServiceCategoryOut]:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceCategoryUseCases(PsycopgServiceCategoryRepository(conn))
        return [ServiceCategoryOut.model_validate(item) for item in use_cases.list_all()]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/accessible", response_model=list[ServiceCategoryOut])
def list_accessible_service_categories(request: Request) -> list[ServiceCategoryOut]:
    conn = None
    try:
        conn = get_connection()
        user_uuid = _require_user_uuid(request)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sc.id, sc.name, sc.created_at
                FROM service_categories sc
                JOIN service_category_access sca ON sca.service_category_id = sc.id
                WHERE sca.user_uuid = %s
                ORDER BY sc.created_at DESC
                """,
                (user_uuid,),
            )
            rows = cur.fetchall()
        return [ServiceCategoryOut(id=row[0], name=row[1], created_at=row[2]) for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/accessible-summary", response_model=CategoryAccessibleSummaryOut)
def get_accessible_service_categories_summary(request: Request) -> CategoryAccessibleSummaryOut:
    conn = None
    try:
        conn = get_connection()
        user_uuid = _require_user_uuid(request)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM service_categories")
            total_count = int(cur.fetchone()[0] or 0)
            cur.execute(
                """
                SELECT COUNT(*)
                FROM service_category_access
                WHERE user_uuid = %s
                """,
                (user_uuid,),
            )
            accessible_count = int(cur.fetchone()[0] or 0)
        return CategoryAccessibleSummaryOut(total_count=total_count, accessible_count=accessible_count)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("", response_model=ServiceCategoryOut, status_code=201)
def create_service_category(payload: CreateServiceCategoryIn) -> ServiceCategoryOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceCategoryUseCases(PsycopgServiceCategoryRepository(conn))
        entity = use_cases.create(payload)
        return ServiceCategoryOut.model_validate(entity)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{category_id}", response_model=ServiceCategoryOut)
def update_service_category(category_id: UUID, payload: UpdateServiceCategoryIn) -> ServiceCategoryOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceCategoryUseCases(PsycopgServiceCategoryRepository(conn))
        entity = use_cases.update(category_id=category_id, payload=payload)
        return ServiceCategoryOut.model_validate(entity)
    except ValueError as exc:
        message = str(exc)
        if message == "Category not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/{category_id}", status_code=204)
def delete_service_category(category_id: UUID) -> None:
    conn = None
    try:
        conn = get_connection()
        use_cases = ServiceCategoryUseCases(PsycopgServiceCategoryRepository(conn))
        use_cases.delete(category_id=category_id)
    except ValueError as exc:
        message = str(exc)
        if message == "Category not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/access/users/search", response_model=list[UserLiteOut])
def search_users(q: str, request: Request) -> list[UserLiteOut]:
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
        payload = resp.read().decode("utf-8")
    rows = json.loads(payload) or []
    out: list[UserLiteOut] = []
    for row in rows:
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


@router.get("/access/users/{user_uuid}", response_model=CategoryAccessOut)
def get_user_category_access(user_uuid: str, request: Request) -> CategoryAccessOut:
    _require_superadmin(request)
    conn = None
    try:
        conn = get_connection()
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
            rows = cur.fetchall()
        return CategoryAccessOut(user_uuid=user_uuid, category_ids=[row[0] for row in rows])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/access/users/{user_uuid}", response_model=CategoryAccessOut)
def replace_user_category_access(user_uuid: str, payload: CategoryAccessReplaceIn, request: Request) -> CategoryAccessOut:
    _require_superadmin(request)
    conn = None
    try:
        conn = get_connection()
        category_ids = list(dict.fromkeys(payload.category_ids))
        with conn.cursor() as cur:
            if category_ids:
                cur.execute(
                    "SELECT id FROM service_categories WHERE id = ANY(%s)",
                    (category_ids,),
                )
                existing_ids = {row[0] for row in cur.fetchall()}
                if len(existing_ids) != len(category_ids):
                    raise HTTPException(status_code=400, detail="some category_ids do not exist")
            cur.execute("DELETE FROM service_category_access WHERE user_uuid = %s", (user_uuid,))
            for category_id in category_ids:
                cur.execute(
                    """
                    INSERT INTO service_category_access (service_category_id, user_uuid)
                    VALUES (%s, %s)
                    ON CONFLICT (service_category_id, user_uuid) DO NOTHING
                    """,
                    (category_id, user_uuid),
                )
        conn.commit()
        return CategoryAccessOut(user_uuid=user_uuid, category_ids=category_ids)
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
