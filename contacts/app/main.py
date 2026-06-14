import os
import re
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import psycopg2
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from app.manifests import MANIFEST

PHONE_RE = re.compile(r"^\+7\d{3}-\d{3}-\d{2}-\d{2}$")


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if not value:
        raise RuntimeError(f"Missing env var: {name}")
    return value


DATABASE_URL = env("DATABASE_URL")


def db():
    return psycopg2.connect(DATABASE_URL)


class ContactIn(BaseModel):
    name: str = Field(default="", max_length=200)
    phone: str


class ContactOut(BaseModel):
    id: UUID
    name: str
    phone: str


class TenantBackfillOut(BaseModel):
    tenant_id: str
    updated: dict[str, int]


def _require_user_uuid(request: Request) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


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


def _require_admin(request: Request) -> None:
    _require_user_uuid(request)
    if _roles_from_headers(request).intersection({"admin", "superadmin"}):
        return
    raise HTTPException(status_code=403, detail="forbidden: admin role required")


def _validate_phone(phone: str) -> str:
    value = phone.strip()
    if not PHONE_RE.match(value):
        raise HTTPException(status_code=400, detail="phone must be in format +7xxx-xxx-xx-xx")
    return value


def _phone_digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Contacts Service", description="Bounded context: contacts", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "contacts"}


@app.get("/")
async def root():
    return {"service": "contacts", "bounded_context": "contacts", "status": "running"}


@app.get("/manifest")
async def manifest():
    return MANIFEST


@app.post("/contacts/tenant/backfill", response_model=TenantBackfillOut)
def backfill_legacy_contacts_tenant(request: Request) -> TenantBackfillOut:
    _require_admin(request)
    tenant_id = _require_tenant_id(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE contacts SET tenant_id = %s WHERE NULLIF(tenant_id, '') IS NULL",
            (tenant_id,),
        )
        updated = {"contacts": int(cur.rowcount or 0)}
        conn.commit()
    return TenantBackfillOut(tenant_id=tenant_id, updated=updated)


@app.get("/contacts", response_model=list[ContactOut])
def list_contacts(request: Request):
    _require_user_uuid(request)
    tenant_id = _require_tenant_id(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, phone
            FROM contacts
            WHERE tenant_id = %s
            ORDER BY created_at DESC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [{"id": row[0], "name": row[1], "phone": row[2]} for row in rows]


@app.get("/contacts/search", response_model=list[ContactOut])
def search_contacts(request: Request, phone: str = "", limit: int = 20):
    _require_user_uuid(request)
    tenant_id = _require_tenant_id(request)
    query_digits = _phone_digits(phone)
    if not query_digits:
        return []
    safe_limit = max(1, min(int(limit), 100))
    like_value = f"%{query_digits}%"
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, phone
            FROM contacts
            WHERE tenant_id = %s
              AND regexp_replace(phone, '\D', '', 'g') LIKE %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (tenant_id, like_value, safe_limit),
        )
        rows = cur.fetchall()
    return [{"id": row[0], "name": row[1], "phone": row[2]} for row in rows]


@app.get("/contacts/{contact_id}", response_model=ContactOut)
def get_contact(contact_id: UUID, request: Request):
    _require_user_uuid(request)
    tenant_id = _require_tenant_id(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, phone
            FROM contacts
            WHERE id = %s AND tenant_id = %s
            """,
            (str(contact_id), tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="contact not found")
    return {"id": row[0], "name": row[1], "phone": row[2]}


@app.post("/contacts", response_model=ContactOut, status_code=201)
def create_contact(payload: ContactIn, request: Request):
    _require_user_uuid(request)
    tenant_id = _require_tenant_id(request)
    name = payload.name.strip()
    phone = _validate_phone(payload.phone)
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO contacts (tenant_id, id, name, phone)
                VALUES (%s, %s, %s, %s)
                RETURNING id, name, phone
                """,
                (tenant_id, str(uuid4()), name, phone),
            )
            row = cur.fetchone()
            conn.commit()
        except Exception as exc:
            conn.rollback()
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": row[0], "name": row[1], "phone": row[2]}


@app.put("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: UUID, payload: ContactIn, request: Request):
    _require_user_uuid(request)
    tenant_id = _require_tenant_id(request)
    name = payload.name.strip()
    phone = _validate_phone(payload.phone)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE contacts
            SET name = %s, phone = %s
            WHERE id = %s AND tenant_id = %s
            RETURNING id, name, phone
            """,
            (name, phone, str(contact_id), tenant_id),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="contact not found")
        conn.commit()
    return {"id": row[0], "name": row[1], "phone": row[2]}


@app.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: UUID, request: Request):
    _require_user_uuid(request)
    tenant_id = _require_tenant_id(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM contacts WHERE id = %s AND tenant_id = %s", (str(contact_id), tenant_id))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="contact not found")
        conn.commit()

