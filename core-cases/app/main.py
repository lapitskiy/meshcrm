import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any
import time

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from redis import Redis


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
REDIS_URL = env("REDIS_URL", "redis://redis:6379/0")
EVENTS_STREAM = env("EVENTS_STREAM", "case_events")
SOURCE = "core-cases"


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def rds() -> Redis:
    return Redis.from_url(REDIS_URL, decode_responses=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
              case_uuid UUID PRIMARY KEY,
              status TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              created_by UUID NULL
            );
            """
        )


def publish_event(event_type: str, case_uuid_val: uuid.UUID, payload: dict[str, Any]) -> dict[str, Any]:
    event = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "case_uuid": str(case_uuid_val),
        "source": SOURCE,
        "payload": payload,
        "created_at": utcnow().isoformat(),
        "schema_version": 1,
    }
    # Redis Streams fields are flat strings
    rds().xadd(
        EVENTS_STREAM,
        {
            "event_id": event["event_id"],
            "event_type": event["event_type"],
            "case_uuid": event["case_uuid"],
            "source": event["source"],
            "payload_json": json.dumps(event["payload"], ensure_ascii=False),
            "created_at": event["created_at"],
            "schema_version": str(event["schema_version"]),
        },
    )
    return event


class CaseOut(BaseModel):
    case_uuid: uuid.UUID
    status: str
    created_at: datetime


class StatusPatchIn(BaseModel):
    new_status: str


app = FastAPI(title="core-cases", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("cases-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/cases", response_model=CaseOut)
def create_case(request: Request) -> CaseOut:
    case_uuid_val = uuid.uuid4()
    status = "new"
    created_at = utcnow()
    created_by = request.headers.get("x-user-uuid")
    created_by_uuid = uuid.UUID(created_by) if created_by else None

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO cases (case_uuid, status, created_at, created_by) VALUES (%s,%s,%s,%s)",
            (case_uuid_val, status, created_at, created_by_uuid),
        )

    publish_event("case.created", case_uuid_val, {"status": status})
    return CaseOut(case_uuid=case_uuid_val, status=status, created_at=created_at)


@app.get("/cases/{case_uuid}", response_model=CaseOut)
def get_case(case_uuid: uuid.UUID) -> CaseOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT case_uuid, status, created_at FROM cases WHERE case_uuid=%s", (case_uuid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="case not found")
        return CaseOut(case_uuid=uuid.UUID(str(row[0])), status=row[1], created_at=row[2])


@app.patch("/cases/{case_uuid}/status", response_model=CaseOut)
def set_status(case_uuid: uuid.UUID, body: StatusPatchIn) -> CaseOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, created_at FROM cases WHERE case_uuid=%s", (case_uuid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="case not found")
        old_status = row[0]
        created_at = row[1]
        cur.execute("UPDATE cases SET status=%s WHERE case_uuid=%s", (body.new_status, case_uuid))

    publish_event("case.status_changed", case_uuid, {"old_status": old_status, "new_status": body.new_status})
    return CaseOut(case_uuid=case_uuid, status=body.new_status, created_at=created_at)


