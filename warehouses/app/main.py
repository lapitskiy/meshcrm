import os
import time
import uuid
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import psycopg
from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from pydantic import BaseModel, Field

from app.manifests import MANIFEST


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
KEYCLOAK_INTERNAL_URL = env("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = env("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = env("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = env("KEYCLOAK_ADMIN_PASSWORD", "admin")

ACCESS_ADMIN_ROLES = {"warehouses_access_admin", "superadmin"}


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS warehouses (
              id UUID PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              address TEXT NOT NULL DEFAULT '',
              point_phone TEXT NOT NULL DEFAULT '',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''")
        cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS point_phone TEXT NOT NULL DEFAULT ''")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS warehouse_access (
              warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
              user_uuid TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'viewer',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (warehouse_id, user_uuid)
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_access_user_uuid ON warehouse_access(user_uuid)")


class WarehouseIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    point_phone: str | None = Field(default=None, max_length=100)


class WarehouseOut(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    point_phone: str
    created_at: datetime
    updated_at: datetime


class UserAccessReplaceIn(BaseModel):
    warehouse_ids: list[uuid.UUID] = Field(default_factory=list)
    role: str = Field(default="viewer", min_length=1, max_length=50)


class UserLiteOut(BaseModel):
    user_uuid: str
    username: str
    email: str
    full_name: str


class UserAccessOut(BaseModel):
    user_uuid: str
    warehouse_ids: list[uuid.UUID]


app = FastAPI(title="warehouses", version="0.1.0")


def require_user_uuid(request: FastAPIRequest) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def roles_from_headers(request: FastAPIRequest) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def require_access_admin(request: FastAPIRequest) -> str:
    user_uuid = require_user_uuid(request)
    roles = roles_from_headers(request)
    if roles.intersection(ACCESS_ADMIN_ROLES):
        return user_uuid
    raise HTTPException(status_code=403, detail="forbidden: admin role required")


def keycloak_admin_token() -> str:
    data = urlencode(
        {
            "client_id": "admin-cli",
            "grant_type": "password",
            "username": KEYCLOAK_ADMIN_USER,
            "password": KEYCLOAK_ADMIN_PASSWORD,
        }
    ).encode()
    req = Request(
        f"{KEYCLOAK_INTERNAL_URL}/realms/master/protocol/openid-connect/token",
        data=data,
        headers={"content-type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(req, timeout=10) as resp:
        payload = resp.read().decode("utf-8")
    import json

    token = str((json.loads(payload) or {}).get("access_token") or "")
    if not token:
        raise HTTPException(status_code=502, detail="failed to get keycloak admin token")
    return token


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("warehouses-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "warehouses"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


@app.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(request: FastAPIRequest) -> list[WarehouseOut]:
    user_uuid = require_user_uuid(request)
    is_admin = bool(roles_from_headers(request).intersection(ACCESS_ADMIN_ROLES))
    with db() as conn, conn.cursor() as cur:
        if is_admin:
            cur.execute("SELECT id, name, address, point_phone, created_at, updated_at FROM warehouses ORDER BY created_at DESC")
        else:
            cur.execute(
                """
                SELECT w.id, w.name, w.address, w.point_phone, w.created_at, w.updated_at
                FROM warehouses w
                WHERE EXISTS (
                  SELECT 1
                  FROM warehouse_access wa
                  WHERE wa.warehouse_id = w.id AND wa.user_uuid = %s
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM warehouse_access wa2
                  WHERE wa2.warehouse_id = w.id
                )
                ORDER BY w.created_at DESC
                """,
                (user_uuid,),
            )
        rows = cur.fetchall()
    return [
        WarehouseOut(id=row[0], name=row[1], address=row[2], point_phone=row[3], created_at=row[4], updated_at=row[5])  # type: ignore[arg-type]
        for row in rows
    ]


@app.get("/warehouses/accessible", response_model=list[WarehouseOut])
def list_accessible_warehouses(request: FastAPIRequest) -> list[WarehouseOut]:
    user_uuid = require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT w.id, w.name, w.address, w.point_phone, w.created_at, w.updated_at
            FROM warehouses w
            JOIN warehouse_access wa ON wa.warehouse_id = w.id
            WHERE wa.user_uuid = %s
            ORDER BY w.created_at DESC
            """,
            (user_uuid,),
        )
        rows = cur.fetchall()
    return [
        WarehouseOut(id=row[0], name=row[1], address=row[2], point_phone=row[3], created_at=row[4], updated_at=row[5])  # type: ignore[arg-type]
        for row in rows
    ]


@app.get("/warehouses/admin/all", response_model=list[WarehouseOut])
def list_warehouses_admin(request: FastAPIRequest) -> list[WarehouseOut]:
    require_access_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name, address, point_phone, created_at, updated_at FROM warehouses ORDER BY created_at DESC")
        rows = cur.fetchall()
    return [
        WarehouseOut(id=row[0], name=row[1], address=row[2], point_phone=row[3], created_at=row[4], updated_at=row[5])  # type: ignore[arg-type]
        for row in rows
    ]


@app.post("/warehouses", response_model=WarehouseOut, status_code=201)
def create_warehouse(body: WarehouseIn, request: FastAPIRequest) -> WarehouseOut:
    user_uuid = require_user_uuid(request)
    name = body.name.strip()
    address = (body.address or "").strip()
    point_phone = (body.point_phone or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO warehouses (id, name, address, point_phone, created_at, updated_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW())
                RETURNING id, name, address, point_phone, created_at, updated_at
                """,
                (uuid.uuid4(), name, address, point_phone),
            )
            row = cur.fetchone()
            cur.execute(
                """
                INSERT INTO warehouse_access (warehouse_id, user_uuid, role)
                VALUES (%s, %s, 'owner')
                ON CONFLICT (warehouse_id, user_uuid) DO UPDATE SET role = EXCLUDED.role
                """,
                (row[0], user_uuid),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return WarehouseOut(id=row[0], name=row[1], address=row[2], point_phone=row[3], created_at=row[4], updated_at=row[5])  # type: ignore[arg-type]


@app.put("/warehouses/{warehouse_id}", response_model=WarehouseOut)
def update_warehouse(warehouse_id: uuid.UUID, body: WarehouseIn, request: FastAPIRequest) -> WarehouseOut:
    user_uuid = require_user_uuid(request)
    is_admin = bool(roles_from_headers(request).intersection(ACCESS_ADMIN_ROLES))
    name = body.name.strip()
    address = body.address.strip() if body.address is not None else None
    point_phone = body.point_phone.strip() if body.point_phone is not None else None
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")
    with db() as conn, conn.cursor() as cur:
        if not is_admin:
            cur.execute(
                "SELECT 1 FROM warehouse_access WHERE warehouse_id=%s AND user_uuid=%s AND role='owner'",
                (warehouse_id, user_uuid),
            )
            is_owner = cur.fetchone() is not None
            if not is_owner:
                cur.execute("SELECT 1 FROM warehouse_access WHERE warehouse_id=%s", (warehouse_id,))
                has_acl_rows = cur.fetchone() is not None
                if has_acl_rows:
                    raise HTTPException(status_code=403, detail="forbidden")
        cur.execute(
            """
            UPDATE warehouses
            SET name=%s, address=COALESCE(%s, address), point_phone=COALESCE(%s, point_phone), updated_at=NOW()
            WHERE id=%s
            RETURNING id, name, address, point_phone, created_at, updated_at
            """,
            (name, address, point_phone, warehouse_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="warehouse not found")
    return WarehouseOut(id=row[0], name=row[1], address=row[2], point_phone=row[3], created_at=row[4], updated_at=row[5])  # type: ignore[arg-type]


@app.delete("/warehouses/{warehouse_id}", status_code=204)
def delete_warehouse(warehouse_id: uuid.UUID, request: FastAPIRequest) -> None:
    user_uuid = require_user_uuid(request)
    is_admin = bool(roles_from_headers(request).intersection(ACCESS_ADMIN_ROLES))
    with db() as conn, conn.cursor() as cur:
        if not is_admin:
            cur.execute(
                "SELECT 1 FROM warehouse_access WHERE warehouse_id=%s AND user_uuid=%s AND role='owner'",
                (warehouse_id, user_uuid),
            )
            is_owner = cur.fetchone() is not None
            if not is_owner:
                cur.execute("SELECT 1 FROM warehouse_access WHERE warehouse_id=%s", (warehouse_id,))
                has_acl_rows = cur.fetchone() is not None
                if has_acl_rows:
                    raise HTTPException(status_code=403, detail="forbidden")
        cur.execute("DELETE FROM warehouses WHERE id=%s", (warehouse_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="warehouse not found")


@app.get("/warehouses/access/users/search", response_model=list[UserLiteOut])
def search_users(q: str, request: FastAPIRequest) -> list[UserLiteOut]:
    require_access_admin(request)
    term = q.strip()
    if len(term) < 2:
        return []

    token = keycloak_admin_token()
    req = Request(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users?search={term}&max=20",
        headers={"authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        payload = resp.read().decode("utf-8")

    import json

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


@app.get("/warehouses/access/users/{user_uuid}", response_model=UserAccessOut)
def get_user_access(user_uuid: str, request: FastAPIRequest) -> UserAccessOut:
    require_access_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT warehouse_id FROM warehouse_access WHERE user_uuid=%s ORDER BY created_at ASC",
            (user_uuid,),
        )
        rows = cur.fetchall()
    return UserAccessOut(user_uuid=user_uuid, warehouse_ids=[row[0] for row in rows])


@app.put("/warehouses/access/users/{user_uuid}", response_model=UserAccessOut)
def replace_user_access(user_uuid: str, body: UserAccessReplaceIn, request: FastAPIRequest) -> UserAccessOut:
    require_access_admin(request)
    role = body.role.strip().lower()
    if not role:
        raise HTTPException(status_code=400, detail="role must not be empty")
    warehouse_ids = list(dict.fromkeys(body.warehouse_ids))
    with db() as conn, conn.cursor() as cur:
        if warehouse_ids:
            cur.execute("SELECT id FROM warehouses WHERE id = ANY(%s)", (warehouse_ids,))
            existing_ids = {row[0] for row in cur.fetchall()}
            if len(existing_ids) != len(warehouse_ids):
                raise HTTPException(status_code=400, detail="some warehouse_ids do not exist")
        cur.execute("DELETE FROM warehouse_access WHERE user_uuid=%s", (user_uuid,))
        for warehouse_id in warehouse_ids:
            cur.execute(
                """
                INSERT INTO warehouse_access (warehouse_id, user_uuid, role)
                VALUES (%s, %s, %s)
                ON CONFLICT (warehouse_id, user_uuid) DO UPDATE SET role=EXCLUDED.role
                """,
                (warehouse_id, user_uuid, role),
            )
    return UserAccessOut(user_uuid=user_uuid, warehouse_ids=warehouse_ids)

