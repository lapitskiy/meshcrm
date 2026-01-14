import os
import uuid
from datetime import datetime, timezone
from typing import Any
import time

import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS rules (
              rule_uuid UUID PRIMARY KEY,
              rule TEXT NOT NULL,
              enforced BOOLEAN NOT NULL,
              created_at TIMESTAMPTZ NOT NULL
            );
            """
        )


def seed_rules() -> None:
    axioms = [
        ("Core управляет CASE, а не заказами", True),
        ("Case — универсальная единица работы", True),
        ("case_uuid — единственный сквозной идентификатор", True),
        ("Один сервис = один bounded context", True),
        ("Нет общей БД между сервисами", True),
        ("Нет прямых импортов между сервисами (связи только через события)", True),
        ("PostgreSQL = source of truth", True),
        ("ClickHouse = read-only ускоритель", True),
        ("Плагины можно отключать, Core — нельзя", True),
        ("ИИ работает через AI Memory, а не угадывает", True),
    ]
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM rules")
        if (cur.fetchone() or [0])[0] > 0:
            return
        for rule, enforced in axioms:
            cur.execute(
                "INSERT INTO rules (rule_uuid, rule, enforced, created_at) VALUES (%s,%s,%s,%s)",
                (uuid.uuid4(), rule, enforced, utcnow()),
            )


class RuleIn(BaseModel):
    rule: str
    enforced: bool = True


class RuleOut(BaseModel):
    rule_uuid: uuid.UUID
    rule: str
    enforced: bool
    created_at: datetime


app = FastAPI(title="ai-memory", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            seed_rules()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("ai-memory-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/rules", response_model=list[RuleOut])
def list_rules() -> list[RuleOut]:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT rule_uuid, rule, enforced, created_at FROM rules ORDER BY created_at ASC")
        rows = cur.fetchall()
        return [
            RuleOut(rule_uuid=uuid.UUID(str(r[0])), rule=r[1], enforced=r[2], created_at=r[3]) for r in rows
        ]


@app.post("/rules", response_model=RuleOut)
def create_rule(body: RuleIn) -> RuleOut:
    rule_uuid = uuid.uuid4()
    created_at = utcnow()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO rules (rule_uuid, rule, enforced, created_at) VALUES (%s,%s,%s,%s)",
            (rule_uuid, body.rule, body.enforced, created_at),
        )
    return RuleOut(rule_uuid=rule_uuid, rule=body.rule, enforced=body.enforced, created_at=created_at)


@app.get("/rules/{rule_uuid}", response_model=RuleOut)
def get_rule(rule_uuid: uuid.UUID) -> RuleOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT rule_uuid, rule, enforced, created_at FROM rules WHERE rule_uuid=%s", (rule_uuid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="rule not found")
        return RuleOut(rule_uuid=uuid.UUID(str(row[0])), rule=row[1], enforced=row[2], created_at=row[3])


