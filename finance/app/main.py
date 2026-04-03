import json
import os
import time
import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from app.manifests import MANIFEST


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
KEYCLOAK_INTERNAL_URL = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS price_rules (
              work_type_uuid UUID PRIMARY KEY,
              amount NUMERIC NOT NULL,
              currency TEXT NOT NULL DEFAULT 'RUB',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS order_finance_lines (
              id UUID PRIMARY KEY,
              order_uuid UUID NOT NULL,
              work_type_uuid UUID NOT NULL,
              amount NUMERIC NOT NULL,
              currency TEXT NOT NULL DEFAULT 'RUB',
              payment_method TEXT NOT NULL DEFAULT 'cash',
              source TEXT NOT NULL DEFAULT 'manual',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE(order_uuid, work_type_uuid)
            );
            """
        )
        cur.execute(
            """
            ALTER TABLE order_finance_lines
            ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
            """
        )
        cur.execute(
            """
            ALTER TABLE order_finance_lines
            ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE;
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS order_finance_line_history (
              id UUID PRIMARY KEY,
              order_uuid UUID NOT NULL,
              work_type_uuid UUID NOT NULL,
              old_amount NUMERIC,
              new_amount NUMERIC,
              old_is_paid BOOLEAN,
              new_is_paid BOOLEAN,
              old_payment_method TEXT,
              new_payment_method TEXT,
              changed_by_uuid TEXT,
              changed_by_name TEXT NOT NULL DEFAULT '',
              changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_finance_line_history_order_changed_at
            ON order_finance_line_history(order_uuid, changed_at DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_finance_lines (
              id UUID PRIMARY KEY,
              deal_uuid UUID NOT NULL UNIQUE,
              amount NUMERIC NOT NULL,
              currency TEXT NOT NULL DEFAULT 'RUB',
              payment_method TEXT NOT NULL DEFAULT 'cashbox',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_finance_line_history (
              id UUID PRIMARY KEY,
              deal_uuid UUID NOT NULL,
              old_amount NUMERIC,
              new_amount NUMERIC,
              old_payment_method TEXT,
              new_payment_method TEXT,
              changed_by_uuid TEXT,
              changed_by_name TEXT NOT NULL DEFAULT '',
              changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_buyback_finance_history_deal_changed_at
            ON buyback_finance_line_history(deal_uuid, changed_at DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS finance_settings (
              key TEXT PRIMARY KEY,
              value JSONB NOT NULL DEFAULT '[]'::jsonb,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )


class PriceRuleIn(BaseModel):
    amount: float
    currency: str = Field(default="RUB", min_length=1, max_length=8)


class PriceRuleOut(BaseModel):
    work_type_uuid: uuid.UUID
    amount: float
    currency: str
    updated_at: datetime


class OrderFinanceLineIn(BaseModel):
    order_uuid: uuid.UUID
    work_type_uuid: uuid.UUID
    amount: float | None = None
    currency: str | None = None
    payment_method: Literal["card", "cash"] | None = None
    is_paid: bool | None = None


class OrderFinanceLineOut(BaseModel):
    id: uuid.UUID
    order_uuid: uuid.UUID
    work_type_uuid: uuid.UUID
    amount: float
    currency: str
    payment_method: Literal["card", "cash"]
    is_paid: bool
    source: str
    updated_at: datetime


class FinanceLineHistoryOut(BaseModel):
    id: uuid.UUID
    order_uuid: uuid.UUID
    work_type_uuid: uuid.UUID
    old_amount: float | None = None
    new_amount: float | None = None
    old_is_paid: bool | None = None
    new_is_paid: bool | None = None
    old_payment_method: str | None = None
    new_payment_method: str | None = None
    changed_by_uuid: str | None = None
    changed_by_name: str = ""
    changed_at: datetime


class BuybackFinanceLineIn(BaseModel):
    deal_uuid: uuid.UUID
    amount: float
    currency: str = Field(default="RUB", min_length=1, max_length=8)
    payment_method: Literal["cashbox", "online_transfer"]


class BuybackFinanceLineOut(BaseModel):
    id: uuid.UUID
    deal_uuid: uuid.UUID
    amount: float
    currency: str
    payment_method: Literal["cashbox", "online_transfer"]
    updated_at: datetime


class BuybackFinanceHistoryOut(BaseModel):
    id: uuid.UUID
    deal_uuid: uuid.UUID
    old_amount: float | None = None
    new_amount: float | None = None
    old_payment_method: str | None = None
    new_payment_method: str | None = None
    changed_by_uuid: str | None = None
    changed_by_name: str = ""
    changed_at: datetime


class FinanceSettingsOut(BaseModel):
    money_visible_related_modules: list[str] = Field(default_factory=list)


class FinanceSettingsIn(BaseModel):
    money_visible_related_modules: list[str] = Field(default_factory=list)


app = FastAPI(title="finance", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("finance-db not ready")


def _normalize_module_names(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values or []:
        name = str(raw or "").strip().lower()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "finance"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "finance", "bounded_context": "finance", "status": "running"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


@app.get("/finance/settings", response_model=FinanceSettingsOut)
def get_finance_settings() -> FinanceSettingsOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT value FROM finance_settings WHERE key = 'money_visible_related_modules'")
        row = cur.fetchone()
    if not row:
        return FinanceSettingsOut(money_visible_related_modules=[])
    value = row[0]
    if not isinstance(value, list):
        return FinanceSettingsOut(money_visible_related_modules=[])
    return FinanceSettingsOut(money_visible_related_modules=_normalize_module_names(value))


@app.put("/finance/settings", response_model=FinanceSettingsOut)
def update_finance_settings(body: FinanceSettingsIn) -> FinanceSettingsOut:
    normalized = _normalize_module_names(body.money_visible_related_modules)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO finance_settings (key, value, updated_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (key)
            DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
            """,
            ("money_visible_related_modules", json.dumps(normalized, ensure_ascii=False)),
        )
    return FinanceSettingsOut(money_visible_related_modules=normalized)


@app.put("/finance/price-rules/{work_type_uuid}", response_model=PriceRuleOut)
def upsert_price_rule(work_type_uuid: uuid.UUID, body: PriceRuleIn) -> PriceRuleOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO price_rules (work_type_uuid, amount, currency, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (work_type_uuid)
            DO UPDATE SET amount=EXCLUDED.amount, currency=EXCLUDED.currency, updated_at=NOW()
            RETURNING work_type_uuid, amount, currency, updated_at
            """,
            (work_type_uuid, body.amount, body.currency.strip()),
        )
        row = cur.fetchone()
    return PriceRuleOut(
        work_type_uuid=row[0],
        amount=float(row[1]),
        currency=row[2],
        updated_at=row[3],
    )


@app.get("/finance/price-rules/{work_type_uuid}", response_model=PriceRuleOut)
def get_price_rule(work_type_uuid: uuid.UUID) -> PriceRuleOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT work_type_uuid, amount, currency, updated_at FROM price_rules WHERE work_type_uuid=%s",
            (work_type_uuid,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="price rule not found")
    return PriceRuleOut(
        work_type_uuid=row[0],
        amount=float(row[1]),
        currency=row[2],
        updated_at=row[3],
    )


@app.put("/finance/order-lines", response_model=OrderFinanceLineOut)
def upsert_order_line(body: OrderFinanceLineIn, request: Request) -> OrderFinanceLineOut:
    amount = body.amount
    currency = body.currency.strip() if body.currency else None
    payment_method = body.payment_method or "cash"
    is_paid = bool(body.is_paid) if body.is_paid is not None else False
    source = "manual"
    changed_by_uuid = str(request.headers.get("x-user-uuid", "")).strip() or None
    changed_by_name = _resolve_user_name(changed_by_uuid)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT amount, is_paid, payment_method
            FROM order_finance_lines
            WHERE order_uuid=%s AND work_type_uuid=%s
            """,
            (body.order_uuid, body.work_type_uuid),
        )
        previous = cur.fetchone()
        if amount is None:
            cur.execute(
                "SELECT amount, currency FROM price_rules WHERE work_type_uuid=%s",
                (body.work_type_uuid,),
            )
            rule = cur.fetchone()
            if not rule:
                raise HTTPException(
                    status_code=400,
                    detail="price rule not found for work_type_uuid, pass amount manually or create rule first",
                )
            amount = float(rule[0])
            if not currency:
                currency = rule[1]
            source = "rule"
        if currency is None:
            currency = "RUB"

        cur.execute(
            """
            INSERT INTO order_finance_lines (id, order_uuid, work_type_uuid, amount, currency, payment_method, is_paid, source, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (order_uuid, work_type_uuid)
            DO UPDATE SET amount=EXCLUDED.amount, currency=EXCLUDED.currency, payment_method=EXCLUDED.payment_method, is_paid=EXCLUDED.is_paid, source=EXCLUDED.source, updated_at=NOW()
            RETURNING id, order_uuid, work_type_uuid, amount, currency, payment_method, is_paid, source, updated_at
            """,
            (uuid.uuid4(), body.order_uuid, body.work_type_uuid, amount, currency, payment_method, is_paid, source),
        )
        row = cur.fetchone()
        old_amount = float(previous[0]) if previous and previous[0] is not None else None
        old_is_paid = bool(previous[1]) if previous and previous[1] is not None else None
        old_payment_method = str(previous[2]) if previous and previous[2] is not None else None
        new_amount = float(row[3])
        new_is_paid = bool(row[6])
        new_payment_method = str(row[5])
        changed = (
            previous is None
            or old_amount != new_amount
            or old_is_paid != new_is_paid
            or old_payment_method != new_payment_method
        )
        if changed:
            cur.execute(
                """
                INSERT INTO order_finance_line_history (
                  id, order_uuid, work_type_uuid,
                  old_amount, new_amount,
                  old_is_paid, new_is_paid,
                  old_payment_method, new_payment_method,
                  changed_by_uuid, changed_by_name, changed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    uuid.uuid4(),
                    body.order_uuid,
                    body.work_type_uuid,
                    old_amount,
                    new_amount,
                    old_is_paid,
                    new_is_paid,
                    old_payment_method,
                    new_payment_method,
                    changed_by_uuid,
                    changed_by_name,
                ),
            )
    return OrderFinanceLineOut(
        id=row[0],
        order_uuid=row[1],
        work_type_uuid=row[2],
        amount=float(row[3]),
        currency=row[4],
        payment_method=row[5],
        is_paid=bool(row[6]),
        source=row[7],
        updated_at=row[8],
    )


@app.get("/finance/orders/{order_uuid}/history", response_model=list[FinanceLineHistoryOut])
def list_order_history(order_uuid: uuid.UUID, limit: int = 100) -> list[FinanceLineHistoryOut]:
    safe_limit = max(1, min(int(limit), 500))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              id, order_uuid, work_type_uuid,
              old_amount, new_amount,
              old_is_paid, new_is_paid,
              old_payment_method, new_payment_method,
              changed_by_uuid, changed_by_name, changed_at
            FROM order_finance_line_history
            WHERE order_uuid=%s
            ORDER BY changed_at DESC
            LIMIT %s
            """,
            (order_uuid, safe_limit),
        )
        rows = cur.fetchall()
    return [
        FinanceLineHistoryOut(
            id=row[0],
            order_uuid=row[1],
            work_type_uuid=row[2],
            old_amount=float(row[3]) if row[3] is not None else None,
            new_amount=float(row[4]) if row[4] is not None else None,
            old_is_paid=bool(row[5]) if row[5] is not None else None,
            new_is_paid=bool(row[6]) if row[6] is not None else None,
            old_payment_method=row[7],
            new_payment_method=row[8],
            changed_by_uuid=row[9],
            changed_by_name=row[10] or "",
            changed_at=row[11],
        )
        for row in rows
    ]


@app.get("/finance/orders/{order_uuid}/lines", response_model=list[OrderFinanceLineOut])
def list_order_lines(order_uuid: uuid.UUID) -> list[OrderFinanceLineOut]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, order_uuid, work_type_uuid, amount, currency, payment_method, is_paid, source, updated_at
            FROM order_finance_lines
            WHERE order_uuid=%s
            ORDER BY updated_at DESC
            """,
            (order_uuid,),
        )
        rows = cur.fetchall()
    return [
        OrderFinanceLineOut(
            id=row[0],
            order_uuid=row[1],
            work_type_uuid=row[2],
            amount=float(row[3]),
            currency=row[4],
            payment_method=row[5],
            is_paid=bool(row[6]),
            source=row[7],
            updated_at=row[8],
        )
        for row in rows
    ]


@app.put("/finance/buyback-lines", response_model=BuybackFinanceLineOut)
def upsert_buyback_line(body: BuybackFinanceLineIn, request: Request) -> BuybackFinanceLineOut:
    changed_by_uuid = str(request.headers.get("x-user-uuid", "")).strip() or None
    changed_by_name = _resolve_user_name(changed_by_uuid)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT amount, payment_method
            FROM buyback_finance_lines
            WHERE deal_uuid=%s
            """,
            (body.deal_uuid,),
        )
        previous = cur.fetchone()
        cur.execute(
            """
            INSERT INTO buyback_finance_lines (id, deal_uuid, amount, currency, payment_method, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (deal_uuid)
            DO UPDATE SET amount=EXCLUDED.amount, currency=EXCLUDED.currency, payment_method=EXCLUDED.payment_method, updated_at=NOW()
            RETURNING id, deal_uuid, amount, currency, payment_method, updated_at
            """,
            (uuid.uuid4(), body.deal_uuid, body.amount, body.currency.strip(), body.payment_method),
        )
        row = cur.fetchone()
        old_amount = float(previous[0]) if previous and previous[0] is not None else None
        old_payment_method = str(previous[1]) if previous and previous[1] is not None else None
        new_amount = float(row[2])
        new_payment_method = str(row[4])
        changed = previous is None or old_amount != new_amount or old_payment_method != new_payment_method
        if changed:
            cur.execute(
                """
                INSERT INTO buyback_finance_line_history (
                  id, deal_uuid,
                  old_amount, new_amount,
                  old_payment_method, new_payment_method,
                  changed_by_uuid, changed_by_name, changed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    uuid.uuid4(),
                    body.deal_uuid,
                    old_amount,
                    new_amount,
                    old_payment_method,
                    new_payment_method,
                    changed_by_uuid,
                    changed_by_name,
                ),
            )
    return BuybackFinanceLineOut(
        id=row[0],
        deal_uuid=row[1],
        amount=float(row[2]),
        currency=row[3],
        payment_method=row[4],
        updated_at=row[5],
    )


@app.get("/finance/buyback-lines", response_model=list[BuybackFinanceLineOut])
def list_buyback_lines(limit: int = 500) -> list[BuybackFinanceLineOut]:
    safe_limit = max(1, min(int(limit), 2000))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, deal_uuid, amount, currency, payment_method, updated_at
            FROM buyback_finance_lines
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (safe_limit,),
        )
        rows = cur.fetchall()
    return [
        BuybackFinanceLineOut(
            id=row[0],
            deal_uuid=row[1],
            amount=float(row[2]),
            currency=row[3],
            payment_method=row[4],
            updated_at=row[5],
        )
        for row in rows
    ]


@app.get("/finance/buyback-lines/{deal_uuid}/history", response_model=list[BuybackFinanceHistoryOut])
def list_buyback_history(deal_uuid: uuid.UUID, limit: int = 100) -> list[BuybackFinanceHistoryOut]:
    safe_limit = max(1, min(int(limit), 500))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              id, deal_uuid,
              old_amount, new_amount,
              old_payment_method, new_payment_method,
              changed_by_uuid, changed_by_name, changed_at
            FROM buyback_finance_line_history
            WHERE deal_uuid=%s
            ORDER BY changed_at DESC
            LIMIT %s
            """,
            (deal_uuid, safe_limit),
        )
        rows = cur.fetchall()
    return [
        BuybackFinanceHistoryOut(
            id=row[0],
            deal_uuid=row[1],
            old_amount=float(row[2]) if row[2] is not None else None,
            new_amount=float(row[3]) if row[3] is not None else None,
            old_payment_method=row[4],
            new_payment_method=row[5],
            changed_by_uuid=row[6],
            changed_by_name=row[7] or "",
            changed_at=row[8],
        )
        for row in rows
    ]


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
    token = str(json.loads(payload or "{}").get("access_token") or "")
    if not token:
        return ""
    return token


def _resolve_user_name(user_uuid: str | None) -> str:
    if not user_uuid:
        return ""
    try:
        token = _keycloak_admin_token()
        if not token:
            return ""
        req = UrlRequest(
            f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_uuid}",
            headers={"authorization": f"Bearer {token}"},
            method="GET",
        )
        with urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
        first = str(payload.get("firstName") or "").strip()
        last = str(payload.get("lastName") or "").strip()
        full_name = (f"{first} {last}").strip()
        if full_name:
            return full_name
        username = str(payload.get("username") or "").strip()
        if username:
            return username
        return str(payload.get("email") or "").strip()
    except Exception:
        return ""
