import os
import time
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing env var: {name}")
    return value


DATABASE_URL = env("DATABASE_URL")
ADMIN_ROLES = {"superadmin", "admin", "communications_admin"}

MANIFEST = {
    "name": "communications",
    "bounded_context": "communications",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {"menu": {"title": "Новости", "items": [{"id": "news", "title": "Лента"}, {"id": "chat", "title": "Чат"}]}},
    "api": {"base_url": "http://communications:8000"},
}


class NewsPostIn(BaseModel):
    type: Literal["news", "warning", "rule"] = "news"
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    rule_reference: str = Field(default="", max_length=500)
    is_published: bool = True


class NewsPostOut(NewsPostIn):
    id: UUID
    created_by: str
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None


class ChatMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class ChatMessageOut(ChatMessageIn):
    id: int
    created_by: str
    created_at: datetime


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def require_user_uuid(request: Request) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def roles_from_headers(request: Request) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    return {part.strip() for part in raw.split(",") if part.strip()}


def require_admin(request: Request) -> str:
    user_uuid = require_user_uuid(request)
    if roles_from_headers(request).intersection(ADMIN_ROLES):
        return user_uuid
    raise HTTPException(status_code=403, detail="forbidden: admin role required")


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS communication_posts (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              type TEXT NOT NULL CHECK (type IN ('news', 'warning', 'rule')),
              title TEXT NOT NULL,
              body TEXT NOT NULL,
              rule_reference TEXT NOT NULL DEFAULT '',
              is_published BOOLEAN NOT NULL DEFAULT TRUE,
              created_by TEXT NOT NULL DEFAULT '',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              published_at TIMESTAMPTZ
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_communication_posts_published ON communication_posts (is_published, published_at DESC)")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS communication_chat_messages (
              id BIGSERIAL PRIMARY KEY,
              body TEXT NOT NULL,
              created_by TEXT NOT NULL DEFAULT '',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )


def post_from_row(row: tuple) -> NewsPostOut:
    return NewsPostOut(
        id=row[0],
        type=row[1],
        title=row[2],
        body=row[3],
        rule_reference=row[4],
        is_published=row[5],
        created_by=row[6],
        created_at=row[7],
        updated_at=row[8],
        published_at=row[9],
    )


app = FastAPI(title="communications", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("communications-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


@app.get("/news", response_model=list[NewsPostOut])
def list_news(type: Literal["news", "warning", "rule"] | None = None, limit: int = Query(50, ge=1, le=200)) -> list[NewsPostOut]:
    where = ["is_published = TRUE"]
    params: list[object] = []
    if type:
        where.append("type = %s")
        params.append(type)
    params.append(limit)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, type, title, body, rule_reference, is_published, created_by, created_at, updated_at, published_at
            FROM communication_posts
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(published_at, created_at) DESC
            LIMIT %s
            """,
            params,
        )
        return [post_from_row(row) for row in cur.fetchall()]


@app.post("/news", response_model=NewsPostOut)
def create_news(payload: NewsPostIn, request: Request) -> NewsPostOut:
    created_by = require_admin(request)
    now = utcnow()
    published_at = now if payload.is_published else None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO communication_posts (type, title, body, rule_reference, is_published, created_by, created_at, updated_at, published_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, type, title, body, rule_reference, is_published, created_by, created_at, updated_at, published_at
            """,
            (payload.type, payload.title.strip(), payload.body.strip(), payload.rule_reference.strip(), payload.is_published, created_by, now, now, published_at),
        )
        return post_from_row(cur.fetchone())


@app.get("/chat/messages", response_model=list[ChatMessageOut])
def list_chat_messages(limit: int = Query(100, ge=1, le=300)) -> list[ChatMessageOut]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, body, created_by, created_at
            FROM communication_chat_messages
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return [ChatMessageOut(id=row[0], body=row[1], created_by=row[2], created_at=row[3]) for row in reversed(rows)]


@app.post("/chat/messages", response_model=ChatMessageOut)
def create_chat_message(payload: ChatMessageIn, request: Request) -> ChatMessageOut:
    created_by = require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO communication_chat_messages (body, created_by)
            VALUES (%s, %s)
            RETURNING id, body, created_by, created_at
            """,
            (payload.body.strip(), created_by),
        )
        row = cur.fetchone()
    return ChatMessageOut(id=row[0], body=row[1], created_by=row[2], created_at=row[3])
