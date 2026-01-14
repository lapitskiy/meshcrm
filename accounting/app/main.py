import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any
import time

import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
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
CONSUMER_GROUP = env("EVENTS_CONSUMER_GROUP", "accounting")
SERVICE_NAME = env("SERVICE_NAME", "accounting")


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def rds() -> Redis:
    return Redis.from_url(REDIS_URL, decode_responses=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS prices (
              case_uuid UUID PRIMARY KEY,
              currency TEXT NULL,
              amount NUMERIC NULL,
              created_at TIMESTAMPTZ NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL
            );
            """
        )


def publish_event(event_type: str, case_uuid_val: uuid.UUID, payload: dict[str, Any]) -> None:
    event = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "case_uuid": str(case_uuid_val),
        "source": SERVICE_NAME,
        "payload": payload,
        "created_at": utcnow().isoformat(),
        "schema_version": 1,
    }
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


def ensure_consumer_group() -> None:
    client = rds()
    try:
        client.xgroup_create(EVENTS_STREAM, CONSUMER_GROUP, id="0-0", mkstream=True)
    except Exception:
        # group already exists
        pass


def handle_case_created(case_uuid_val: uuid.UUID) -> None:
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO prices (case_uuid, currency, amount, created_at, updated_at)
            VALUES (%s, NULL, NULL, %s, %s)
            ON CONFLICT (case_uuid) DO NOTHING
            """,
            (case_uuid_val, now, now),
        )


def consumer_loop(stop: threading.Event) -> None:
    client = rds()
    for _ in range(60):
        try:
            ensure_consumer_group()
            break
        except Exception:
            time.sleep(1)
    else:
        return
    consumer_name = f"{SERVICE_NAME}-{uuid.uuid4()}"
    last_id = ">"
    while not stop.is_set():
        try:
            entries = client.xreadgroup(
                groupname=CONSUMER_GROUP,
                consumername=consumer_name,
                streams={EVENTS_STREAM: last_id},
                count=10,
                block=5000,
            )
            if not entries:
                continue
            for _, msgs in entries:
                for msg_id, fields in msgs:
                    event_type = fields.get("event_type")
                    case_uuid_str = fields.get("case_uuid")
                    if event_type == "case.created" and case_uuid_str:
                        handle_case_created(uuid.UUID(case_uuid_str))
                    client.xack(EVENTS_STREAM, CONSUMER_GROUP, msg_id)
        except Exception:
            # best-effort consumer for MVP
            continue


class PriceSetIn(BaseModel):
    case_uuid: uuid.UUID
    currency: str = Field(min_length=1, max_length=8)
    amount: float


class PriceOut(BaseModel):
    case_uuid: uuid.UUID
    currency: str | None
    amount: float | None
    updated_at: datetime


app = FastAPI(title="accounting", version="0.1.0")
_stop = threading.Event()
_thread: threading.Thread | None = None


@app.on_event("startup")
def _startup() -> None:
    global _thread
    for _ in range(60):
        try:
            init_db()
            break
        except Exception:
            time.sleep(1)
    else:
        raise RuntimeError("accounting-db not ready")
    _thread = threading.Thread(target=consumer_loop, args=(_stop,), daemon=True)
    _thread.start()


@app.on_event("shutdown")
def _shutdown() -> None:
    _stop.set()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/accounting/price", response_model=PriceOut)
def set_price(body: PriceSetIn) -> PriceOut:
    now = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO prices (case_uuid, currency, amount, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (case_uuid) DO UPDATE SET currency=EXCLUDED.currency, amount=EXCLUDED.amount, updated_at=EXCLUDED.updated_at
            """,
            (body.case_uuid, body.currency, body.amount, now, now),
        )
        cur.execute("SELECT currency, amount, updated_at FROM prices WHERE case_uuid=%s", (body.case_uuid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="failed to set price")
        currency, amount, updated_at = row

    publish_event("price.set", body.case_uuid, {"currency": currency, "amount": float(amount)})
    return PriceOut(case_uuid=body.case_uuid, currency=currency, amount=float(amount), updated_at=updated_at)


