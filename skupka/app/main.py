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


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing env var: {name}")
    return value


DATABASE_URL = env("DATABASE_URL")
ADMIN_ROLES = {"superadmin", "admin"}
KEYCLOAK_INTERNAL_URL = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")

MANIFEST = {
    "name": "skupka",
    "bounded_context": "skupka",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Скупка",
            "items": [
                {"id": "new-deal", "title": "Новая сделка"},
                {"id": "list", "title": "Список выкупов"},
                {"id": "categories", "title": "Категории"},
                {"id": "purchase-object", "title": "Объект покупки"},
                {"id": "statuses", "title": "Статусы"},
                {"id": "device-condition", "title": "Состояние устройства"},
            ],
        }
    },
    "api": {"base_url": "http://skupka:8000"},
}


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_settings (
              singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
              default_currency TEXT NOT NULL DEFAULT 'RUB',
              default_status TEXT NOT NULL DEFAULT 'new',
              notes TEXT NOT NULL DEFAULT '',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            INSERT INTO buyback_settings (singleton, default_currency, default_status, notes)
            VALUES (TRUE, 'RUB', 'new', '')
            ON CONFLICT (singleton) DO NOTHING;
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_deals (
              id UUID PRIMARY KEY,
              deal_number BIGINT UNIQUE,
              deal_type TEXT NOT NULL DEFAULT 'resale',
              category_id UUID,
              purchase_object_id UUID,
              title TEXT NOT NULL,
              client_name TEXT NOT NULL,
              client_phone TEXT NOT NULL,
              offered_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
              currency TEXT NOT NULL DEFAULT 'RUB',
              status TEXT NOT NULL DEFAULT 'new',
              comment TEXT NOT NULL DEFAULT '',
              contact_uuid TEXT,
              warehouse_id UUID,
              created_by_uuid TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS deal_number BIGINT;
            """
        )
        cur.execute(
            """
            CREATE SEQUENCE IF NOT EXISTS buyback_deal_number_seq;
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ALTER COLUMN deal_number SET DEFAULT nextval('buyback_deal_number_seq');
            """
        )
        cur.execute(
            """
            UPDATE buyback_deals
            SET deal_number = nextval('buyback_deal_number_seq')
            WHERE deal_number IS NULL;
            """
        )
        cur.execute(
            """
            SELECT setval(
              'buyback_deal_number_seq',
              COALESCE((SELECT MAX(deal_number) FROM buyback_deals), 0),
              true
            );
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_buyback_deals_deal_number
            ON buyback_deals(deal_number);
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'resale';
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS category_id UUID;
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS purchase_object_id UUID;
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS contact_uuid TEXT;
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS warehouse_id UUID;
            """
        )
        cur.execute(
            """
            ALTER TABLE buyback_deals
            ADD COLUMN IF NOT EXISTS realization_status TEXT NOT NULL DEFAULT 'Не реализован';
            """
        )
        cur.execute(
            """
            UPDATE buyback_deals
            SET realization_status = 'Не реализован'
            WHERE realization_status IS NULL OR BTRIM(realization_status) = '';
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_categories (
              id UUID PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_buyback_categories_name_ci
            ON buyback_categories (LOWER(name));
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_purchase_objects (
              id UUID PRIMARY KEY,
              category_id UUID NOT NULL,
              name TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_buyback_purchase_objects_category_name_ci
            ON buyback_purchase_objects (category_id, LOWER(name));
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_statuses (
              id UUID PRIMARY KEY,
              name TEXT NOT NULL,
              color TEXT NOT NULL DEFAULT '#3B82F6',
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_device_conditions (
              id UUID PRIMARY KEY,
              name TEXT NOT NULL,
              color TEXT NOT NULL DEFAULT '#3B82F6',
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS buyback_deal_device_conditions (
              deal_id UUID NOT NULL REFERENCES buyback_deals(id) ON DELETE CASCADE,
              device_condition_id UUID NOT NULL REFERENCES buyback_device_conditions(id) ON DELETE RESTRICT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (deal_id, device_condition_id)
            );
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_buyback_statuses_name_ci
            ON buyback_statuses (LOWER(name));
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_buyback_device_conditions_name_ci
            ON buyback_device_conditions (LOWER(name));
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_buyback_deals_created_at
            ON buyback_deals(created_at DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_buyback_purchase_objects_category_id
            ON buyback_purchase_objects(category_id, created_at DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_buyback_statuses_sort_order
            ON buyback_statuses(sort_order ASC, created_at ASC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_buyback_device_conditions_sort_order
            ON buyback_device_conditions(sort_order ASC, created_at ASC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_buyback_deal_device_conditions_deal_id
            ON buyback_deal_device_conditions(deal_id, created_at ASC);
            """
        )


def require_user_uuid(request: Request) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def require_admin(request: Request) -> None:
    raw_roles = str(request.headers.get("x-user-roles", "")).strip()
    roles = {part.strip() for part in raw_roles.split(",") if part.strip()}
    if not roles.intersection(ADMIN_ROLES):
        raise HTTPException(status_code=403, detail="forbidden: admin role required")


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


def _fetch_keycloak_user(user_uuid: str) -> dict:
    token = _keycloak_admin_token()
    req = UrlRequest(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_uuid}",
        headers={"authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


class BuybackSettingsOut(BaseModel):
    default_currency: str
    default_status: str
    notes: str
    updated_at: datetime


class BuybackSettingsIn(BaseModel):
    default_currency: str = Field(default="RUB", min_length=1, max_length=10)
    default_status: str = Field(default="new", min_length=1, max_length=50)
    notes: str = Field(default="", max_length=4000)


class BuybackDealCreateIn(BaseModel):
    deal_type: Literal["parts", "resale"]
    category_id: uuid.UUID
    purchase_object_id: uuid.UUID
    device_condition_ids: list[uuid.UUID] = Field(default_factory=list)
    title: str = Field(min_length=1, max_length=255)
    client_name: str = Field(min_length=1, max_length=255)
    client_phone: str = Field(default="", max_length=50)
    offered_amount: float = Field(ge=0)
    comment: str = Field(default="", max_length=4000)
    contact_uuid: str | None = Field(default=None, max_length=255)
    warehouse_id: uuid.UUID | None = None


class BuybackDealOut(BaseModel):
    id: uuid.UUID
    deal_number: int | None = None
    deal_type: str
    category_id: uuid.UUID | None = None
    category_name: str = ""
    purchase_object_id: uuid.UUID | None = None
    purchase_object_name: str = ""
    device_condition_names: list[str] = []
    title: str
    client_name: str
    client_phone: str
    offered_amount: float
    currency: str
    status: str
    realization_status: str
    comment: str
    contact_uuid: str = ""
    warehouse_id: uuid.UUID | None = None
    created_by_uuid: str
    created_at: datetime


class BuybackCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class BuybackCategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime


class BuybackPurchaseObjectIn(BaseModel):
    category_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)


class BuybackPurchaseObjectOut(BaseModel):
    id: uuid.UUID
    category_id: uuid.UUID
    category_name: str
    name: str
    created_at: datetime


class BuybackStatusIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    color: str = Field(default="#3B82F6", min_length=4, max_length=20)


class BuybackStatusOut(BaseModel):
    id: uuid.UUID
    name: str
    color: str
    sort_order: int
    created_at: datetime


class BuybackStatusReorderIn(BaseModel):
    ids: list[uuid.UUID] = Field(default_factory=list)


class BuybackDeviceConditionIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    color: str = Field(default="#3B82F6", min_length=4, max_length=20)


class BuybackDeviceConditionOut(BaseModel):
    id: uuid.UUID
    name: str
    color: str
    sort_order: int
    created_at: datetime


class BuybackDeviceConditionReorderIn(BaseModel):
    ids: list[uuid.UUID] = Field(default_factory=list)


class DealCreatorOptionOut(BaseModel):
    user_uuid: str
    username: str
    email: str
    full_name: str


app = FastAPI(title="skupka", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("skupka-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "skupka"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "skupka", "bounded_context": "skupka", "status": "running"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


@app.get("/settings", response_model=BuybackSettingsOut)
@app.get("/skupka/settings", response_model=BuybackSettingsOut)
def get_settings(request: Request) -> BuybackSettingsOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT default_currency, default_status, notes, updated_at
            FROM buyback_settings
            WHERE singleton = TRUE
            """
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="settings not found")
    return BuybackSettingsOut(
        default_currency=row[0],
        default_status=row[1],
        notes=row[2],
        updated_at=row[3],
    )


@app.put("/settings", response_model=BuybackSettingsOut)
@app.put("/skupka/settings", response_model=BuybackSettingsOut)
def update_settings(body: BuybackSettingsIn, request: Request) -> BuybackSettingsOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE buyback_settings
            SET default_currency=%s, default_status=%s, notes=%s, updated_at=NOW()
            WHERE singleton = TRUE
            RETURNING default_currency, default_status, notes, updated_at
            """,
            (body.default_currency.strip(), body.default_status.strip(), body.notes.strip()),
        )
        row = cur.fetchone()
    return BuybackSettingsOut(
        default_currency=row[0],
        default_status=row[1],
        notes=row[2],
        updated_at=row[3],
    )


@app.get("/deals", response_model=list[BuybackDealOut])
@app.get("/skupka/deals", response_model=list[BuybackDealOut])
def list_deals(request: Request, limit: int = 20) -> list[BuybackDealOut]:
    require_user_uuid(request)
    safe_limit = max(1, min(int(limit), 100))
    # allowed values for UI filter
    realization_status: str | None = request.query_params.get("realization_status")
    filter_status = str(realization_status or "").strip()
    if filter_status and filter_status not in {"Реализован", "Не реализован"}:
        raise HTTPException(status_code=400, detail="realization_status must be 'Реализован' or 'Не реализован'")
    with db() as conn, conn.cursor() as cur:
        where_sql = "WHERE d.realization_status = %s" if filter_status else ""
        params: list = [safe_limit]
        if filter_status:
            params = [filter_status, safe_limit]
        cur.execute(
            """
            SELECT
              d.id, d.deal_number, d.deal_type, d.category_id, COALESCE(c.name, ''),
              d.purchase_object_id, COALESCE(po.name, ''),
              COALESCE(ARRAY(
                SELECT dc.name
                FROM buyback_deal_device_conditions bddc
                JOIN buyback_device_conditions dc ON dc.id = bddc.device_condition_id
                WHERE bddc.deal_id = d.id
                ORDER BY dc.sort_order ASC, dc.created_at ASC
              ), ARRAY[]::TEXT[]),
              d.title, d.client_name, d.client_phone, d.offered_amount, d.currency,
              d.status, d.realization_status, d.comment, COALESCE(d.contact_uuid, ''), d.warehouse_id,
              d.created_by_uuid, d.created_at
            FROM buyback_deals d
            LEFT JOIN buyback_categories c ON c.id = d.category_id
            LEFT JOIN buyback_purchase_objects po ON po.id = d.purchase_object_id
            """
            + where_sql
            + """
            ORDER BY d.created_at DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [
        BuybackDealOut(
            id=row[0],
            deal_number=row[1],
            deal_type=row[2],
            category_id=row[3],
            category_name=row[4],
            purchase_object_id=row[5],
            purchase_object_name=row[6],
            device_condition_names=list(row[7] or []),
            title=row[8],
            client_name=row[9],
            client_phone=row[10],
            offered_amount=float(row[11]),
            currency=row[12],
            status=row[13],
            realization_status=row[14] or "Не реализован",
            comment=row[15],
            contact_uuid=row[16],
            warehouse_id=row[17],
            created_by_uuid=row[18],
            created_at=row[19],
        )
        for row in rows
    ]


@app.get("/deals/creators/options", response_model=list[DealCreatorOptionOut])
@app.get("/skupka/deals/creators/options", response_model=list[DealCreatorOptionOut])
def list_deal_creator_options(request: Request, q: str | None = None) -> list[DealCreatorOptionOut]:
    require_user_uuid(request)
    conn = None
    try:
        conn = db()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT created_by_uuid
                FROM buyback_deals
                WHERE created_by_uuid IS NOT NULL
                  AND created_by_uuid <> ''
                ORDER BY created_by_uuid
                """
            )
            rows = cur.fetchall()
        term = str(q or "").strip().lower()
        out: list[DealCreatorOptionOut] = []
        for row in rows:
            user_uuid = str(row[0] or "").strip()
            if not user_uuid:
                continue
            try:
                payload = _fetch_keycloak_user(user_uuid)
            except Exception:
                continue
            first = str(payload.get("firstName") or "").strip()
            last = str(payload.get("lastName") or "").strip()
            full_name = (f"{first} {last}").strip() or str(payload.get("username") or "").strip() or user_uuid
            item = DealCreatorOptionOut(
                user_uuid=user_uuid,
                username=str(payload.get("username") or "").strip(),
                email=str(payload.get("email") or "").strip(),
                full_name=full_name,
            )
            haystack = f"{item.full_name} {item.username} {item.email}".lower()
            if term and term not in haystack:
                continue
            out.append(item)
        out.sort(key=lambda item: (item.full_name.lower(), item.email.lower(), item.username.lower()))
        return out[:50]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@app.post("/deals", response_model=BuybackDealOut, status_code=201)
@app.post("/skupka/deals", response_model=BuybackDealOut, status_code=201)
def create_deal(body: BuybackDealCreateIn, request: Request) -> BuybackDealOut:
    created_by_uuid = require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT default_currency, default_status
            FROM buyback_settings
            WHERE singleton = TRUE
            """
        )
        settings_row = cur.fetchone()
        if not settings_row:
            raise HTTPException(status_code=500, detail="settings not initialized")
        currency, status = settings_row
        cur.execute("SELECT name FROM buyback_categories WHERE id=%s", (body.category_id,))
        category_row = cur.fetchone()
        if not category_row:
            raise HTTPException(status_code=404, detail="category not found")
        cur.execute(
            "SELECT name, category_id FROM buyback_purchase_objects WHERE id=%s",
            (body.purchase_object_id,),
        )
        purchase_object_row = cur.fetchone()
        if not purchase_object_row:
            raise HTTPException(status_code=404, detail="purchase object not found")
        if purchase_object_row[1] != body.category_id:
            raise HTTPException(status_code=400, detail="purchase object does not belong to category")
        normalized_condition_ids = list(dict.fromkeys(body.device_condition_ids))
        if not normalized_condition_ids:
            raise HTTPException(status_code=400, detail="at least one device condition is required")
        cur.execute(
            """
            SELECT id
            FROM buyback_device_conditions
            WHERE id = ANY(%s)
            """,
            (normalized_condition_ids,),
        )
        existing_condition_ids = {row[0] for row in cur.fetchall()}
        if existing_condition_ids != set(normalized_condition_ids):
            raise HTTPException(status_code=400, detail="device_condition_ids contain unknown ids")
        cur.execute(
            """
            INSERT INTO buyback_deals (
              id, deal_type, category_id, purchase_object_id, title, client_name, client_phone, offered_amount,
              currency, status, realization_status, comment, contact_uuid, warehouse_id, created_by_uuid, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING
              id, deal_number, deal_type, category_id, purchase_object_id, title, client_name, client_phone, offered_amount,
              currency, status, realization_status, comment, contact_uuid, warehouse_id, created_by_uuid, created_at
            """,
            (
                uuid.uuid4(),
                body.deal_type,
                body.category_id,
                body.purchase_object_id,
                body.title.strip(),
                body.client_name.strip(),
                body.client_phone.strip(),
                body.offered_amount,
                currency,
                status,
                "Не реализован",
                body.comment.strip(),
                (body.contact_uuid or "").strip() or None,
                body.warehouse_id,
                created_by_uuid,
            ),
        )
        row = cur.fetchone()
        for condition_id in normalized_condition_ids:
            cur.execute(
                """
                INSERT INTO buyback_deal_device_conditions (deal_id, device_condition_id, created_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (deal_id, device_condition_id) DO NOTHING
                """,
                (row[0], condition_id),
            )
        cur.execute(
            """
            SELECT name
            FROM buyback_device_conditions
            WHERE id = ANY(%s)
            ORDER BY sort_order ASC, created_at ASC
            """,
            (normalized_condition_ids,),
        )
        device_condition_names = [r[0] for r in cur.fetchall()]
    return BuybackDealOut(
        id=row[0],
        deal_number=row[1],
        deal_type=row[2],
        category_id=row[3],
        category_name=category_row[0],
        purchase_object_id=row[4],
        purchase_object_name=purchase_object_row[0],
        device_condition_names=device_condition_names,
        title=row[5],
        client_name=row[6],
        client_phone=row[7],
        offered_amount=float(row[8]),
        currency=row[9],
        status=row[10],
        realization_status=row[11] or "Не реализован",
        comment=row[12],
        contact_uuid=row[13] or "",
        warehouse_id=row[14],
        created_by_uuid=row[15],
        created_at=row[16],
    )


@app.get("/settings/categories", response_model=list[BuybackCategoryOut])
@app.get("/skupka/settings/categories", response_model=list[BuybackCategoryOut])
def list_buyback_categories(request: Request) -> list[BuybackCategoryOut]:
    require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, created_at
            FROM buyback_categories
            ORDER BY created_at DESC
            """
        )
        rows = cur.fetchall()
    return [BuybackCategoryOut(id=row[0], name=row[1], created_at=row[2]) for row in rows]


@app.post("/settings/categories", response_model=BuybackCategoryOut, status_code=201)
@app.post("/skupka/settings/categories", response_model=BuybackCategoryOut, status_code=201)
def create_buyback_category(body: BuybackCategoryIn, request: Request) -> BuybackCategoryOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO buyback_categories (id, name, created_at)
            VALUES (%s, %s, NOW())
            RETURNING id, name, created_at
            """,
            (uuid.uuid4(), body.name.strip()),
        )
        row = cur.fetchone()
    return BuybackCategoryOut(id=row[0], name=row[1], created_at=row[2])


@app.put("/settings/categories/{category_id}", response_model=BuybackCategoryOut)
@app.put("/skupka/settings/categories/{category_id}", response_model=BuybackCategoryOut)
def update_buyback_category(category_id: uuid.UUID, body: BuybackCategoryIn, request: Request) -> BuybackCategoryOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE buyback_categories
            SET name=%s
            WHERE id=%s
            RETURNING id, name, created_at
            """,
            (body.name.strip(), category_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="category not found")
    return BuybackCategoryOut(id=row[0], name=row[1], created_at=row[2])


@app.delete("/settings/categories/{category_id}", status_code=204)
@app.delete("/skupka/settings/categories/{category_id}", status_code=204)
def delete_buyback_category(category_id: uuid.UUID, request: Request) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM buyback_categories WHERE id=%s", (category_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="category not found")
        cur.execute("SELECT 1 FROM buyback_purchase_objects WHERE category_id=%s LIMIT 1", (category_id,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="category is used by purchase objects")
        cur.execute("DELETE FROM buyback_categories WHERE id=%s", (category_id,))


@app.get("/settings/purchase-objects", response_model=list[BuybackPurchaseObjectOut])
@app.get("/skupka/settings/purchase-objects", response_model=list[BuybackPurchaseObjectOut])
def list_buyback_purchase_objects(request: Request, category_id: uuid.UUID | None = None) -> list[BuybackPurchaseObjectOut]:
    require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        if category_id:
            cur.execute(
                """
                SELECT po.id, po.category_id, c.name, po.name, po.created_at
                FROM buyback_purchase_objects po
                JOIN buyback_categories c ON c.id = po.category_id
                WHERE po.category_id=%s
                ORDER BY po.created_at DESC
                """,
                (category_id,),
            )
        else:
            cur.execute(
                """
                SELECT po.id, po.category_id, c.name, po.name, po.created_at
                FROM buyback_purchase_objects po
                JOIN buyback_categories c ON c.id = po.category_id
                ORDER BY po.created_at DESC
                """
            )
        rows = cur.fetchall()
    return [
        BuybackPurchaseObjectOut(
            id=row[0],
            category_id=row[1],
            category_name=row[2],
            name=row[3],
            created_at=row[4],
        )
        for row in rows
    ]


@app.post("/settings/purchase-objects", response_model=BuybackPurchaseObjectOut, status_code=201)
@app.post("/skupka/settings/purchase-objects", response_model=BuybackPurchaseObjectOut, status_code=201)
def create_buyback_purchase_object(body: BuybackPurchaseObjectIn, request: Request) -> BuybackPurchaseObjectOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM buyback_categories WHERE id=%s", (body.category_id,))
        category_row = cur.fetchone()
        if not category_row:
            raise HTTPException(status_code=404, detail="category not found")
        cur.execute(
            """
            INSERT INTO buyback_purchase_objects (id, category_id, name, created_at)
            VALUES (%s, %s, %s, NOW())
            RETURNING id, category_id, name, created_at
            """,
            (uuid.uuid4(), body.category_id, body.name.strip()),
        )
        row = cur.fetchone()
    return BuybackPurchaseObjectOut(
        id=row[0],
        category_id=row[1],
        category_name=category_row[0],
        name=row[2],
        created_at=row[3],
    )


@app.put("/settings/purchase-objects/{object_id}", response_model=BuybackPurchaseObjectOut)
@app.put("/skupka/settings/purchase-objects/{object_id}", response_model=BuybackPurchaseObjectOut)
def update_buyback_purchase_object(
    object_id: uuid.UUID, body: BuybackPurchaseObjectIn, request: Request
) -> BuybackPurchaseObjectOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM buyback_categories WHERE id=%s", (body.category_id,))
        category_row = cur.fetchone()
        if not category_row:
            raise HTTPException(status_code=404, detail="category not found")
        cur.execute(
            """
            UPDATE buyback_purchase_objects
            SET category_id=%s, name=%s
            WHERE id=%s
            RETURNING id, category_id, name, created_at
            """,
            (body.category_id, body.name.strip(), object_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="purchase object not found")
    return BuybackPurchaseObjectOut(
        id=row[0],
        category_id=row[1],
        category_name=category_row[0],
        name=row[2],
        created_at=row[3],
    )


@app.delete("/settings/purchase-objects/{object_id}", status_code=204)
@app.delete("/skupka/settings/purchase-objects/{object_id}", status_code=204)
def delete_buyback_purchase_object(object_id: uuid.UUID, request: Request) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM buyback_purchase_objects WHERE id=%s", (object_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="purchase object not found")


@app.get("/settings/statuses", response_model=list[BuybackStatusOut])
@app.get("/skupka/settings/statuses", response_model=list[BuybackStatusOut])
def list_buyback_statuses(request: Request) -> list[BuybackStatusOut]:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, color, sort_order, created_at
            FROM buyback_statuses
            ORDER BY sort_order ASC, created_at ASC
            """
        )
        rows = cur.fetchall()
    return [
        BuybackStatusOut(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])
        for row in rows
    ]


@app.post("/settings/statuses", response_model=BuybackStatusOut, status_code=201)
@app.post("/skupka/settings/statuses", response_model=BuybackStatusOut, status_code=201)
def create_buyback_status(body: BuybackStatusIn, request: Request) -> BuybackStatusOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM buyback_statuses")
        next_sort_order = int(cur.fetchone()[0] or 1)
        cur.execute(
            """
            INSERT INTO buyback_statuses (id, name, color, sort_order, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING id, name, color, sort_order, created_at
            """,
            (uuid.uuid4(), body.name.strip(), body.color.strip(), next_sort_order),
        )
        row = cur.fetchone()
    return BuybackStatusOut(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])


@app.put("/settings/statuses/{status_id}", response_model=BuybackStatusOut)
@app.put("/skupka/settings/statuses/{status_id}", response_model=BuybackStatusOut)
def update_buyback_status(status_id: uuid.UUID, body: BuybackStatusIn, request: Request) -> BuybackStatusOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE buyback_statuses
            SET name=%s, color=%s
            WHERE id=%s
            RETURNING id, name, color, sort_order, created_at
            """,
            (body.name.strip(), body.color.strip(), status_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="status not found")
    return BuybackStatusOut(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])


@app.delete("/settings/statuses/{status_id}", status_code=204)
@app.delete("/skupka/settings/statuses/{status_id}", status_code=204)
def delete_buyback_status(status_id: uuid.UUID, request: Request) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM buyback_statuses WHERE id=%s", (status_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="status not found")


@app.post("/settings/statuses/reorder", status_code=204)
@app.post("/skupka/settings/statuses/reorder", status_code=204)
def reorder_buyback_statuses(body: BuybackStatusReorderIn, request: Request) -> None:
    require_admin(request)
    ids_in_order = list(dict.fromkeys(body.ids))
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM buyback_statuses")
        existing_ids = {row[0] for row in cur.fetchall()}
        if existing_ids != set(ids_in_order):
            raise HTTPException(status_code=400, detail="ids must match existing statuses")
        for index, status_id in enumerate(ids_in_order, start=1):
            cur.execute("UPDATE buyback_statuses SET sort_order=%s WHERE id=%s", (index, status_id))


@app.get("/settings/device-conditions", response_model=list[BuybackDeviceConditionOut])
@app.get("/skupka/settings/device-conditions", response_model=list[BuybackDeviceConditionOut])
def list_buyback_device_conditions(request: Request) -> list[BuybackDeviceConditionOut]:
    require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, color, sort_order, created_at
            FROM buyback_device_conditions
            ORDER BY sort_order ASC, created_at ASC
            """
        )
        rows = cur.fetchall()
    return [
        BuybackDeviceConditionOut(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])
        for row in rows
    ]


@app.post("/settings/device-conditions", response_model=BuybackDeviceConditionOut, status_code=201)
@app.post("/skupka/settings/device-conditions", response_model=BuybackDeviceConditionOut, status_code=201)
def create_buyback_device_condition(body: BuybackDeviceConditionIn, request: Request) -> BuybackDeviceConditionOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM buyback_device_conditions")
        next_sort_order = int(cur.fetchone()[0] or 1)
        cur.execute(
            """
            INSERT INTO buyback_device_conditions (id, name, color, sort_order, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING id, name, color, sort_order, created_at
            """,
            (uuid.uuid4(), body.name.strip(), body.color.strip(), next_sort_order),
        )
        row = cur.fetchone()
    return BuybackDeviceConditionOut(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])


@app.put("/settings/device-conditions/{condition_id}", response_model=BuybackDeviceConditionOut)
@app.put("/skupka/settings/device-conditions/{condition_id}", response_model=BuybackDeviceConditionOut)
def update_buyback_device_condition(
    condition_id: uuid.UUID, body: BuybackDeviceConditionIn, request: Request
) -> BuybackDeviceConditionOut:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE buyback_device_conditions
            SET name=%s, color=%s
            WHERE id=%s
            RETURNING id, name, color, sort_order, created_at
            """,
            (body.name.strip(), body.color.strip(), condition_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="device condition not found")
    return BuybackDeviceConditionOut(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])


@app.delete("/settings/device-conditions/{condition_id}", status_code=204)
@app.delete("/skupka/settings/device-conditions/{condition_id}", status_code=204)
def delete_buyback_device_condition(condition_id: uuid.UUID, request: Request) -> None:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM buyback_device_conditions WHERE id=%s", (condition_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="device condition not found")


@app.post("/settings/device-conditions/reorder", status_code=204)
@app.post("/skupka/settings/device-conditions/reorder", status_code=204)
def reorder_buyback_device_conditions(body: BuybackDeviceConditionReorderIn, request: Request) -> None:
    require_admin(request)
    ids_in_order = list(dict.fromkeys(body.ids))
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM buyback_device_conditions")
        existing_ids = {row[0] for row in cur.fetchall()}
        if existing_ids != set(ids_in_order):
            raise HTTPException(status_code=400, detail="ids must match existing device conditions")
        for index, condition_id in enumerate(ids_in_order, start=1):
            cur.execute("UPDATE buyback_device_conditions SET sort_order=%s WHERE id=%s", (index, condition_id))
