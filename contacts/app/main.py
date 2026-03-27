import os
import re
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import psycopg2
from fastapi import FastAPI, HTTPException
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
    name: str = Field(min_length=1, max_length=200)
    phone: str


class ContactOut(BaseModel):
    id: UUID
    name: str
    phone: str


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


@app.get("/contacts", response_model=list[ContactOut])
def list_contacts():
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name, phone FROM contacts ORDER BY created_at DESC")
        rows = cur.fetchall()
    return [{"id": row[0], "name": row[1], "phone": row[2]} for row in rows]


@app.get("/contacts/search", response_model=list[ContactOut])
def search_contacts(phone: str = "", limit: int = 20):
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
            WHERE regexp_replace(phone, '\D', '', 'g') LIKE %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (like_value, safe_limit),
        )
        rows = cur.fetchall()
    return [{"id": row[0], "name": row[1], "phone": row[2]} for row in rows]


@app.get("/contacts/{contact_id}", response_model=ContactOut)
def get_contact(contact_id: UUID):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, phone
            FROM contacts
            WHERE id = %s
            """,
            (str(contact_id),),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="contact not found")
    return {"id": row[0], "name": row[1], "phone": row[2]}


@app.post("/contacts", response_model=ContactOut, status_code=201)
def create_contact(payload: ContactIn):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")
    phone = _validate_phone(payload.phone)
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                INSERT INTO contacts (id, name, phone)
                VALUES (%s, %s, %s)
                RETURNING id, name, phone
                """,
                (str(uuid4()), name, phone),
            )
            row = cur.fetchone()
            conn.commit()
        except Exception as exc:
            conn.rollback()
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": row[0], "name": row[1], "phone": row[2]}


@app.put("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: UUID, payload: ContactIn):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")
    phone = _validate_phone(payload.phone)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE contacts
            SET name = %s, phone = %s
            WHERE id = %s
            RETURNING id, name, phone
            """,
            (name, phone, str(contact_id)),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="contact not found")
        conn.commit()
    return {"id": row[0], "name": row[1], "phone": row[2]}


@app.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: UUID):
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM contacts WHERE id = %s", (str(contact_id),))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="contact not found")
        conn.commit()

