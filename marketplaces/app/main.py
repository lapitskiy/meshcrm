import os
import base64
import json
import urllib.request
import urllib.parse
import datetime
import time
import threading
import uuid
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from collections import defaultdict
from typing import Any
from xml.sax.saxutils import escape

import psycopg
from fastapi import FastAPI
from fastapi import Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


# reserved for future use (db, oauth tokens, etc.)
DATABASE_URL = env(
    "DATABASE_URL",
    "postgresql://marketplaces:marketplaces_pw@marketplaces-db:5432/marketplaces",
)
MARKETPLACES_SCHEDULER_TOKEN = os.getenv("MARKETPLACES_SCHEDULER_TOKEN", "")
TEMP_DIR = Path(__file__).resolve().parent / "temp"
MANIFEST = {
    "name": "marketplaces",
    "bounded_context": "marketplaces",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Маркетплейсы",
            "items": [
                {"id": "ozon", "title": "Ozon"},
                {"id": "wb", "title": "WB"},
                {"id": "yandex", "title": "Yandex"},
            ],
        }
    },
    "api": {"base_url": "http://marketplaces:8000"},
}

app = FastAPI(title="marketplaces", version="0.1.0")
_OZON_MEMORY_CACHE: dict[str, tuple[datetime.datetime, Any]] = {}
_OZON_REQUEST_LOCK = threading.Lock()
_OZON_LAST_REQUEST_AT = 0.0


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS marketplace_api_settings (
              user_uuid UUID PRIMARY KEY,
              moy_sklad_api TEXT NOT NULL DEFAULT '',
              yandex_market_api TEXT NOT NULL DEFAULT '',
              wildberries_api TEXT NOT NULL DEFAULT '',
              ozon_client_id TEXT NOT NULL DEFAULT '',
              ozon_api TEXT NOT NULL DEFAULT '',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS marketplace_provider_settings (
              user_uuid UUID NOT NULL,
              provider TEXT NOT NULL,
              enabled BOOLEAN NOT NULL DEFAULT FALSE,
              api_key TEXT NOT NULL DEFAULT '',
              client_id TEXT NOT NULL DEFAULT '',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, provider)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS moysklad_contragents_settings (
              user_uuid UUID PRIMARY KEY,
              organization_id TEXT NOT NULL DEFAULT '',
              organization_name TEXT NOT NULL DEFAULT '',
              ozon_id TEXT NOT NULL DEFAULT '',
              ozon_name TEXT NOT NULL DEFAULT '',
              wb_id TEXT NOT NULL DEFAULT '',
              wb_name TEXT NOT NULL DEFAULT '',
              yandex_id TEXT NOT NULL DEFAULT '',
              yandex_name TEXT NOT NULL DEFAULT '',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS moysklad_storage_settings (
              user_uuid UUID PRIMARY KEY,
              ozon_store_id TEXT NOT NULL DEFAULT '',
              ozon_store_name TEXT NOT NULL DEFAULT '',
              wb_store_id TEXT NOT NULL DEFAULT '',
              wb_store_name TEXT NOT NULL DEFAULT '',
              yandex_store_id TEXT NOT NULL DEFAULT '',
              yandex_store_name TEXT NOT NULL DEFAULT '',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS moysklad_status_settings (
              user_uuid UUID PRIMARY KEY,
              awaiting_id TEXT NOT NULL DEFAULT '',
              awaiting_name TEXT NOT NULL DEFAULT '',
              shipped_id TEXT NOT NULL DEFAULT '',
              shipped_name TEXT NOT NULL DEFAULT '',
              completed_id TEXT NOT NULL DEFAULT '',
              completed_name TEXT NOT NULL DEFAULT '',
              cancelled_id TEXT NOT NULL DEFAULT '',
              cancelled_name TEXT NOT NULL DEFAULT '',
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ozon_promo_product_settings (
              user_uuid UUID NOT NULL,
              offer_id TEXT NOT NULL,
              yourprice INT NOT NULL DEFAULT 0,
              minprice INT NOT NULL DEFAULT 0,
              min_price_fbs INT NOT NULL DEFAULT 0,
              min_price_limit_count INT NOT NULL DEFAULT 0,
              min_price_promo INT NOT NULL DEFAULT 0,
              min_price_discount INT NOT NULL DEFAULT 0,
              limit_count_value INT NOT NULL DEFAULT 1,
              use_fbs BOOLEAN NOT NULL DEFAULT FALSE,
              use_limit_count BOOLEAN NOT NULL DEFAULT FALSE,
              use_promo BOOLEAN NOT NULL DEFAULT FALSE,
              autoupdate_promo BOOLEAN NOT NULL DEFAULT FALSE,
              auto_update_days_limit_promo BOOLEAN NOT NULL DEFAULT FALSE,
              use_discount BOOLEAN NOT NULL DEFAULT FALSE,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, offer_id)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wb_promo_product_settings (
              user_uuid UUID NOT NULL,
              nm_id BIGINT NOT NULL,
              offer_id TEXT NOT NULL DEFAULT '',
              min_price_auto INT NOT NULL DEFAULT 0,
              auto_update_price BOOLEAN NOT NULL DEFAULT FALSE,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, nm_id)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ozon_finance_operations_cache (
              user_uuid UUID NOT NULL,
              months_ago INT NOT NULL,
              posting_number TEXT NOT NULL,
              offer_id TEXT NOT NULL DEFAULT '',
              delivery_schema TEXT NOT NULL DEFAULT '',
              sku BIGINT,
              sale_price INT NOT NULL DEFAULT 0,
              opt INT NOT NULL DEFAULT 0,
              fees INT NOT NULL DEFAULT 0,
              payoff INT NOT NULL DEFAULT 0,
              net_profit INT NOT NULL DEFAULT 0,
              net_profit_perc INT NOT NULL DEFAULT 0,
              posttax_profit INT NOT NULL DEFAULT 0,
              posttax_profit_perc INT NOT NULL DEFAULT 0,
              quantity INT NOT NULL DEFAULT 1,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, months_ago, posting_number)
            );
            """
        )
        cur.execute(
            """
            ALTER TABLE ozon_finance_operations_cache
            ADD COLUMN IF NOT EXISTS delivery_schema TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ozon_finance_cache_user_month
            ON ozon_finance_operations_cache (user_uuid, months_ago);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wb_finance_operations_cache (
              user_uuid UUID NOT NULL,
              months_ago INT NOT NULL,
              rrd_id BIGINT NOT NULL,
              offer_id TEXT NOT NULL DEFAULT '',
              operation_name TEXT NOT NULL DEFAULT '',
              delivery_schema TEXT NOT NULL DEFAULT '',
              product_id BIGINT,
              sale_price INT NOT NULL DEFAULT 0,
              opt INT NOT NULL DEFAULT 0,
              fees INT NOT NULL DEFAULT 0,
              payoff INT NOT NULL DEFAULT 0,
              net_profit INT NOT NULL DEFAULT 0,
              net_profit_perc INT NOT NULL DEFAULT 0,
              posttax_profit INT NOT NULL DEFAULT 0,
              posttax_profit_perc INT NOT NULL DEFAULT 0,
              quantity INT NOT NULL DEFAULT 1,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, months_ago, rrd_id)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_wb_finance_cache_user_month
            ON wb_finance_operations_cache (user_uuid, months_ago);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wb_fbo_stocks_cache (
              user_uuid UUID PRIMARY KEY,
              payload JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wb_fby_supply_drafts (
              user_uuid UUID NOT NULL,
              supply_id TEXT NOT NULL,
              payload JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, supply_id)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wb_fby_supply_excel_tokens (
              token TEXT PRIMARY KEY,
              user_uuid UUID NOT NULL,
              supply_id TEXT NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ozon_fby_supply_drafts (
              user_uuid UUID NOT NULL,
              supply_id TEXT NOT NULL,
              payload JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_uuid, supply_id)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ozon_fby_stocks_cache (
              user_uuid UUID PRIMARY KEY,
              payload JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )


@app.on_event("startup")
def _startup() -> None:
    init_db()


class ApiSettingsIn(BaseModel):
    moy_sklad_api: str = ""
    yandex_market_api: str = ""
    wildberries_api: str = ""
    ozon_client_id: str = ""
    ozon_api: str = ""


class ProviderSettingsIn(BaseModel):
    enabled: bool = False
    api_key: str = ""
    client_id: str = ""


class WbFbyDraftIn(BaseModel):
    items: list[dict[str, Any]]


class OzonFbyDraftIn(BaseModel):
    items: list[dict[str, Any]]


class MsOption(BaseModel):
    id: str
    name: str


class MoyskladContragentsIn(BaseModel):
    organization_id: str = ""
    organization_name: str = ""
    ozon_id: str = ""
    ozon_name: str = ""
    wb_id: str = ""
    wb_name: str = ""
    yandex_id: str = ""
    yandex_name: str = ""

class MoyskladStorageIn(BaseModel):
    ozon_store_id: str = ""
    ozon_store_name: str = ""
    wb_store_id: str = ""
    wb_store_name: str = ""
    yandex_store_id: str = ""
    yandex_store_name: str = ""

class MoyskladStatusIn(BaseModel):
    awaiting_id: str = ""
    awaiting_name: str = ""
    shipped_id: str = ""
    shipped_name: str = ""
    completed_id: str = ""
    completed_name: str = ""
    cancelled_id: str = ""
    cancelled_name: str = ""

class OzonPromoProductSettingsIn(BaseModel):
    offer_id: str
    yourprice: int = 0
    minprice: int = 0
    min_price_fbs: int = 0
    min_price_limit_count: int = 0
    min_price_promo: int = 0
    min_price_discount: int = 0
    limit_count_value: int = 1
    use_fbs: bool = False
    use_limit_count: bool = False
    use_promo: bool = False
    autoupdate_promo: bool = False
    auto_update_days_limit_promo: bool = False
    use_discount: bool = False


class WbPromoProductSettingsIn(BaseModel):
    nm_id: int
    offer_id: str = ""
    price: int = 0
    discount: int = 0
    min_price_auto: int = 0
    auto_update_price: bool = False


def _user_uuid(x_user_uuid: str | None) -> uuid.UUID:
    if not x_user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    try:
        return uuid.UUID(x_user_uuid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid x-user-uuid") from e


def _get_provider_settings(provider: str, user_uuid_val: uuid.UUID) -> ProviderSettingsIn:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT enabled, api_key, client_id
            FROM marketplace_provider_settings
            WHERE user_uuid=%s AND provider=%s
            """,
            (user_uuid_val, provider),
        )
        row = cur.fetchone()
    if not row:
        return ProviderSettingsIn()
    return ProviderSettingsIn(enabled=row[0], api_key=row[1], client_id=row[2])


def _save_provider_settings(
    provider: str, user_uuid_val: uuid.UUID, body: ProviderSettingsIn
) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO marketplace_provider_settings (user_uuid, provider, enabled, api_key, client_id)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_uuid, provider) DO UPDATE SET
              enabled=EXCLUDED.enabled,
              api_key=EXCLUDED.api_key,
              client_id=EXCLUDED.client_id,
              updated_at=NOW()
            """,
            (user_uuid_val, provider, body.enabled, body.api_key, body.client_id),
        )

def _moysklad_auth_header(raw_api_key: str) -> str:
    api_key = (raw_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="moysklad api_key is empty")
    if ":" in api_key:
        b64 = base64.b64encode(api_key.encode("utf-8")).decode("ascii")
        return f"Basic {b64}"
    return f"Bearer {api_key}"


def _moysklad_get(token: str, url: str) -> dict[str, Any]:
    req = urllib.request.Request(url)
    req.add_header("Authorization", _moysklad_auth_header(token))
    req.add_header("Accept-Encoding", "gzip, deflate")
    req.add_header("Accept", "*/*")
    req.add_header("Connection", "keep-alive")
    try:
        import gzip as _gzip
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = _gzip.decompress(raw)
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = e.read().decode("utf-8")
        except Exception:
            msg = str(e)
        raise HTTPException(status_code=502, detail=f"moysklad upstream error: {msg}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="moysklad upstream error") from e


def _ozon_headers(user_uuid_val: uuid.UUID) -> dict[str, str]:
    s = _get_provider_settings("ozon", user_uuid_val)
    if not s.api_key or not s.client_id:
        raise HTTPException(status_code=400, detail="ozon api_key/client_id not configured")
    return {
        "Client-Id": s.client_id,
        "Api-Key": s.api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _wb_headers(user_uuid_val: uuid.UUID) -> dict[str, str]:
    s = _get_provider_settings("wb", user_uuid_val)
    if not s.api_key:
        raise HTTPException(status_code=400, detail="wb api_key not configured")
    return {
        "Authorization": s.api_key,
        "Accept": "application/json",
    }


def _wb_get_json(url: str, headers: dict[str, str]) -> tuple[int, Any]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if getattr(r, "status", 200) == 204:
                return 204, None
            raw = r.read()
            if not raw:
                return getattr(r, "status", 200), None
            return getattr(r, "status", 200), json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 204:
            return 204, None
        try:
            raw = e.read()
            msg_json = json.loads(raw.decode("utf-8")) if raw else {"detail": str(e)}
        except Exception:
            msg_json = {"detail": str(e)}
        if e.code == 429:
            detail = str(msg_json.get("detail") or "too many requests")
            raise HTTPException(status_code=429, detail=f"WB rate limit: {detail}") from e
        raise HTTPException(
            status_code=502,
            detail=f"wb upstream error: {json.dumps(msg_json, ensure_ascii=False)}",
        ) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="wb upstream error") from e


def _wb_post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> tuple[int, Any]:
    merged_headers = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=merged_headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return getattr(r, "status", 200), json.loads(raw.decode("utf-8")) if raw else None
    except urllib.error.HTTPError as e:
        try:
            raw = e.read()
            msg = json.loads(raw.decode("utf-8")) if raw else {"detail": str(e)}
        except Exception:
            msg = {"detail": str(e)}
        if e.code == 429:
            detail = str(msg.get("detail") or "too many requests")
            raise HTTPException(status_code=429, detail=f"WB rate limit: {detail}") from e
        raise HTTPException(
            status_code=502,
            detail=f"wb upstream error: {json.dumps(msg, ensure_ascii=False)}",
        ) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="wb upstream error") from e


def _ozon_post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    last_rate_limit_msg = "You have reached request rate limit per second"
    endpoint = urllib.parse.urlparse(url).path
    for attempt in range(4):
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            global _OZON_LAST_REQUEST_AT
            with _OZON_REQUEST_LOCK:
                now = time.monotonic()
                wait_seconds = 1.1 - (now - _OZON_LAST_REQUEST_AT)
                if wait_seconds > 0:
                    time.sleep(wait_seconds)
                _OZON_LAST_REQUEST_AT = time.monotonic()
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                data = json.loads(raw.decode("utf-8")) if raw else {}
                if isinstance(data, dict):
                    code = int(data.get("code") or 0)
                    message = str(data.get("message") or "")
                    if code == 8 and "rate limit" in message.lower():
                        last_rate_limit_msg = message or last_rate_limit_msg
                        if attempt < 3:
                            time.sleep(0.35 * (attempt + 1))
                            continue
                        raise HTTPException(status_code=429, detail=f"ozon rate limit {endpoint}: {last_rate_limit_msg}")
                return data if isinstance(data, dict) else {}
        except urllib.error.HTTPError as e:
            raw = b""
            try:
                raw = e.read()
            except Exception:
                pass
            try:
                msg_json = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                msg_json = {}
            msg_text = raw.decode("utf-8", errors="ignore") if raw else str(e)
            code = int(msg_json.get("code") or 0) if isinstance(msg_json, dict) else 0
            message = str(msg_json.get("message") or msg_json.get("detail") or msg_text)
            is_rate_limited = e.code == 429 or code == 8 or ("rate limit" in message.lower())
            if is_rate_limited:
                last_rate_limit_msg = message or last_rate_limit_msg
                if attempt < 3:
                    time.sleep(0.35 * (attempt + 1))
                    continue
                raise HTTPException(status_code=429, detail=f"ozon rate limit {endpoint}: {last_rate_limit_msg}") from e
            raise HTTPException(status_code=502, detail=f"ozon upstream error {endpoint}: {message}") from e
        except HTTPException:
            raise
        except Exception as e:
            if attempt < 3:
                time.sleep(0.2 * (attempt + 1))
                continue
            raise HTTPException(status_code=502, detail=f"ozon upstream error {endpoint}") from e
    raise HTTPException(status_code=429, detail=f"ozon rate limit {endpoint}: {last_rate_limit_msg}")


def _cache_get(key: str, max_age_seconds: int) -> Any | None:
    cached = _OZON_MEMORY_CACHE.get(key)
    if not cached:
        return None
    updated_at, value = cached
    if (datetime.datetime.now(datetime.timezone.utc) - updated_at).total_seconds() > max_age_seconds:
        _OZON_MEMORY_CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> Any:
    _OZON_MEMORY_CACHE[key] = (datetime.datetime.now(datetime.timezone.utc), value)
    return value


def _prepare_ozon_price_value(value: Any) -> str | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        return None
    return f"{numeric:.2f}"


def _update_ozon_prices(
    ozon_hdrs: dict[str, str], offer_id: str, yourprice: int, minprice: int
) -> dict[str, Any] | None:
    price = _prepare_ozon_price_value(yourprice)
    min_price = _prepare_ozon_price_value(minprice)
    if price is None and min_price is None:
        return None
    response = _ozon_post_json(
        "https://api-seller.ozon.ru/v1/product/import/prices",
        ozon_hdrs,
        {
            "prices": [
                {
                    "offer_id": offer_id,
                    **({"price": price} if price is not None else {}),
                    **({"min_price": min_price} if min_price is not None else {}),
                    "currency_code": "RUB",
                }
            ]
        },
    )
    result_items = response.get("result") or []
    if isinstance(result_items, list):
        for item in result_items:
            item_errors = item.get("errors") or []
            if item_errors:
                raise HTTPException(
                    status_code=502,
                    detail=f"ozon price update error: {json.dumps(item_errors, ensure_ascii=False)}",
                )
    return response


def _ozon_get_products(ozon_hdrs: dict[str, str]) -> dict[str, Any]:
    # list offer_ids
    resp = _ozon_post_json(
        "https://api-seller.ozon.ru/v3/product/list",
        ozon_hdrs,
        {"filter": {"visibility": "ALL"}, "last_id": "", "limit": 1000},
    )
    offer_list = [x.get("offer_id") for x in (resp.get("result", {}) or {}).get("items", []) if x.get("offer_id")]
    if not offer_list:
        return {"items": []}
    # resolve sku via sources
    return _ozon_post_json(
        "https://api-seller.ozon.ru/v3/product/info/list",
        ozon_hdrs,
        {"offer_id": offer_list},
    )


def _ozon_supply_orders(ozon_hdrs: dict[str, str]) -> list[dict[str, Any]]:
    order_ids: list[int] = []
    for state in ("DATA_FILLING", "READY_TO_SUPPLY"):
        resp = _ozon_post_json(
            "https://api-seller.ozon.ru/v3/supply-order/list",
            ozon_hdrs,
            {"limit": 100, "filter": {"states": [state]}, "sort_by": 1, "sort_dir": 1},
        )
        order_ids.extend(_wb_int(order_id) for order_id in (resp.get("order_ids") or []))
    items: list[dict[str, Any]] = []
    for order_id in sorted(set(order_ids), reverse=True):
        items.append(
            {
                "id": str(order_id),
                "order_id": order_id,
                "order_number": str(order_id),
                "state": "",
                "created_at": None,
                "supply_date": None,
                "warehouse_id": None,
                "warehouse_name": "",
                "city": "",
            }
        )
    return items


def _ozon_unwrap_result(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    result = payload.get("result")
    if isinstance(result, dict):
        return result
    return payload


def _ozon_supply_timeslot(details: dict[str, Any]) -> dict[str, Any]:
    raw_timeslot = details.get("timeslot")
    if isinstance(raw_timeslot, dict):
        nested = ((raw_timeslot.get("value") or {}).get("timeslot") or {})
        if isinstance(nested, dict) and nested:
            return nested
        return raw_timeslot
    return {}


def _ozon_extract_city(value: str) -> str:
    clean = str(value or "").strip()
    if not clean:
        return ""
    if "_" in clean and clean.split("_", 1)[0]:
        return clean.split("_", 1)[0].title()
    for part in clean.split(","):
        part = part.strip()
        if part.startswith("г. "):
            return part[3:].strip()
        if part.startswith("г "):
            return part[2:].strip()
    return ""


def _ozon_warehouses_by_id(user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str]) -> dict[int, dict[str, str]]:
    cache_key = f"ozon:warehouses:{user_uuid_val}"
    cached = _cache_get(cache_key, 3600)
    if isinstance(cached, dict):
        return cached
    payload = _ozon_post_json("https://api-seller.ozon.ru/v2/warehouse/list", ozon_hdrs, {})
    result = payload.get("result") if isinstance(payload, dict) else None
    rows = result if isinstance(result, list) else []
    out: dict[int, dict[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        warehouse_id = _wb_int(row.get("warehouse_id") or row.get("id"))
        if warehouse_id <= 0:
            continue
        address = row.get("address") if isinstance(row.get("address"), dict) else {}
        out[warehouse_id] = {
            "name": str(row.get("name") or row.get("warehouse_name") or ""),
            "city": str(address.get("city") or row.get("city") or ""),
        }
    return _cache_set(cache_key, out)


def _ozon_supply_order_get(user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str], order_id: int) -> dict[str, Any]:
    cache_key = f"ozon:supply-order:{user_uuid_val}:{order_id}"
    cached = _cache_get(cache_key, 600)
    if isinstance(cached, dict):
        return cached
    payload = _ozon_post_json(
        "https://api-seller.ozon.ru/v3/supply-order/get",
        ozon_hdrs,
        {"order_ids": [order_id]},
    )
    data = _ozon_unwrap_result(payload)
    orders = data.get("orders") if isinstance(data, dict) else None
    if isinstance(orders, list):
        for order in orders:
            if not isinstance(order, dict):
                continue
            candidate_id = _wb_int(order.get("order_id") or order.get("id"))
            if candidate_id == order_id:
                return _cache_set(cache_key, order)
        for order in orders:
            if isinstance(order, dict):
                return _cache_set(cache_key, order)
    if isinstance(data, dict) and data:
        return _cache_set(cache_key, data)
    raise HTTPException(status_code=502, detail="ozon upstream error: invalid supply order response")


def _ozon_extract_supply_location(details: dict[str, Any], warehouses_by_id: dict[int, dict[str, str]] | None = None) -> dict[str, Any]:
    warehouses_by_id = warehouses_by_id or {}
    warehouse = details.get("warehouse") if isinstance(details.get("warehouse"), dict) else {}
    supplies = details.get("supplies") if isinstance(details.get("supplies"), list) else []
    supply = next((row for row in supplies if isinstance(row, dict)), {})
    storage_warehouse = supply.get("storage_warehouse") if isinstance(supply.get("storage_warehouse"), dict) else {}
    drop_off_warehouse = details.get("drop_off_warehouse") if isinstance(details.get("drop_off_warehouse"), dict) else {}
    timeslot = _ozon_supply_timeslot(details)
    timeslot_warehouse = timeslot.get("warehouse") if isinstance(timeslot.get("warehouse"), dict) else {}
    warehouse_address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
    timeslot_address = timeslot_warehouse.get("address") if isinstance(timeslot_warehouse.get("address"), dict) else {}
    warehouse_id = _wb_int(
        storage_warehouse.get("warehouse_id")
        or storage_warehouse.get("id")
        or warehouse.get("id")
        or details.get("warehouse_id")
        or timeslot_warehouse.get("id")
        or drop_off_warehouse.get("warehouse_id")
    ) or None
    mapped = warehouses_by_id.get(int(warehouse_id)) if warehouse_id else {}
    warehouse_name = str(
        storage_warehouse.get("name")
        or warehouse.get("name")
        or details.get("warehouse_name")
        or timeslot_warehouse.get("name")
        or mapped.get("name")
        or drop_off_warehouse.get("name")
        or ""
    )
    address_text = str(storage_warehouse.get("address") or drop_off_warehouse.get("address") or "")
    city = str(
        _ozon_extract_city(warehouse_name)
        or _ozon_extract_city(address_text)
        or warehouse_address.get("city")
        or details.get("warehouse_city")
        or timeslot_address.get("city")
        or mapped.get("city")
        or ""
    )
    return {
        "warehouse_id": warehouse_id,
        "warehouse_name": warehouse_name,
        "city": city,
    }


def _ozon_supply_order_details(user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str], order_id: int) -> dict[str, Any]:
    details = _ozon_supply_order_get(user_uuid_val, ozon_hdrs, order_id)
    if not isinstance(details, dict):
        raise HTTPException(status_code=502, detail="ozon upstream error: invalid supply details response")
    warehouses_by_id = _ozon_warehouses_by_id(user_uuid_val, ozon_hdrs)
    timeslot = _ozon_supply_timeslot(details)
    return {
        "id": str(order_id),
        "order_id": order_id,
        "order_number": str(details.get("order_number") or details.get("name") or order_id),
        "state": str(details.get("state") or details.get("status") or ""),
        "created_at": details.get("created_date") or details.get("created_at"),
        "supply_date": timeslot.get("from"),
        **_ozon_extract_supply_location(details, warehouses_by_id),
    }


def _ozon_supply_order_content_update(
    user_uuid_val: uuid.UUID,
    ozon_hdrs: dict[str, str],
    order_id: int,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    details = _ozon_supply_order_get(user_uuid_val, ozon_hdrs, order_id)
    supplies = details.get("supplies") if isinstance(details.get("supplies"), list) else []
    supply = next((row for row in supplies if isinstance(row, dict)), {})
    supply_id = _wb_int(supply.get("supply_id"))
    if supply_id <= 0:
        raise HTTPException(status_code=400, detail="ozon supply_id not found in supply order")
    update_items = []
    for row in items:
        if not isinstance(row, dict):
            continue
        sku = _wb_int(row.get("sku"))
        quantity = max(0, _wb_int(row.get("quantity")))
        if sku <= 0 or quantity <= 0:
            continue
        update_items.append({"sku": sku, "quantity": quantity, "quant": quantity})
    if not update_items:
        raise HTTPException(status_code=400, detail="Для обновления состава Ozon нужна хотя бы одна позиция с количеством больше 0")
    response = _ozon_post_json(
        "https://api-seller.ozon.ru/v1/supply-order/content/update",
        ozon_hdrs,
        {"order_id": order_id, "supply_id": supply_id, "items": update_items},
    )
    _OZON_MEMORY_CACHE.pop(f"ozon:supply-order:{user_uuid_val}:{order_id}", None)
    _OZON_MEMORY_CACHE.pop(f"ozon:supply-goods:{user_uuid_val}:{order_id}", None)
    return {"status": "sent", "supply_id": supply_id, "items_total": len(update_items), "ozon": response}


def _ozon_supply_goods(user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str], order_id: str) -> list[dict[str, Any]]:
    cache_key = f"ozon:supply-goods:{user_uuid_val}:{order_id}"
    cached = _cache_get(cache_key, 300)
    if isinstance(cached, list):
        return cached
    details = _ozon_supply_order_get(user_uuid_val, ozon_hdrs, _wb_int(order_id))
    bundle_ids: list[str] = []
    for supply in details.get("supplies") or []:
        if isinstance(supply, dict):
            bundle_id = supply.get("bundle_id") or ((supply.get("content") or {}).get("bundle_id") or "")
            if bundle_id:
                bundle_ids.append(str(bundle_id))
    if not bundle_ids:
        return []
    resp = _ozon_post_json(
        "https://api-seller.ozon.ru/v1/supply-order/bundle",
        ozon_hdrs,
        {"bundle_ids": bundle_ids, "limit": 100, "last_id": ""},
    )
    by_sku: dict[int, dict[str, Any]] = {}
    for row in resp.get("items") or []:
        if not isinstance(row, dict):
            continue
        sku = _wb_int(row.get("sku"))
        barcode = str(row.get("barcode") or "")
        ozon_qty = _wb_int(row.get("quantity"))
        item = by_sku.setdefault(
            sku,
            {
                "sku": sku,
                "offer_id": str(row.get("offer_id") or sku),
                "name": str(row.get("name") or ""),
                "quantity": ozon_qty,
                "ozon_quantity": ozon_qty,
                "stock_quantity": 0,
                "barcodes": [],
            },
        )
        item["quantity"] = max(_wb_int(item.get("quantity")), ozon_qty)
        item["ozon_quantity"] = max(_wb_int(item.get("ozon_quantity")), ozon_qty)
        if barcode and barcode not in item["barcodes"]:
            item["barcodes"].append(barcode)
    offer_ids = [str(item.get("offer_id") or "") for item in by_sku.values() if item.get("offer_id")]
    if offer_ids:
        product_resp = _ozon_post_json(
            "https://api-seller.ozon.ru/v3/product/info/list",
            ozon_hdrs,
            {"offer_id": offer_ids},
        )
        for product in product_resp.get("items") or []:
            if not isinstance(product, dict):
                continue
            item = by_sku.get(_wb_int(product.get("sku")))
            if not item:
                continue
            for barcode in product.get("barcodes") or []:
                barcode = str(barcode or "")
                if barcode and barcode not in item["barcodes"]:
                    item["barcodes"].append(barcode)
    items = list(by_sku.values())
    items.sort(key=lambda item: str(item.get("offer_id") or ""))
    return _cache_set(cache_key, items)


def _ozon_list_sellable_goods(user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str]) -> list[dict[str, Any]]:
    cache_key = f"ozon:sellable-goods:{user_uuid_val}"
    cached = _cache_get(cache_key, 300)
    if isinstance(cached, list):
        return cached
    offer_ids: list[str] = []
    last_id = ""
    while True:
        resp = _ozon_post_json(
            "https://api-seller.ozon.ru/v3/product/list",
            ozon_hdrs,
            {"filter": {"visibility": "VISIBLE"}, "last_id": last_id, "limit": 1000},
        )
        result = _ozon_unwrap_result(resp)
        items = result.get("items") if isinstance(result.get("items"), list) else []
        offer_ids.extend(str(row.get("offer_id")) for row in items if isinstance(row, dict) and row.get("offer_id"))
        next_last_id = str(result.get("last_id") or "")
        if not items or not next_last_id or next_last_id == last_id:
            break
        last_id = next_last_id
    goods: list[dict[str, Any]] = []
    for idx in range(0, len(offer_ids), 1000):
        product_resp = _ozon_post_json(
            "https://api-seller.ozon.ru/v3/product/info/list",
            ozon_hdrs,
            {"offer_id": offer_ids[idx : idx + 1000]},
        )
        products = product_resp.get("items") if isinstance(product_resp.get("items"), list) else []
        for product in products:
            if not isinstance(product, dict):
                continue
            sku = _wb_int(product.get("sku"))
            if sku <= 0:
                sku = next((_wb_int(src.get("sku")) for src in product.get("sources") or [] if isinstance(src, dict) and _wb_int(src.get("sku")) > 0), 0)
            if sku <= 0:
                continue
            goods.append(
                {
                    "sku": sku,
                    "offer_id": str(product.get("offer_id") or sku),
                    "name": str(product.get("name") or ""),
                    "quantity": 0,
                    "ozon_quantity": 0,
                    "stock_quantity": 0,
                    "barcodes": [str(barcode) for barcode in product.get("barcodes") or [] if barcode],
                }
            )
    goods.sort(key=lambda item: str(item.get("offer_id") or ""))
    return _cache_set(cache_key, goods)


def _normalize_ozon_fby_draft_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        sku = _wb_int(row.get("sku"))
        if sku <= 0:
            continue
        legacy_quantities: list[int] = []
        barcodes: list[str] = []
        for barcode_row in row.get("barcodes") or []:
            if isinstance(barcode_row, str):
                barcode = barcode_row
            elif isinstance(barcode_row, dict):
                barcode = str(barcode_row.get("barcode") or "")
                legacy_quantities.append(_wb_int(barcode_row.get("quantity")))
            else:
                continue
            if barcode and barcode not in barcodes:
                barcodes.append(barcode)
        quantity = _wb_int(row.get("quantity"))
        if quantity <= 0 and legacy_quantities:
            quantity = max(legacy_quantities)
        normalized.append(
            {
                "sku": sku,
                "offer_id": str(row.get("offer_id") or sku),
                "name": str(row.get("name") or ""),
                "quantity": max(0, quantity),
                "barcodes": barcodes,
            }
        )
    normalized.sort(key=lambda item: str(item.get("offer_id") or ""))
    return normalized


def _load_ozon_fby_supply_draft(user_uuid_val: uuid.UUID, supply_id: str) -> tuple[dict[str, Any], datetime.datetime] | None:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT payload, updated_at FROM ozon_fby_supply_drafts WHERE user_uuid=%s AND supply_id=%s", (user_uuid_val, supply_id))
        row = cur.fetchone()
    if not row:
        return None
    payload = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return payload, row[1]


def _save_ozon_fby_supply_draft(user_uuid_val: uuid.UUID, supply_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    payload = {"items": _normalize_ozon_fby_draft_items(items)}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ozon_fby_supply_drafts (user_uuid, supply_id, payload, updated_at)
            VALUES (%s, %s, %s::jsonb, NOW())
            ON CONFLICT (user_uuid, supply_id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()
            """,
            (user_uuid_val, supply_id, json.dumps(payload, ensure_ascii=False)),
        )
    return payload


def _ozon_stocks_cached(user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str], skus: list[int]) -> tuple[list[dict[str, Any]], datetime.datetime, str]:
    now = datetime.datetime.now(datetime.timezone.utc)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT payload, updated_at FROM ozon_fby_stocks_cache WHERE user_uuid=%s", (user_uuid_val,))
        row = cur.fetchone()
    if row:
        payload = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        updated_at = row[1] if row[1].tzinfo else row[1].replace(tzinfo=datetime.timezone.utc)
        cached_skus = set(_wb_int(sku) for sku in payload.get("skus", []))
        if set(skus).issubset(cached_skus) and (now - updated_at).total_seconds() < 1800:
            return payload.get("items") or [], row[1], "cache"
    resp = _ozon_post_json(
        "https://api-seller.ozon.ru/v1/analytics/stocks",
        ozon_hdrs,
        {"skus": [str(sku) for sku in skus[:100]], "limit": 1000, "offset": 0, "warehouse_type": "ALL"},
    )
    payload = {"skus": skus[:100], "items": resp.get("items") if isinstance(resp.get("items"), list) else []}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ozon_fby_stocks_cache (user_uuid, payload, updated_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (user_uuid) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()
            """,
            (user_uuid_val, json.dumps(payload, ensure_ascii=False)),
        )
    return payload["items"], now, "live"


def _chunked(items: list[int], size: int = 1000) -> list[list[int]]:
    out: list[list[int]] = []
    current: list[int] = []
    for item in items:
        current.append(item)
        if len(current) >= size:
            out.append(current)
            current = []
    if current:
        out.append(current)
    return out


def _ozon_offer_to_product_id_map(ozon_hdrs: dict[str, str]) -> dict[str, int]:
    out: dict[str, int] = {}
    last_id = ""
    while True:
        resp = _ozon_post_json(
            "https://api-seller.ozon.ru/v5/product/info/prices",
            ozon_hdrs,
            {"filter": {"visibility": "ALL"}, "last_id": last_id, "limit": 1000},
        )
        items = resp.get("items") or []
        for item in items:
            offer_id = str(item.get("offer_id") or "")
            if not offer_id:
                continue
            try:
                out[offer_id] = int(float(item.get("product_id") or 0))
            except Exception:
                continue
        next_last_id = str(resp.get("last_id") or "")
        if not items or not next_last_id or next_last_id == last_id:
            break
        last_id = next_last_id
    return out


def _update_ozon_promotion_timer(ozon_hdrs: dict[str, str], product_ids: list[int]) -> dict[str, Any]:
    if not product_ids:
        return {"requested": 0, "updated": 0, "skipped": 0, "updated_ids": [], "skipped_ids": []}
    statuses: list[dict[str, Any]] = []
    for chunk in _chunked(product_ids, 1000):
        s = _ozon_post_json(
            "https://api-seller.ozon.ru/v1/product/action/timer/status",
            ozon_hdrs,
            {"product_ids": chunk},
        )
        statuses.extend(s.get("statuses") or [])
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    threshold_dt = now_utc + datetime.timedelta(days=10)
    products_with_status: set[int] = set()
    need_update: set[int] = set()
    skipped: set[int] = set()
    for st in statuses:
        raw_pid = st.get("product_id")
        try:
            pid = int(raw_pid)
        except Exception:
            continue
        products_with_status.add(pid)
        expired_at_raw = st.get("expired_at")
        if not expired_at_raw:
            need_update.add(pid)
            continue
        try:
            expired_at_dt = datetime.datetime.fromisoformat(str(expired_at_raw).replace("Z", "+00:00"))
        except Exception:
            need_update.add(pid)
            continue
        if expired_at_dt <= threshold_dt:
            need_update.add(pid)
        else:
            skipped.add(pid)
    missing = {int(pid) for pid in product_ids if int(pid) not in products_with_status}
    need_update.update(missing)
    updated_ids: list[int] = []
    for chunk in _chunked(sorted(need_update), 1000):
        _ozon_post_json(
            "https://api-seller.ozon.ru/v1/product/action/timer/update",
            ozon_hdrs,
            {"product_ids": chunk},
        )
        updated_ids.extend(chunk)
    return {
        "requested": len(product_ids),
        "updated": len(updated_ids),
        "skipped": len(skipped),
        "updated_ids": sorted(updated_ids),
        "skipped_ids": sorted(skipped),
    }


def _ozon_list_discount_tasks(
    ozon_hdrs: dict[str, str], statuses: list[str] | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for status in statuses or ["NEW"]:
        page = 1
        while True:
            resp = _ozon_post_json(
                "https://api-seller.ozon.ru/v1/actions/discounts-task/list",
                ozon_hdrs,
                {"status": status, "page": page, "limit": limit},
            )
            items = resp.get("result") or []
            if not isinstance(items, list):
                raise HTTPException(status_code=502, detail="ozon upstream error: invalid discounts-task/list response")
            out.extend(items)
            if len(items) < limit:
                break
            page += 1
    return out


def _ozon_decline_discount_tasks(ozon_hdrs: dict[str, str], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    if not tasks:
        return {"success": True, "result": {"success_count": 0, "fail_count": 0, "fail_details": []}}
    return {
        "success": True,
        "result": _ozon_post_json(
            "https://api-seller.ozon.ru/v1/actions/discounts-task/decline",
            ozon_hdrs,
            {"tasks": tasks},
        ),
    }


def _ozon_approve_discount_tasks(ozon_hdrs: dict[str, str], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    if not tasks:
        return {"success": True, "result": {"success_count": 0, "fail_count": 0, "fail_details": []}}
    return {
        "success": True,
        "result": _ozon_post_json(
            "https://api-seller.ozon.ru/v1/actions/discounts-task/approve",
            ozon_hdrs,
            {"tasks": tasks},
        ),
    }


def _run_user_timer_autoupdate(user_uuid_val: uuid.UUID) -> dict[str, Any]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id
            FROM ozon_promo_product_settings
            WHERE user_uuid=%s AND auto_update_days_limit_promo = TRUE
            """,
            (user_uuid_val,),
        )
        offer_rows = cur.fetchall()
    offer_ids = [str(r[0] or "") for r in offer_rows if r and r[0]]
    if not offer_ids:
        return {
            "user_uuid": str(user_uuid_val),
            "offer_ids_total": 0,
            "offer_ids_without_product_id": [],
            "timer": {"requested": 0, "updated": 0, "skipped": 0, "updated_ids": [], "skipped_ids": []},
        }
    ozon_hdrs = _ozon_headers(user_uuid_val)
    offer_to_product = _ozon_offer_to_product_id_map(ozon_hdrs)
    product_ids = []
    missed_offer_ids = []
    for offer_id in offer_ids:
        pid = offer_to_product.get(offer_id)
        if pid:
            product_ids.append(int(pid))
        else:
            missed_offer_ids.append(offer_id)
    timer_result = _update_ozon_promotion_timer(ozon_hdrs, product_ids)
    return {
        "user_uuid": str(user_uuid_val),
        "offer_ids_total": len(offer_ids),
        "offer_ids_without_product_id": missed_offer_ids,
        "timer": timer_result,
    }


def _run_user_discount_autoprocess(user_uuid_val: uuid.UUID) -> dict[str, Any]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id, min_price_discount
            FROM ozon_promo_product_settings
            WHERE user_uuid=%s AND use_discount = TRUE
            """,
            (user_uuid_val,),
        )
        rows = cur.fetchall()
    settings_map: dict[str, int] = {}
    for row in rows or []:
        offer_id = str(row[0] or "").strip()
        if not offer_id:
            continue
        settings_map[offer_id] = int(row[1] or 0)
    if not settings_map:
        return {
            "user_uuid": str(user_uuid_val),
            "products_total": 0,
            "processed": 0,
            "approved": 0,
            "declined": 0,
            "skipped": 0,
            "approve_result": {"success": True, "result": {"success_count": 0, "fail_count": 0, "fail_details": []}},
            "decline_result": {"success": True, "result": {"success_count": 0, "fail_count": 0, "fail_details": []}},
        }
    ozon_hdrs = _ozon_headers(user_uuid_val)
    tasks = _ozon_list_discount_tasks(ozon_hdrs, ["NEW", "SEEN"], 50)
    approve_payload: list[dict[str, Any]] = []
    decline_payload: list[dict[str, Any]] = []
    skipped = 0
    for task in tasks:
        offer_id = str(task.get("offer_id") or "").strip()
        task_id = task.get("id")
        if not offer_id or task_id is None:
            skipped += 1
            continue
        min_price_discount = settings_map.get(offer_id)
        if min_price_discount is None or min_price_discount <= 0:
            skipped += 1
            continue
        try:
            requested_price = float(task.get("requested_price"))
        except Exception:
            skipped += 1
            continue
        try:
            requested_quantity_min = int(task.get("requested_quantity_min") or 1)
        except Exception:
            requested_quantity_min = 1
        try:
            requested_quantity_max = int(task.get("requested_quantity_max") or requested_quantity_min)
        except Exception:
            requested_quantity_max = requested_quantity_min
        if requested_price < float(min_price_discount):
            decline_payload.append({"id": task_id})
            continue
        approve_payload.append(
            {
                "id": task_id,
                "approved_price": requested_price,
                "approved_quantity_min": requested_quantity_min,
                "approved_quantity_max": requested_quantity_max,
            }
        )
    decline_result = _ozon_decline_discount_tasks(ozon_hdrs, decline_payload)
    approve_result = _ozon_approve_discount_tasks(ozon_hdrs, approve_payload)
    return {
        "user_uuid": str(user_uuid_val),
        "products_total": len(settings_map),
        "processed": len(tasks),
        "approved": len(approve_payload),
        "declined": len(decline_payload),
        "skipped": skipped,
        "approve_result": approve_result,
        "decline_result": decline_result,
    }


def _moysklad_opt_prices(user_uuid_val: uuid.UUID) -> dict[str, int]:
    token = _get_moysklad_token(user_uuid_val)
    data = _moysklad_get(token, "https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1000")
    out: dict[str, int] = {}
    for row in data.get("rows") or []:
        article = row.get("article")
        if not article:
            continue
        buy = (row.get("buyPrice") or {}).get("value")
        try:
            out[str(article)] = int(float(buy) / 100) if buy is not None else 0
        except Exception:
            out[str(article)] = 0
    return out


def _month_range_utc_months_ago(
    now: datetime.datetime, months_ago: int
) -> tuple[str, str, datetime.date, datetime.date]:
    if months_ago < 0:
        raise HTTPException(status_code=400, detail="months_ago must be >= 0")
    if months_ago > 24:
        raise HTTPException(status_code=400, detail="months_ago too large (max 24)")

    if months_ago == 0:
        today = now.date()
        target_first = datetime.date(today.year, today.month, 1)
        from_iso = f"{target_first.isoformat()}T00:00:00.000Z"
        to_iso = f"{today.isoformat()}T23:59:59.999Z"
        return from_iso, to_iso, target_first, today

    first_day_this_month = datetime.date(now.year, now.month, 1)
    base_total = first_day_this_month.year * 12 + (first_day_this_month.month - 1)
    target_total = base_total - months_ago
    ty = target_total // 12
    tm = (target_total % 12) + 1
    target_first = datetime.date(ty, tm, 1)

    next_total = target_total + 1
    ny = next_total // 12
    nm = (next_total % 12) + 1
    next_first = datetime.date(ny, nm, 1)
    target_last = next_first - datetime.timedelta(days=1)

    from_iso = f"{target_first.isoformat()}T00:00:00.000Z"
    to_iso = f"{target_last.isoformat()}T23:59:59.999Z"
    return from_iso, to_iso, target_first, target_last


def _ru_month_name_nominative(month: int) -> str:
    names = [
        "Январь",
        "Февраль",
        "Март",
        "Апрель",
        "Май",
        "Июнь",
        "Июль",
        "Август",
        "Сентябрь",
        "Октябрь",
        "Ноябрь",
        "Декабрь",
    ]
    return names[month - 1] if 1 <= month <= 12 else str(month)


def _compose_ozon_finance_response(
    report: dict[str, list[dict[str, Any]]],
    start_date: datetime.date,
    stop_date: datetime.date,
    source: str,
    refreshed_at: str | None = None,
) -> dict[str, Any]:
    summed_totals: dict[str, Any] = {}
    for offer_id, entries in report.items():
        total_quantity = sum(int(e.get("quantity") or 0) for e in entries) or 0
        payoff_sum = sum(int(e.get("payoff") or 0) for e in entries)
        net_profit_sum = sum(int(e.get("net_profit") or 0) for e in entries)
        posttax_profit_sum = sum(int(e.get("posttax_profit") or 0) for e in entries)
        avg_sales_price = int(payoff_sum / total_quantity) if total_quantity else 0
        avg_percent_posttax = int(
            (sum(int(e.get("posttax_profit_perc") or 0) for e in entries) / len(entries)) if entries else 0
        )
        summed_totals[offer_id] = {
            "payoff": int(payoff_sum),
            "net_profit_sum": int(net_profit_sum),
            "posttax_profit_sum": int(posttax_profit_sum),
            "average_sales_price": int(avg_sales_price),
            "average_percent_posttax": int(avg_percent_posttax),
            "total_quantity": int(total_quantity),
        }

    all_return_total = sum(
        abs(int(e.get("payoff") or 0))
        for entries in report.values()
        for e in entries
        if int(e.get("payoff") or 0) < 0
    )
    total_payoff = sum(int(e.get("payoff") or 0) for entries in report.values() for e in entries)
    all_totals_raw: dict[str, Any] = {
        "all_total_price_sum": int(total_payoff),
        "all_net_profit_sum": sum(v["net_profit_sum"] for v in summed_totals.values()),
        "all_posttax_profit_sum": sum(v["posttax_profit_sum"] for v in summed_totals.values()),
        "all_quantity": sum(v["total_quantity"] for v in summed_totals.values()),
        "all_return_total": int(all_return_total),
    }
    all_totals = {k: (f"{v:,}" if isinstance(v, (int, float)) else v) for k, v in all_totals_raw.items()}
    header_data = {
        "start_date": start_date.isoformat(),
        "stop_date": stop_date.isoformat(),
        "month": _ru_month_name_nominative(start_date.month),
        "day_delta": int((stop_date - start_date).days),
        "source": source,
        "refreshed_at": refreshed_at or "",
    }
    sorted_report = dict(sorted(report.items(), key=lambda kv: kv[0]))
    return {
        "report": sorted_report,
        "summed_totals": summed_totals,
        "all_totals": all_totals,
        "header_data": header_data,
    }


def _build_ozon_finance_report_from_api(
    user_uuid_val: uuid.UUID, ozon_hdrs: dict[str, str], start_date: datetime.date, stop_date: datetime.date
) -> dict[str, list[dict[str, Any]]]:
    prod = _ozon_get_products(ozon_hdrs)
    sku_offer_id: dict[str, str] = {}
    for item in prod.get("items") or []:
        offer_id = item.get("offer_id")
        if not offer_id:
            continue
        for src in item.get("sources") or []:
            sku = src.get("sku")
            if sku is None:
                continue
            sku_offer_id[str(sku)] = str(offer_id)

    ms_opt = _moysklad_opt_prices(user_uuid_val)
    from_iso = f"{start_date.isoformat()}T00:00:00.000Z"
    to_iso = f"{stop_date.isoformat()}T23:59:59.999Z"
    url = "https://api-seller.ozon.ru/v3/finance/transaction/list"
    page = 1
    page_size = 1000
    all_operations: list[dict[str, Any]] = []
    while True:
        payload = {
            "filter": {
                "date": {"from": from_iso, "to": to_iso},
                "operation_type": [],
                "posting_number": "",
                "transaction_type": "all",
            },
            "page": page,
            "page_size": page_size,
        }
        resp = _ozon_post_json(url, ozon_hdrs, payload)
        result = resp.get("result") or {}
        operations = result.get("operations") or []
        if not operations:
            break
        all_operations.extend(operations)
        page_count = int(result.get("page_count") or 0)
        if page >= page_count:
            break
        page += 1

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in all_operations:
        pn = (entry.get("posting") or {}).get("posting_number") or "unknown"
        grouped[str(pn)].append(entry)

    report: dict[str, list[dict[str, Any]]] = {}
    for posting_number, items in grouped.items():
        sale_price = 0.0
        payoff = 0.0
        sku_val: str | None = None
        offer_id: str | None = None
        delivery_schema = ""
        opt = 0
        for item in items:
            if not delivery_schema:
                posting = item.get("posting") or {}
                ds = str(posting.get("delivery_schema") or "").strip().upper()
                if ds in ("FBS", "FBO", "RFBS", "REAL_FBS", "FBO_LITE"):
                    delivery_schema = ds
            item_s = item.get("items") or []
            if item_s and not sku_val:
                sku_raw = item_s[0].get("sku")
                if sku_raw is not None:
                    sku_val = str(sku_raw)
                    offer_id = sku_offer_id.get(sku_val)
                    if offer_id:
                        opt = int(ms_opt.get(offer_id) or 0)
            accruals = float(item.get("accruals_for_sale") or 0)
            if accruals != 0:
                sale_price += accruals
            payoff += float(item.get("amount") or 0)
        service_fees = sale_price - payoff
        if not offer_id or opt == 0 or sale_price == 0:
            continue
        net_profit = int(payoff) - int(opt)
        posttax_profit = int(net_profit - (int(payoff) * 0.06))
        net_profit_perc = int((net_profit / int(opt)) * 100) if int(opt) else 0
        posttax_profit_perc = int((posttax_profit / int(opt)) * 100) if int(opt) else 0
        report.setdefault(offer_id, []).append(
            {
                "quantity": 1,
                "name": posting_number,
                "delivery_schema": delivery_schema,
                "product_id": int(sku_val) if sku_val and sku_val.isdigit() else 0,
                "sale_price": int(sale_price),
                "opt": int(opt),
                "fees": int(service_fees),
                "payoff": int(payoff),
                "net_profit": int(net_profit),
                "net_profit_perc": int(net_profit_perc),
                "posttax_profit": int(posttax_profit),
                "posttax_profit_perc": int(posttax_profit_perc),
            }
        )
    return report


def _wb_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value or 0))
    except Exception:
        return default


def _wb_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or 0)
    except Exception:
        return default


def _build_wb_finance_report_from_api(
    user_uuid_val: uuid.UUID, wb_hdrs: dict[str, str], start_date: datetime.date, stop_date: datetime.date
) -> dict[str, list[dict[str, Any]]]:
    ms_opt = _moysklad_opt_prices(user_uuid_val)
    rows: list[dict[str, Any]] = []
    rrdid = 0
    while True:
        query = urllib.parse.urlencode(
            {
                "dateFrom": start_date.isoformat(),
                "dateTo": stop_date.isoformat(),
                "limit": 100000,
                "rrdid": rrdid,
                "period": "daily",
            }
        )
        status, payload = _wb_get_json(
            f"https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?{query}",
            wb_hdrs,
        )
        if status == 204 or not payload:
            break
        if not isinstance(payload, list):
            raise HTTPException(status_code=502, detail="wb upstream error: invalid reportDetailByPeriod response")
        rows.extend(payload)
        next_rrdid = _wb_int((payload[-1] or {}).get("rrd_id"))
        if next_rrdid <= rrdid:
            break
        rrdid = next_rrdid

    report: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        offer_id = str(
            row.get("sa_name")
            or row.get("supplier_article")
            or row.get("vendorCode")
            or row.get("nm_id")
            or row.get("nmId")
            or ""
        ).strip()
        if not offer_id:
            continue
        quantity = abs(_wb_int(row.get("quantity"), 1)) or 1
        sale_price = _wb_int(round(_wb_float(row.get("retail_price_withdisc_rub")) * quantity))
        if sale_price <= 0:
            sale_price = _wb_int(round(_wb_float(row.get("retail_amount"))))
        payoff = _wb_int(round(_wb_float(row.get("ppvz_for_pay"))))
        if sale_price == 0 and payoff == 0:
            continue
        opt_unit = int(ms_opt.get(offer_id) or 0)
        opt = int(opt_unit * quantity)
        fees = int(sale_price - payoff)
        net_profit = int(payoff - opt)
        posttax_profit = int(net_profit - (payoff * 0.06))
        net_profit_perc = int((net_profit / opt) * 100) if opt else 0
        posttax_profit_perc = int((posttax_profit / opt) * 100) if opt else 0
        report.setdefault(offer_id, []).append(
            {
                "rrd_id": _wb_int(row.get("rrd_id")),
                "quantity": quantity,
                "name": str(row.get("doc_type_name") or row.get("supplier_oper_name") or "Операция"),
                "delivery_schema": str(row.get("delivery_method") or row.get("office_name") or ""),
                "product_id": _wb_int(row.get("nm_id") or row.get("nmId")),
                "sale_price": int(sale_price),
                "opt": int(opt),
                "fees": int(fees),
                "payoff": int(payoff),
                "net_profit": int(net_profit),
                "net_profit_perc": int(net_profit_perc),
                "posttax_profit": int(posttax_profit),
                "posttax_profit_perc": int(posttax_profit_perc),
            }
        )
    return report


def _wb_poll_upload_result(wb_hdrs: dict[str, str], upload_id: int, nm_id: int) -> dict[str, Any]:
    for _ in range(2):
        _, state_payload = _wb_get_json(
            f"https://discounts-prices-api.wildberries.ru/api/v2/history/tasks?uploadID={upload_id}",
            wb_hdrs,
        )
        state_data = (state_payload or {}).get("data") or {}
        status = int(state_data.get("status") or 0)
        _, goods_payload = _wb_get_json(
            f"https://discounts-prices-api.wildberries.ru/api/v2/history/goods/task?uploadID={upload_id}&limit=1000&offset=0",
            wb_hdrs,
        )
        history_goods = (((goods_payload or {}).get("data") or {}).get("historyGoods")) or []
        matched = next((g for g in history_goods if int(g.get("nmID") or 0) == int(nm_id)), None)
        if matched:
            item_status = int(matched.get("status") or 0)
            error_text = str(matched.get("errorText") or "").strip()
            if error_text:
                raise HTTPException(status_code=400, detail=error_text)
            if item_status == 1:
                return {"status": "ok", "upload_id": upload_id, "history": matched}
        if status == 3:
            break
    return {"status": "accepted", "upload_id": upload_id}


def _wb_update_price_discount(wb_hdrs: dict[str, str], nm_id: int, price: int, discount: int) -> dict[str, Any]:
    _, payload = _wb_post_json(
        "https://discounts-prices-api.wildberries.ru/api/v2/upload/task",
        wb_hdrs,
        {
            "data": [
                {
                    "nmID": int(nm_id),
                    "price": int(price),
                    "discount": int(discount),
                }
            ]
        },
    )
    error_text = str((payload or {}).get("errorText") or "").strip()
    if error_text:
        if "Specified prices and discounts are already set" in error_text:
            return {"status": "ok", "message": "WB already has these price and discount values"}
        raise HTTPException(status_code=400, detail=error_text)
    data = (payload or {}).get("data") or {}
    upload_id = int(data.get("id") or 0)
    if upload_id <= 0:
        raise HTTPException(status_code=502, detail="wb upload/task did not return upload id")
    try:
        return _wb_poll_upload_result(wb_hdrs, upload_id, nm_id)
    except HTTPException as e:
        if e.status_code == 429:
            return {"status": "accepted", "upload_id": upload_id, "message": "WB accepted the upload, verification delayed by rate limit"}
        raise


def _wb_list_goods(wb_hdrs: dict[str, str]) -> list[dict[str, Any]]:
    offset = 0
    limit = 1000
    all_goods: list[dict[str, Any]] = []
    while True:
        query = urllib.parse.urlencode({"limit": limit, "offset": offset})
        _, payload = _wb_get_json(
            f"https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?{query}",
            wb_hdrs,
        )
        goods = (((payload or {}).get("data") or {}).get("listGoods")) or []
        if not goods:
            break
        if not isinstance(goods, list):
            raise HTTPException(status_code=502, detail="wb upstream error: invalid goods/filter response")
        all_goods.extend(goods)
        if len(goods) < limit:
            break
        offset += limit
    return all_goods


def _build_wb_fbo_stocks_report(wb_hdrs: dict[str, str]) -> dict[str, Any]:
    _, payload = _wb_post_json(
        "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
        wb_hdrs,
        {"nmIds": [], "limit": 250000, "offset": 0},
    )
    items = (((payload or {}).get("data") or {}).get("items")) or []
    if not isinstance(items, list):
        raise HTTPException(status_code=502, detail="wb upstream error: invalid stocks-report response")

    goods_by_nm: dict[int, dict[str, Any]] = {}
    for good in _wb_list_goods(wb_hdrs):
        nm_id = _wb_int(good.get("nmID") or good.get("nmId"))
        if nm_id <= 0:
            continue
        goods_by_nm[nm_id] = {
            "nm_id": nm_id,
            "offer_id": str(good.get("vendorCode") or nm_id),
        }

    grouped: dict[int, dict[str, Any]] = {}
    for row in items:
        nm_id = _wb_int(row.get("nmId"))
        if nm_id <= 0:
            continue
        quantity = _wb_int(row.get("quantity"))
        base = goods_by_nm.get(nm_id, {"nm_id": nm_id, "offer_id": str(nm_id)})
        target = grouped.setdefault(
            nm_id,
            {**base, "total_quantity": 0, "warehouses": []},
        )
        target["total_quantity"] += quantity
        target["warehouses"].append(
            {
                "warehouse_id": _wb_int(row.get("warehouseId")),
                "warehouse_name": str(row.get("warehouseName") or ""),
                "region_name": str(row.get("regionName") or ""),
                "quantity": quantity,
                "in_way_to_client": _wb_int(row.get("inWayToClient")),
                "in_way_from_client": _wb_int(row.get("inWayFromClient")),
            }
        )

    with_stocks = [row for row in grouped.values() if int(row.get("total_quantity") or 0) > 0]
    known_nm_ids = set(goods_by_nm.keys()) | set(grouped.keys())
    without_stocks = []
    for nm_id in known_nm_ids:
        row = grouped.get(nm_id)
        if row and int(row.get("total_quantity") or 0) > 0:
            continue
        base = goods_by_nm.get(nm_id, {"nm_id": nm_id, "offer_id": str(nm_id)})
        without_stocks.append({**base, "total_quantity": int((row or {}).get("total_quantity") or 0)})

    with_stocks.sort(key=lambda x: str(x.get("offer_id") or ""))
    without_stocks.sort(key=lambda x: str(x.get("offer_id") or ""))
    return {
        "items": with_stocks,
        "without_stocks": without_stocks,
        "summary": {
            "with_stocks": len(with_stocks),
            "without_stocks": len(without_stocks),
            "total_quantity": sum(int(x.get("total_quantity") or 0) for x in with_stocks),
        },
    }


def _wb_list_fby_supplies(wb_hdrs: dict[str, str]) -> list[dict[str, Any]]:
    _, payload = _wb_post_json(
        "https://supplies-api.wildberries.ru/api/v1/supplies",
        wb_hdrs,
        {"statusIDs": [1, 2, 3]},
    )
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="wb upstream error: invalid supplies response")
    status_names = {1: "Не запланировано", 2: "Запланировано", 3: "Отгрузка разрешена"}
    items: list[dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        supply_id = _wb_int(row.get("supplyID"))
        preorder_id = _wb_int(row.get("preorderID"))
        status_id = _wb_int(row.get("statusID"))
        if supply_id <= 0 and preorder_id <= 0:
            continue
        items.append(
            {
                "id": str(supply_id or preorder_id),
                "supply_id": supply_id or None,
                "preorder_id": preorder_id or None,
                "warehouse_id": _wb_int(row.get("warehouseID") or row.get("warehouseId")) or None,
                "warehouse_name": str(row.get("warehouseName") or row.get("officeName") or ""),
                "status_id": status_id,
                "status_name": status_names.get(status_id, f"Статус {status_id}"),
                "created_at": row.get("createDate"),
                "supply_date": row.get("supplyDate"),
                "box_type_id": row.get("boxTypeID"),
            }
        )
    return items


def _wb_get_fby_supply_details(wb_hdrs: dict[str, str], supply_id: str, is_order_id: bool = False) -> dict[str, Any]:
    encoded_id = urllib.parse.quote(str(supply_id).strip())
    query = urllib.parse.urlencode({"isOrderId": "true" if is_order_id else "false"})
    _, payload = _wb_get_json(f"https://supplies-api.wildberries.ru/api/v1/supplies/{encoded_id}?{query}", wb_hdrs)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="wb upstream error: invalid supply details response")
    return {
        "warehouse_id": _wb_int(payload.get("warehouseID") or payload.get("warehouseId")) or None,
        "warehouse_name": str(payload.get("warehouseName") or payload.get("officeName") or ""),
    }


def _wb_list_sellable_goods(wb_hdrs: dict[str, str]) -> list[dict[str, Any]]:
    cards_by_nm = _wb_list_card_barcodes(wb_hdrs)
    items: list[dict[str, Any]] = []
    for row in _wb_list_goods(wb_hdrs):
        if not isinstance(row, dict):
            continue
        nm_id = _wb_int(row.get("nmID") or row.get("nmId"))
        if nm_id <= 0:
            continue
        sizes = row.get("sizes") if isinstance(row.get("sizes"), list) else []
        items.append(
            {
                "nm_id": nm_id,
                "offer_id": str(row.get("vendorCode") or nm_id),
                "discount": _wb_int(row.get("discount")),
                "currency": str(row.get("currencyIsoCode4217") or "RUB"),
                "subject_name": str(cards_by_nm.get(nm_id, {}).get("subject_name") or ""),
                "brand": str(cards_by_nm.get(nm_id, {}).get("brand") or ""),
                "color": str(cards_by_nm.get(nm_id, {}).get("color") or ""),
                "barcodes": [
                    {**barcode_row, "quantity": 0}
                    for barcode_row in cards_by_nm.get(nm_id, {}).get("barcodes", [])
                ],
                "sizes": [
                    {
                        "size_id": _wb_int(size.get("sizeID")),
                        "name": str(size.get("techSizeName") or ""),
                        "price": _wb_int(size.get("price")),
                        "discounted_price": _wb_int(size.get("discountedPrice")),
                    }
                    for size in sizes
                    if isinstance(size, dict)
                ],
            }
        )
    items.sort(key=lambda item: str(item.get("offer_id") or ""))
    return items


def _wb_list_card_barcodes(wb_hdrs: dict[str, str]) -> dict[int, dict[str, Any]]:
    cursor: dict[str, Any] = {"limit": 100}
    result: dict[int, dict[str, Any]] = {}
    for _ in range(100):
        _, payload = _wb_post_json(
            "https://content-api.wildberries.ru/content/v2/get/cards/list",
            wb_hdrs,
            {"settings": {"cursor": cursor, "filter": {"withPhoto": -1}}},
        )
        if not isinstance(payload, dict):
            raise HTTPException(status_code=502, detail="wb upstream error: invalid cards/list response")
        cards = payload.get("cards")
        if not isinstance(cards, list):
            raise HTTPException(status_code=502, detail="wb upstream error: invalid cards/list response")
        for card in cards:
            if not isinstance(card, dict):
                continue
            nm_id = _wb_int(card.get("nmID") or card.get("nmId"))
            if nm_id <= 0:
                continue
            color = ""
            characteristics = card.get("characteristics") if isinstance(card.get("characteristics"), list) else []
            for characteristic in characteristics:
                if not isinstance(characteristic, dict):
                    continue
                if str(characteristic.get("name") or "").lower() not in ("цвет", "цвет товара"):
                    continue
                value = characteristic.get("value")
                color = ", ".join(str(v) for v in value) if isinstance(value, list) else str(value or "")
            barcodes: list[dict[str, Any]] = []
            sizes = card.get("sizes") if isinstance(card.get("sizes"), list) else []
            for size in sizes:
                if not isinstance(size, dict) or not isinstance(size.get("skus"), list):
                    continue
                tech_size = str(size.get("techSize") or size.get("wbSize") or "")
                for sku in size.get("skus"):
                    if sku:
                        barcodes.append({"barcode": str(sku), "tech_size": tech_size})
            seen: set[str] = set()
            unique_barcodes = []
            for barcode_row in barcodes:
                barcode = str(barcode_row.get("barcode") or "")
                if not barcode or barcode in seen:
                    continue
                seen.add(barcode)
                unique_barcodes.append(barcode_row)
            result[nm_id] = {
                "subject_name": str(card.get("subjectName") or ""),
                "brand": str(card.get("brand") or ""),
                "color": color,
                "barcodes": unique_barcodes,
            }
        next_cursor = payload.get("cursor") if isinstance(payload.get("cursor"), dict) else {}
        if len(cards) < int(cursor["limit"]):
            break
        cursor = {
            "limit": cursor["limit"],
            "updatedAt": next_cursor.get("updatedAt"),
            "nmID": next_cursor.get("nmID"),
        }
        if not cursor["updatedAt"] or not cursor["nmID"]:
            break
    return result


def _wb_list_fby_supply_goods(wb_hdrs: dict[str, str], supply_id: str) -> list[dict[str, Any]]:
    offset = 0
    limit = 1000
    items: list[dict[str, Any]] = []
    while True:
        query = urllib.parse.urlencode({"limit": limit, "offset": offset})
        _, payload = _wb_get_json(f"https://supplies-api.wildberries.ru/api/v1/supplies/{supply_id}/goods?{query}", wb_hdrs)
        if not isinstance(payload, list):
            raise HTTPException(status_code=502, detail="wb upstream error: invalid supply goods response")
        for row in payload:
            if not isinstance(row, dict):
                continue
            nm_id = _wb_int(row.get("nmID") or row.get("nmId"))
            quantity = _wb_int(row.get("quantity"))
            if nm_id <= 0 and not row.get("vendorCode"):
                continue
            items.append(
                {
                    "nm_id": nm_id,
                    "offer_id": str(row.get("vendorCode") or nm_id),
                    "quantity": quantity,
                    "barcode": str(row.get("barcode") or ""),
                }
            )
        if len(payload) < limit:
            break
        offset += limit
    return items


def _normalize_wb_fby_draft_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        nm_id = _wb_int(row.get("nm_id"))
        if nm_id <= 0:
            continue
        quantity = max(0, _wb_int(row.get("quantity")))
        sizes = row.get("sizes") if isinstance(row.get("sizes"), list) else []
        raw_barcodes = row.get("barcodes") if isinstance(row.get("barcodes"), list) else []
        barcodes = []
        for barcode_row in raw_barcodes:
            if isinstance(barcode_row, dict):
                barcode = str(barcode_row.get("barcode") or "")
                barcode_quantity = max(0, _wb_int(barcode_row.get("quantity")))
            else:
                barcode = str(barcode_row or "")
                barcode_quantity = 0
            if barcode:
                barcodes.append({"barcode": barcode, "quantity": barcode_quantity})
        if not barcodes and quantity > 0:
            barcodes.append({"barcode": "", "quantity": quantity})
        normalized.append(
            {
                "nm_id": nm_id,
                "offer_id": str(row.get("offer_id") or nm_id),
                "quantity": quantity,
                "discount": _wb_int(row.get("discount")),
                "currency": str(row.get("currency") or "RUB"),
                "subject_name": str(row.get("subject_name") or ""),
                "brand": str(row.get("brand") or ""),
                "color": str(row.get("color") or ""),
                "barcodes": barcodes,
                "sizes": [size for size in sizes if isinstance(size, dict)],
            }
        )
    normalized.sort(key=lambda item: str(item.get("offer_id") or ""))
    return normalized


def _load_wb_fby_supply_draft(user_uuid_val: uuid.UUID, supply_id: str) -> tuple[dict[str, Any], datetime.datetime] | None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT payload, updated_at FROM wb_fby_supply_drafts WHERE user_uuid=%s AND supply_id=%s",
            (user_uuid_val, supply_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    payload = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return payload, row[1]


def _save_wb_fby_supply_draft(user_uuid_val: uuid.UUID, supply_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    payload = {"items": _normalize_wb_fby_draft_items(items)}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO wb_fby_supply_drafts (user_uuid, supply_id, payload, updated_at)
            VALUES (%s, %s, %s::jsonb, NOW())
            ON CONFLICT (user_uuid, supply_id)
            DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()
            """,
            (user_uuid_val, supply_id, json.dumps(payload, ensure_ascii=False)),
        )
    return payload


def _xlsx_cell(ref: str, value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value or ""))}</t></is></c>'


def _write_simple_xlsx(path: Path, rows: list[list[Any]]) -> None:
    cols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    sheet_rows = []
    for row_idx, row in enumerate(rows, start=1):
        cells = "".join(_xlsx_cell(f"{cols[col_idx]}{row_idx}", value) for col_idx, value in enumerate(row))
        sheet_rows.append(f'<row r="{row_idx}">{cells}</row>')
    last_col = cols[max(0, len(rows[0]) - 1)] if rows else "A"
    dimension_ref = f"A1:{last_col}{max(1, len(rows))}"
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="{dimension_ref}"/>'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    with ZipFile(path, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
        zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr filterPrivacy="true"/><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>')
        zf.writestr("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
        zf.writestr("xl/theme/theme1.xml", '<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"/></a:themeElements></a:theme>')
        zf.writestr("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MeshCRM</Application></Properties>')
        zf.writestr("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>MeshCRM</dc:creator></cp:coreProperties>')
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def _build_wb_fby_excel_rows(payload: dict[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = [["Баркод", "Количество"]]
    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        for barcode_row in item.get("barcodes", []):
            if not isinstance(barcode_row, dict):
                continue
            barcode = str(barcode_row.get("barcode") or "")
            quantity = _wb_int(barcode_row.get("quantity"))
            if not barcode or quantity <= 0:
                continue
            rows.append([barcode, quantity])
    return rows


def _wb_fby_excel_path(user_uuid_val: uuid.UUID, supply_id: str) -> Path:
    safe_supply_id = "".join(ch for ch in supply_id if ch.isalnum() or ch in ("-", "_")) or "supply"
    return TEMP_DIR / f"wb-fby-{user_uuid_val}-{safe_supply_id}.xlsx"


def _generate_wb_fby_excel(user_uuid_val: uuid.UUID, supply_id: str, payload: dict[str, Any]) -> Path:
    rows = _build_wb_fby_excel_rows(payload)
    path = _wb_fby_excel_path(user_uuid_val, supply_id)
    _write_simple_xlsx(path, rows)
    return path


def _create_wb_fby_excel_token(user_uuid_val: uuid.UUID, supply_id: str) -> str:
    token = uuid.uuid4().hex
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM wb_fby_supply_excel_tokens WHERE expires_at < NOW()")
        cur.execute(
            """
            INSERT INTO wb_fby_supply_excel_tokens (token, user_uuid, supply_id, expires_at)
            VALUES (%s, %s, %s, NOW() + INTERVAL '10 minutes')
            """,
            (token, user_uuid_val, supply_id),
        )
    return token


def _consume_wb_fby_excel_token(token: str) -> tuple[uuid.UUID, str]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM wb_fby_supply_excel_tokens
            WHERE token=%s AND expires_at >= NOW()
            RETURNING user_uuid, supply_id
            """,
            (token,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="download token expired")
    return uuid.UUID(str(row[0])), str(row[1])


def _save_wb_fbo_stocks_cache(user_uuid_val: uuid.UUID, payload: dict[str, Any]) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO wb_fbo_stocks_cache (user_uuid, payload, updated_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (user_uuid) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()
            """,
            (user_uuid_val, json.dumps(payload, ensure_ascii=False)),
        )


def _load_wb_fbo_stocks_cache(user_uuid_val: uuid.UUID) -> tuple[dict[str, Any], datetime.datetime] | None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT payload, updated_at FROM wb_fbo_stocks_cache WHERE user_uuid=%s",
            (user_uuid_val,),
        )
        row = cur.fetchone()
    if not row:
        return None
    payload = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return payload, row[1]


def _load_wb_stocks_report_cached(user_uuid_val: uuid.UUID, max_age_seconds: int = 1800) -> tuple[dict[str, Any], datetime.datetime, str]:
    cached = _load_wb_fbo_stocks_cache(user_uuid_val)
    if cached:
        payload, updated_at = cached
        now = datetime.datetime.now(datetime.timezone.utc)
        compare_updated_at = updated_at if updated_at.tzinfo else updated_at.replace(tzinfo=datetime.timezone.utc)
        if (now - compare_updated_at).total_seconds() < max_age_seconds:
            return payload, updated_at, "cache"
    payload = _build_wb_fbo_stocks_report(_wb_headers(user_uuid_val))
    _save_wb_fbo_stocks_cache(user_uuid_val, payload)
    return payload, datetime.datetime.now(datetime.timezone.utc), "live"


def _filter_wb_stocks_report(payload: dict[str, Any], nm_ids: set[int]) -> list[dict[str, Any]]:
    by_nm: dict[int, dict[str, Any]] = {}
    for row in list(payload.get("items") or []) + list(payload.get("without_stocks") or []):
        if not isinstance(row, dict):
            continue
        nm_id = _wb_int(row.get("nm_id"))
        if nm_id <= 0 or (nm_ids and nm_id not in nm_ids):
            continue
        by_nm[nm_id] = {
            "nm_id": nm_id,
            "offer_id": str(row.get("offer_id") or nm_id),
            "total_quantity": _wb_int(row.get("total_quantity")),
            "warehouses": row.get("warehouses") if isinstance(row.get("warehouses"), list) else [],
        }
    for nm_id in nm_ids:
        by_nm.setdefault(nm_id, {"nm_id": nm_id, "offer_id": str(nm_id), "total_quantity": 0, "warehouses": []})
    return sorted(by_nm.values(), key=lambda item: str(item.get("offer_id") or ""))


def _save_ozon_finance_cache(
    user_uuid_val: uuid.UUID, months_ago: int, report: dict[str, list[dict[str, Any]]]
) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM ozon_finance_operations_cache WHERE user_uuid=%s AND months_ago=%s",
            (user_uuid_val, months_ago),
        )
        for offer_id, entries in report.items():
            for entry in entries:
                cur.execute(
                    """
                    INSERT INTO ozon_finance_operations_cache (
                      user_uuid, months_ago, posting_number, offer_id, delivery_schema, sku, sale_price, opt, fees, payoff,
                      net_profit, net_profit_perc, posttax_profit, posttax_profit_perc, quantity, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    """,
                    (
                        user_uuid_val,
                        months_ago,
                        str(entry.get("name") or ""),
                        offer_id,
                        str(entry.get("delivery_schema") or ""),
                        int(entry.get("product_id") or 0),
                        int(entry.get("sale_price") or 0),
                        int(entry.get("opt") or 0),
                        int(entry.get("fees") or 0),
                        int(entry.get("payoff") or 0),
                        int(entry.get("net_profit") or 0),
                        int(entry.get("net_profit_perc") or 0),
                        int(entry.get("posttax_profit") or 0),
                        int(entry.get("posttax_profit_perc") or 0),
                        int(entry.get("quantity") or 1),
                    ),
                )


def _load_ozon_finance_cache(
    user_uuid_val: uuid.UUID, months_ago: int
) -> tuple[dict[str, list[dict[str, Any]]], str | None]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id, posting_number, delivery_schema, sku, sale_price, opt, fees, payoff, net_profit, net_profit_perc,
                   posttax_profit, posttax_profit_perc, quantity, updated_at
            FROM ozon_finance_operations_cache
            WHERE user_uuid=%s AND months_ago=%s
            ORDER BY offer_id, posting_number
            """,
            (user_uuid_val, months_ago),
        )
        rows = cur.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="cache is empty for this period, run mode=live first")
    report: dict[str, list[dict[str, Any]]] = {}
    refreshed_at = ""
    for row in rows:
        offer_id = str(row[0] or "")
        report.setdefault(offer_id, []).append(
            {
                "quantity": int(row[12] or 1),
                "name": str(row[1] or ""),
                "delivery_schema": str(row[2] or ""),
                "product_id": int(row[3] or 0),
                "sale_price": int(row[4] or 0),
                "opt": int(row[5] or 0),
                "fees": int(row[6] or 0),
                "payoff": int(row[7] or 0),
                "net_profit": int(row[8] or 0),
                "net_profit_perc": int(row[9] or 0),
                "posttax_profit": int(row[10] or 0),
                "posttax_profit_perc": int(row[11] or 0),
            }
        )
        if row[13]:
            refreshed_at = row[13].isoformat()
    return report, refreshed_at or None


def _save_wb_finance_cache(
    user_uuid_val: uuid.UUID, months_ago: int, report: dict[str, list[dict[str, Any]]]
) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM wb_finance_operations_cache WHERE user_uuid=%s AND months_ago=%s",
            (user_uuid_val, months_ago),
        )
        for offer_id, entries in report.items():
            for entry in entries:
                cur.execute(
                    """
                    INSERT INTO wb_finance_operations_cache (
                      user_uuid, months_ago, rrd_id, offer_id, operation_name, delivery_schema, product_id, sale_price, opt, fees,
                      payoff, net_profit, net_profit_perc, posttax_profit, posttax_profit_perc, quantity, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    """,
                    (
                        user_uuid_val,
                        months_ago,
                        int(entry.get("rrd_id") or 0),
                        offer_id,
                        str(entry.get("name") or ""),
                        str(entry.get("delivery_schema") or ""),
                        int(entry.get("product_id") or 0),
                        int(entry.get("sale_price") or 0),
                        int(entry.get("opt") or 0),
                        int(entry.get("fees") or 0),
                        int(entry.get("payoff") or 0),
                        int(entry.get("net_profit") or 0),
                        int(entry.get("net_profit_perc") or 0),
                        int(entry.get("posttax_profit") or 0),
                        int(entry.get("posttax_profit_perc") or 0),
                        int(entry.get("quantity") or 1),
                    ),
                )


def _load_wb_finance_cache(
    user_uuid_val: uuid.UUID, months_ago: int
) -> tuple[dict[str, list[dict[str, Any]]], str | None]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id, rrd_id, operation_name, delivery_schema, product_id, sale_price, opt, fees, payoff, net_profit,
                   net_profit_perc, posttax_profit, posttax_profit_perc, quantity, updated_at
            FROM wb_finance_operations_cache
            WHERE user_uuid=%s AND months_ago=%s
            ORDER BY offer_id, rrd_id
            """,
            (user_uuid_val, months_ago),
        )
        rows = cur.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="cache is empty for this period, run mode=live first")
    report: dict[str, list[dict[str, Any]]] = {}
    refreshed_at = ""
    for row in rows:
        offer_id = str(row[0] or "")
        report.setdefault(offer_id, []).append(
            {
                "rrd_id": int(row[1] or 0),
                "name": str(row[2] or ""),
                "delivery_schema": str(row[3] or ""),
                "product_id": int(row[4] or 0),
                "sale_price": int(row[5] or 0),
                "opt": int(row[6] or 0),
                "fees": int(row[7] or 0),
                "payoff": int(row[8] or 0),
                "net_profit": int(row[9] or 0),
                "net_profit_perc": int(row[10] or 0),
                "posttax_profit": int(row[11] or 0),
                "posttax_profit_perc": int(row[12] or 0),
                "quantity": int(row[13] or 1),
            }
        )
        if row[14]:
            refreshed_at = row[14].isoformat()
    return report, refreshed_at or None


def _realization_from_finance_cache(user_uuid_val: uuid.UUID, months_ago: int = 1) -> dict[str, Any]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id, sale_price, quantity
            FROM ozon_finance_operations_cache
            WHERE user_uuid=%s AND months_ago=%s
            """,
            (user_uuid_val, months_ago),
        )
        rows = cur.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="finance cache is empty, run /ozon/finances with mode=live first")
    realization: dict[str, Any] = {}
    price_groups: dict[str, list[float]] = {}
    price_acc: dict[str, Any] = {}
    for row in rows:
        offer_id = str(row[0] or "")
        if not offer_id:
            continue
        qty = int(row[2] or 0)
        sale_price = float(row[1] or 0)
        realization.setdefault(offer_id, {"sale_qty": 0, "avg_seller_price": 0, "avg_list": []})
        realization[offer_id]["sale_qty"] = int(realization[offer_id].get("sale_qty") or 0) + max(qty, 0)
        if qty > 0 and sale_price > 0:
            per_unit = sale_price / qty
            price_acc.setdefault(offer_id, {"total": 0.0, "count": 0})
            price_acc[offer_id]["total"] += per_unit * qty
            price_acc[offer_id]["count"] += qty
            price_groups.setdefault(offer_id, []).extend([per_unit] * qty)

    for offer_id, acc in price_acc.items():
        c = int(acc.get("count") or 0)
        avg = int((float(acc.get("total") or 0) / c) if c else 0)
        realization.setdefault(offer_id, {"sale_qty": 0})
        realization[offer_id]["avg_seller_price"] = avg

    for offer_id, prices in price_groups.items():
        if not prices:
            realization.setdefault(offer_id, {})["avg_list"] = []
            continue
        sorted_prices = sorted(prices)
        used = [False] * len(sorted_prices)
        groups: list[list[float]] = []
        i = 0
        while i < len(sorted_prices):
            if used[i]:
                i += 1
                continue
            group = [sorted_prices[i]]
            used[i] = True
            for j in range(i + 1, len(sorted_prices)):
                if not used[j] and abs(sorted_prices[j] - group[0]) / group[0] <= 0.1:
                    group.append(sorted_prices[j])
                    used[j] = True
            groups.append(group)
            i += 1
        realization.setdefault(offer_id, {})["avg_list"] = [
            {"count": len(g), "avg_price": int(sum(g) / len(g))} for g in groups if g
        ]
    return realization


def _realization_from_wb_finance_cache(user_uuid_val: uuid.UUID, months_ago: int = 1) -> dict[str, Any]:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id, sale_price, quantity
            FROM wb_finance_operations_cache
            WHERE user_uuid=%s AND months_ago=%s
            """,
            (user_uuid_val, months_ago),
        )
        rows = cur.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="finance cache is empty, run /wb/finances with mode=live first")
    realization: dict[str, Any] = {}
    for row in rows:
        offer_id = str(row[0] or "")
        if not offer_id:
            continue
        qty = int(row[2] or 0)
        realization.setdefault(offer_id, {"sale_qty": 0})
        realization[offer_id]["sale_qty"] = int(realization[offer_id].get("sale_qty") or 0) + max(qty, 0)
    return realization

def _get_moysklad_token(user_uuid_val: uuid.UUID) -> str:
    s = _get_provider_settings("moysklad", user_uuid_val)
    if not s.api_key:
        raise HTTPException(status_code=400, detail="moysklad api_key not configured")
    return s.api_key


def _get_moysklad_contragents(user_uuid_val: uuid.UUID) -> MoyskladContragentsIn:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT organization_id, organization_name, ozon_id, ozon_name, wb_id, wb_name, yandex_id, yandex_name
            FROM moysklad_contragents_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        row = cur.fetchone()
    if not row:
        return MoyskladContragentsIn()
    return MoyskladContragentsIn(
        organization_id=row[0],
        organization_name=row[1],
        ozon_id=row[2],
        ozon_name=row[3],
        wb_id=row[4],
        wb_name=row[5],
        yandex_id=row[6],
        yandex_name=row[7],
    )

def _get_moysklad_storage(user_uuid_val: uuid.UUID) -> MoyskladStorageIn:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT ozon_store_id, ozon_store_name, wb_store_id, wb_store_name, yandex_store_id, yandex_store_name
            FROM moysklad_storage_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        row = cur.fetchone()
    if not row:
        return MoyskladStorageIn()
    return MoyskladStorageIn(
        ozon_store_id=row[0],
        ozon_store_name=row[1],
        wb_store_id=row[2],
        wb_store_name=row[3],
        yandex_store_id=row[4],
        yandex_store_name=row[5],
    )


def _save_moysklad_contragents(user_uuid_val: uuid.UUID, body: MoyskladContragentsIn) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moysklad_contragents_settings (
              user_uuid,
              organization_id, organization_name,
              ozon_id, ozon_name,
              wb_id, wb_name,
              yandex_id, yandex_name
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (user_uuid) DO UPDATE SET
              organization_id=EXCLUDED.organization_id,
              organization_name=EXCLUDED.organization_name,
              ozon_id=EXCLUDED.ozon_id,
              ozon_name=EXCLUDED.ozon_name,
              wb_id=EXCLUDED.wb_id,
              wb_name=EXCLUDED.wb_name,
              yandex_id=EXCLUDED.yandex_id,
              yandex_name=EXCLUDED.yandex_name,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                body.organization_id,
                body.organization_name,
                body.ozon_id,
                body.ozon_name,
                body.wb_id,
                body.wb_name,
                body.yandex_id,
                body.yandex_name,
            ),
        )

def _save_moysklad_storage(user_uuid_val: uuid.UUID, body: MoyskladStorageIn) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moysklad_storage_settings (
              user_uuid,
              ozon_store_id, ozon_store_name,
              wb_store_id, wb_store_name,
              yandex_store_id, yandex_store_name
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (user_uuid) DO UPDATE SET
              ozon_store_id=EXCLUDED.ozon_store_id,
              ozon_store_name=EXCLUDED.ozon_store_name,
              wb_store_id=EXCLUDED.wb_store_id,
              wb_store_name=EXCLUDED.wb_store_name,
              yandex_store_id=EXCLUDED.yandex_store_id,
              yandex_store_name=EXCLUDED.yandex_store_name,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                body.ozon_store_id,
                body.ozon_store_name,
                body.wb_store_id,
                body.wb_store_name,
                body.yandex_store_id,
                body.yandex_store_name,
            ),
        )

def _get_moysklad_status(user_uuid_val: uuid.UUID) -> MoyskladStatusIn:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT awaiting_id, awaiting_name, shipped_id, shipped_name, completed_id, completed_name, cancelled_id, cancelled_name
            FROM moysklad_status_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        row = cur.fetchone()
    if not row:
        return MoyskladStatusIn()
    return MoyskladStatusIn(
        awaiting_id=row[0],
        awaiting_name=row[1],
        shipped_id=row[2],
        shipped_name=row[3],
        completed_id=row[4],
        completed_name=row[5],
        cancelled_id=row[6],
        cancelled_name=row[7],
    )


def _save_moysklad_status(user_uuid_val: uuid.UUID, body: MoyskladStatusIn) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moysklad_status_settings (
              user_uuid,
              awaiting_id, awaiting_name,
              shipped_id, shipped_name,
              completed_id, completed_name,
              cancelled_id, cancelled_name
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (user_uuid) DO UPDATE SET
              awaiting_id=EXCLUDED.awaiting_id,
              awaiting_name=EXCLUDED.awaiting_name,
              shipped_id=EXCLUDED.shipped_id,
              shipped_name=EXCLUDED.shipped_name,
              completed_id=EXCLUDED.completed_id,
              completed_name=EXCLUDED.completed_name,
              cancelled_id=EXCLUDED.cancelled_id,
              cancelled_name=EXCLUDED.cancelled_name,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                body.awaiting_id,
                body.awaiting_name,
                body.shipped_id,
                body.shipped_name,
                body.completed_id,
                body.completed_name,
                body.cancelled_id,
                body.cancelled_name,
            ),
        )

def _get_ozon_promo_settings(user_uuid_val: uuid.UUID) -> dict[str, Any]:
    out: dict[str, Any] = {}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT offer_id, yourprice, minprice, min_price_fbs, min_price_limit_count, min_price_promo,
                   min_price_discount, limit_count_value,
                   use_fbs, use_limit_count, use_promo, autoupdate_promo, auto_update_days_limit_promo, use_discount
            FROM ozon_promo_product_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        rows = cur.fetchall() or []
    for r in rows:
        out[str(r[0])] = {
            "offer_id": str(r[0]),
            "yourprice": int(r[1] or 0),
            "minprice": int(r[2] or 0),
            "min_price_fbs": int(r[3] or 0),
            "min_price_limit_count": int(r[4] or 0),
            "min_price_promo": int(r[5] or 0),
            "min_price_discount": int(r[6] or 0),
            "limit_count_value": int(r[7] or 1),
            "use_fbs": bool(r[8]),
            "use_limit_count": bool(r[9]),
            "use_promo": bool(r[10]),
            "autoupdate_promo": bool(r[11]),
            "auto_update_days_limit_promo": bool(r[12]),
            "use_discount": bool(r[13]),
        }
    return out


def _get_wb_promo_settings(user_uuid_val: uuid.UUID) -> dict[str, Any]:
    out: dict[str, Any] = {}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT nm_id, offer_id, min_price_auto, auto_update_price
            FROM wb_promo_product_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        rows = cur.fetchall() or []
    for r in rows:
        out[str(r[0])] = {
            "nm_id": int(r[0] or 0),
            "offer_id": str(r[1] or ""),
            "min_price_auto": int(r[2] or 0),
            "auto_update_price": bool(r[3]),
        }
    return out


def _save_ozon_promo_settings(user_uuid_val: uuid.UUID, body: OzonPromoProductSettingsIn) -> None:
    offer_id = (body.offer_id or "").strip()
    if not offer_id:
        raise HTTPException(status_code=400, detail="offer_id is required")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ozon_promo_product_settings (
              user_uuid, offer_id,
              yourprice, minprice,
              min_price_fbs, min_price_limit_count, min_price_promo, min_price_discount,
              limit_count_value,
              use_fbs, use_limit_count, use_promo, autoupdate_promo, auto_update_days_limit_promo, use_discount
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (user_uuid, offer_id) DO UPDATE SET
              yourprice=EXCLUDED.yourprice,
              minprice=EXCLUDED.minprice,
              min_price_fbs=EXCLUDED.min_price_fbs,
              min_price_limit_count=EXCLUDED.min_price_limit_count,
              min_price_promo=EXCLUDED.min_price_promo,
              min_price_discount=EXCLUDED.min_price_discount,
              limit_count_value=EXCLUDED.limit_count_value,
              use_fbs=EXCLUDED.use_fbs,
              use_limit_count=EXCLUDED.use_limit_count,
              use_promo=EXCLUDED.use_promo,
              autoupdate_promo=EXCLUDED.autoupdate_promo,
              auto_update_days_limit_promo=EXCLUDED.auto_update_days_limit_promo,
              use_discount=EXCLUDED.use_discount,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                offer_id,
                body.yourprice,
                body.minprice,
                body.min_price_fbs,
                body.min_price_limit_count,
                body.min_price_promo,
                body.min_price_discount,
                body.limit_count_value,
                body.use_fbs,
                body.use_limit_count,
                body.use_promo,
                body.autoupdate_promo,
                body.auto_update_days_limit_promo,
                body.use_discount,
            ),
        )


def _save_wb_promo_settings(user_uuid_val: uuid.UUID, body: WbPromoProductSettingsIn) -> None:
    if body.nm_id <= 0:
        raise HTTPException(status_code=400, detail="nm_id is required")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO wb_promo_product_settings (
              user_uuid, nm_id, offer_id, min_price_auto, auto_update_price
            )
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (user_uuid, nm_id) DO UPDATE SET
              offer_id=EXCLUDED.offer_id,
              min_price_auto=EXCLUDED.min_price_auto,
              auto_update_price=EXCLUDED.auto_update_price,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                int(body.nm_id),
                str(body.offer_id or ""),
                int(body.min_price_auto or 0),
                bool(body.auto_update_price),
            ),
        )


def _ozon_finance_realization(ozon_hdrs: dict[str, str], year: int, month: int) -> dict[str, Any]:
    return _ozon_post_json(
        "https://api-seller.ozon.ru/v2/finance/realization",
        ozon_hdrs,
        {"year": int(year), "month": int(month)},
    )


def _profit_color(percent: float) -> str:
    try:
        p = float(percent)
    except Exception:
        p = 0.0
    if p < 30:
        return "red"
    if p < 60:
        return "yellow"
    return "green"

@app.get("/api-settings")
def get_api_settings(x_user_uuid: str | None = Header(default=None)) -> ApiSettingsIn:
    user_uuid_val = _user_uuid(x_user_uuid)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT moy_sklad_api, yandex_market_api, wildberries_api, ozon_client_id, ozon_api
            FROM marketplace_api_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        row = cur.fetchone()
    if not row:
        return ApiSettingsIn()
    return ApiSettingsIn(
        moy_sklad_api=row[0],
        yandex_market_api=row[1],
        wildberries_api=row[2],
        ozon_client_id=row[3],
        ozon_api=row[4],
    )


@app.post("/api-settings")
def save_api_settings(body: ApiSettingsIn, x_user_uuid: str | None = Header(default=None)) -> dict[str, str]:
    user_uuid_val = _user_uuid(x_user_uuid)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO marketplace_api_settings (
              user_uuid, moy_sklad_api, yandex_market_api, wildberries_api, ozon_client_id, ozon_api
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_uuid) DO UPDATE SET
              moy_sklad_api=EXCLUDED.moy_sklad_api,
              yandex_market_api=EXCLUDED.yandex_market_api,
              wildberries_api=EXCLUDED.wildberries_api,
              ozon_client_id=EXCLUDED.ozon_client_id,
              ozon_api=EXCLUDED.ozon_api,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                body.moy_sklad_api,
                body.yandex_market_api,
                body.wildberries_api,
                body.ozon_client_id,
                body.ozon_api,
            ),
        )
    return {"status": "ok"}


@app.get("/ozon/settings")
def get_ozon_settings(x_user_uuid: str | None = Header(default=None)) -> ProviderSettingsIn:
    return _get_provider_settings("ozon", _user_uuid(x_user_uuid))


@app.post("/ozon/settings")
def save_ozon_settings(body: ProviderSettingsIn, x_user_uuid: str | None = Header(default=None)) -> dict[str, str]:
    _save_provider_settings("ozon", _user_uuid(x_user_uuid), body)
    return {"status": "ok"}


@app.get("/ozon/fby/supplies")
def ozon_fby_supplies(x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    return {"items": _ozon_supply_orders(_ozon_headers(user_uuid_val))}


@app.get("/ozon/fby/supplies/{supply_id}/goods")
def ozon_fby_supply_goods(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    return {"items": _ozon_supply_goods(user_uuid_val, _ozon_headers(user_uuid_val), supply_id)}


@app.get("/ozon/fby/supplies/{supply_id}/sellable-goods")
def ozon_fby_supply_sellable_goods(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    items = _ozon_list_sellable_goods(user_uuid_val, _ozon_headers(user_uuid_val))
    return {"supply_id": supply_id, "items": items, "total": len(items)}


@app.get("/ozon/fby/supplies/{supply_id}/details")
def ozon_fby_supply_details(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    order_id = _wb_int(supply_id)
    if order_id <= 0:
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    return _ozon_supply_order_details(user_uuid_val, _ozon_headers(user_uuid_val), order_id)


@app.get("/ozon/fby/supplies/{supply_id}/draft")
def get_ozon_fby_supply_draft(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    draft = _load_ozon_fby_supply_draft(_user_uuid(x_user_uuid), supply_id)
    if not draft:
        return {"exists": False, "items": []}
    payload, updated_at = draft
    return {"exists": True, "items": _normalize_ozon_fby_draft_items(payload.get("items") or []), "updated_at": updated_at.isoformat()}


@app.post("/ozon/fby/supplies/{supply_id}/draft")
def save_ozon_fby_supply_draft(
    supply_id: str,
    body: OzonFbyDraftIn,
    x_user_uuid: str | None = Header(default=None),
) -> dict[str, Any]:
    payload = _save_ozon_fby_supply_draft(_user_uuid(x_user_uuid), supply_id, body.items)
    return {"status": "ok", "items": payload.get("items") or []}


@app.post("/ozon/fby/supplies/{supply_id}/content-update")
def update_ozon_fby_supply_content(
    supply_id: str,
    body: OzonFbyDraftIn,
    x_user_uuid: str | None = Header(default=None),
) -> dict[str, Any]:
    order_id = _wb_int(supply_id)
    if order_id <= 0:
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    return _ozon_supply_order_content_update(user_uuid_val, _ozon_headers(user_uuid_val), order_id, body.items)


@app.get("/ozon/fby/stocks")
def ozon_fby_stocks(skus: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    sku_list = [sku for sku in (_wb_int(part) for part in skus.split(",")) if sku > 0]
    if not sku_list:
        return {"items": [], "source": "empty"}
    user_uuid_val = _user_uuid(x_user_uuid)
    rows, updated_at, source = _ozon_stocks_cached(user_uuid_val, _ozon_headers(user_uuid_val), sku_list)
    by_sku: dict[int, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        sku = _wb_int(row.get("sku"))
        item = by_sku.setdefault(sku, {"sku": sku, "stock_quantity": 0, "warehouses": []})
        qty = _wb_int(row.get("available_stock_count"))
        item["stock_quantity"] += qty
        item["warehouses"].append(
            {
                "warehouse_id": _wb_int(row.get("warehouse_id")) or None,
                "warehouse_name": row.get("warehouse_name") or row.get("cluster_name") or "",
                "cluster_name": row.get("cluster_name") or "",
                "quantity": qty,
            }
        )
    return {"items": list(by_sku.values()), "updated_at": updated_at.isoformat(), "source": source}


@app.get("/wb/settings")
def get_wb_settings(x_user_uuid: str | None = Header(default=None)) -> ProviderSettingsIn:
    return _get_provider_settings("wb", _user_uuid(x_user_uuid))


@app.post("/wb/settings")
def save_wb_settings(body: ProviderSettingsIn, x_user_uuid: str | None = Header(default=None)) -> dict[str, str]:
    _save_provider_settings("wb", _user_uuid(x_user_uuid), body)
    return {"status": "ok"}


@app.get("/yandex/settings")
def get_yandex_settings(x_user_uuid: str | None = Header(default=None)) -> ProviderSettingsIn:
    return _get_provider_settings("yandex", _user_uuid(x_user_uuid))


@app.post("/yandex/settings")
def save_yandex_settings(body: ProviderSettingsIn, x_user_uuid: str | None = Header(default=None)) -> dict[str, str]:
    _save_provider_settings("yandex", _user_uuid(x_user_uuid), body)
    return {"status": "ok"}


@app.get("/ozon/finances")
def ozon_finances(
    x_user_uuid: str | None = Header(default=None),
    months_ago: int = Query(default=1, ge=1, le=24),
    mode: str = Query(default="cache", pattern="^(cache|live)$"),
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    now = datetime.datetime.utcnow()
    _, _, start_date, stop_date = _month_range_utc_months_ago(now, months_ago)
    if mode == "live":
        ozon_hdrs = _ozon_headers(user_uuid_val)
        report = _build_ozon_finance_report_from_api(user_uuid_val, ozon_hdrs, start_date, stop_date)
        _save_ozon_finance_cache(user_uuid_val, months_ago, report)
        return _compose_ozon_finance_response(
            report=report,
            start_date=start_date,
            stop_date=stop_date,
            source="live",
            refreshed_at=datetime.datetime.utcnow().isoformat(),
        )
    report, refreshed_at = _load_ozon_finance_cache(user_uuid_val, months_ago)
    return _compose_ozon_finance_response(
        report=report,
        start_date=start_date,
        stop_date=stop_date,
        source="cache",
        refreshed_at=refreshed_at,
    )


@app.get("/wb/finances")
def wb_finances(
    x_user_uuid: str | None = Header(default=None),
    months_ago: int = Query(default=1, ge=0, le=24),
    mode: str = Query(default="cache", pattern="^(cache|live)$"),
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    now = datetime.datetime.utcnow()
    _, _, start_date, stop_date = _month_range_utc_months_ago(now, months_ago)
    if mode == "live":
        wb_hdrs = _wb_headers(user_uuid_val)
        report = _build_wb_finance_report_from_api(user_uuid_val, wb_hdrs, start_date, stop_date)
        _save_wb_finance_cache(user_uuid_val, months_ago, report)
        return _compose_ozon_finance_response(
            report=report,
            start_date=start_date,
            stop_date=stop_date,
            source="live",
            refreshed_at=datetime.datetime.utcnow().isoformat(),
        )
    report, refreshed_at = _load_wb_finance_cache(user_uuid_val, months_ago)
    return _compose_ozon_finance_response(
        report=report,
        start_date=start_date,
        stop_date=stop_date,
        source="cache",
        refreshed_at=refreshed_at,
    )


@app.get("/wb/fbo/stocks")
def wb_fbo_stocks(
    x_user_uuid: str | None = Header(default=None),
    mode: str = Query(default="cache", pattern="^(cache|live)$"),
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    cached = _load_wb_fbo_stocks_cache(user_uuid_val)
    if mode == "cache" and cached:
        payload, updated_at = cached
        return {**payload, "source": "cache", "updated_at": updated_at.isoformat()}

    if mode == "cache" and not cached:
        raise HTTPException(status_code=404, detail="cache is empty, press 'Обновить из WB'")

    if cached:
        payload, updated_at = cached
        age = datetime.datetime.now(datetime.timezone.utc) - updated_at
        if age.total_seconds() < 20:
            return {**payload, "source": "cache", "updated_at": updated_at.isoformat()}

    payload = _build_wb_fbo_stocks_report(_wb_headers(user_uuid_val))
    _save_wb_fbo_stocks_cache(user_uuid_val, payload)
    return {**payload, "source": "live", "updated_at": datetime.datetime.utcnow().isoformat()}


@app.get("/wb/fby/supplies")
def wb_fby_supplies(x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    items = _wb_list_fby_supplies(_wb_headers(user_uuid_val))
    return {"items": items, "total": len(items)}


@app.get("/wb/fby/supplies/{supply_id}/goods")
def wb_fby_supply_goods(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    items = _wb_list_sellable_goods(_wb_headers(user_uuid_val))
    return {"supply_id": supply_id, "items": items, "total": len(items)}


@app.get("/wb/fby/supplies/{supply_id}/details")
def wb_fby_supply_details(
    supply_id: str,
    x_user_uuid: str | None = Header(default=None),
    is_order_id: bool = Query(default=False),
) -> dict[str, Any]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    details = _wb_get_fby_supply_details(_wb_headers(user_uuid_val), supply_id, is_order_id=is_order_id)
    return {"supply_id": supply_id, **details}


@app.get("/wb/fby/supplies/{supply_id}/wb-goods")
def wb_fby_supply_wb_goods(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    items = _wb_list_fby_supply_goods(_wb_headers(user_uuid_val), supply_id)
    return {"supply_id": supply_id, "items": items, "total": len(items)}


@app.get("/wb/fby/stocks")
def wb_fby_stocks(
    x_user_uuid: str | None = Header(default=None),
    nm_ids: str = Query(default=""),
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    parsed_nm_ids = {
        _wb_int(part)
        for part in nm_ids.split(",")
        if part.strip()
    }
    parsed_nm_ids = {nm_id for nm_id in parsed_nm_ids if nm_id > 0}
    payload, updated_at, source = _load_wb_stocks_report_cached(user_uuid_val)
    items = _filter_wb_stocks_report(payload, parsed_nm_ids)
    return {"items": items, "total": len(items), "source": source, "updated_at": updated_at.isoformat()}


@app.get("/wb/fby/supplies/{supply_id}/draft")
def wb_fby_supply_draft(supply_id: str, x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    draft = _load_wb_fby_supply_draft(user_uuid_val, supply_id)
    if not draft:
        return {"exists": False, "supply_id": supply_id, "items": []}
    payload, updated_at = draft
    items = payload.get("items") if isinstance(payload, dict) else []
    return {
        "exists": True,
        "supply_id": supply_id,
        "items": items if isinstance(items, list) else [],
        "updated_at": updated_at.isoformat(),
        "download_url": f"/marketplaces/wb/fby/supplies/{urllib.parse.quote(supply_id)}/draft/excel",
    }


@app.post("/wb/fby/supplies/{supply_id}/draft")
def save_wb_fby_supply_draft(
    supply_id: str,
    body: WbFbyDraftIn,
    x_user_uuid: str | None = Header(default=None),
) -> dict[str, Any]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    payload = _save_wb_fby_supply_draft(user_uuid_val, supply_id, body.items)
    _generate_wb_fby_excel(user_uuid_val, supply_id, payload)
    token = _create_wb_fby_excel_token(user_uuid_val, supply_id)
    download_url = f"/marketplaces/wb/fby/supplies/{urllib.parse.quote(supply_id)}/draft/excel?download_token={token}"
    return {
        "status": "ok",
        "supply_id": supply_id,
        "items": payload["items"],
        "total": len(payload["items"]),
        "download_url": download_url,
    }


@app.post("/wb/fby/supplies/{supply_id}/draft/excel-token")
def create_wb_fby_supply_draft_excel_token(
    supply_id: str,
    x_user_uuid: str | None = Header(default=None),
) -> dict[str, str]:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    user_uuid_val = _user_uuid(x_user_uuid)
    draft = _load_wb_fby_supply_draft(user_uuid_val, supply_id)
    if not draft:
        raise HTTPException(status_code=404, detail="draft not found")
    token = _create_wb_fby_excel_token(user_uuid_val, supply_id)
    return {"download_url": f"/marketplaces/wb/fby/supplies/{urllib.parse.quote(supply_id)}/draft/excel?download_token={token}"}


@app.get("/wb/fby/supplies/{supply_id}/draft/excel")
def download_wb_fby_supply_draft_excel(
    supply_id: str,
    download_token: str = Query(default=""),
    x_user_uuid: str | None = Header(default=None),
) -> FileResponse:
    if not supply_id.strip():
        raise HTTPException(status_code=400, detail="supply_id is required")
    if download_token:
        user_uuid_val, token_supply_id = _consume_wb_fby_excel_token(download_token)
        if token_supply_id != supply_id:
            raise HTTPException(status_code=404, detail="download token expired")
    else:
        user_uuid_val = _user_uuid(x_user_uuid)
    draft = _load_wb_fby_supply_draft(user_uuid_val, supply_id)
    if not draft:
        raise HTTPException(status_code=404, detail="draft not found")
    payload, _ = draft
    path = _generate_wb_fby_excel(user_uuid_val, supply_id, payload)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"wb-fby-{supply_id}.xlsx",
    )


@app.post("/internal/jobs/ozon/promotions/timer-autoupdate")
def run_ozon_promo_timer_autoupdate(x_scheduler_token: str | None = Header(default=None)) -> dict[str, Any]:
    if MARKETPLACES_SCHEDULER_TOKEN and x_scheduler_token != MARKETPLACES_SCHEDULER_TOKEN:
        raise HTTPException(status_code=403, detail="invalid scheduler token")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT user_uuid
            FROM ozon_promo_product_settings
            WHERE auto_update_days_limit_promo = TRUE
            """
        )
        rows = cur.fetchall()
    users = [uuid.UUID(str(r[0])) for r in rows if r and r[0]]
    user_results: list[dict[str, Any]] = []
    for user_uuid_val in users:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT offer_id
                FROM ozon_promo_product_settings
                WHERE user_uuid=%s AND auto_update_days_limit_promo = TRUE
                """,
                (user_uuid_val,),
            )
            offer_rows = cur.fetchall()
        offer_ids = [str(r[0] or "") for r in offer_rows if r and r[0]]
        if not offer_ids:
            continue
        try:
            user_results.append(_run_user_timer_autoupdate(user_uuid_val))
        except HTTPException as e:
            user_results.append(
                {"user_uuid": str(user_uuid_val), "error": str(e.detail), "status_code": int(e.status_code)}
            )
    return {"users_total": len(users), "results": user_results}


@app.post("/ozon/promotions/timer-autoupdate")
def run_ozon_promo_timer_autoupdate_for_user(x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    return _run_user_timer_autoupdate(user_uuid_val)


@app.post("/internal/jobs/ozon/promotions/discount-autoprocess")
def run_ozon_discount_autoprocess(x_scheduler_token: str | None = Header(default=None)) -> dict[str, Any]:
    if MARKETPLACES_SCHEDULER_TOKEN and x_scheduler_token != MARKETPLACES_SCHEDULER_TOKEN:
        raise HTTPException(status_code=403, detail="invalid scheduler token")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT user_uuid
            FROM ozon_promo_product_settings
            WHERE use_discount = TRUE
            """
        )
        rows = cur.fetchall()
    users = [uuid.UUID(str(r[0])) for r in rows if r and r[0]]
    user_results: list[dict[str, Any]] = []
    for user_uuid_val in users:
        try:
            user_results.append(_run_user_discount_autoprocess(user_uuid_val))
        except HTTPException as e:
            user_results.append(
                {"user_uuid": str(user_uuid_val), "error": str(e.detail), "status_code": int(e.status_code)}
            )
    return {"users_total": len(users), "results": user_results}


@app.post("/ozon/promotions/discount-autoprocess")
def run_ozon_discount_autoprocess_for_user(x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    return _run_user_discount_autoprocess(user_uuid_val)


@app.get("/ozon/promotions")
def ozon_promotions(
    x_user_uuid: str | None = Header(default=None),
    percent_color: str | None = Query(default=None),
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    ozon_hdrs = _ozon_headers(user_uuid_val)

    # opt prices from MoySklad: article == offer_id
    ms_opt = _moysklad_opt_prices(user_uuid_val)

    # realization stats for last month from finances cache
    now = datetime.datetime.utcnow()
    _, _, start_date, _ = _month_range_utc_months_ago(now, 1)
    realization = _realization_from_finance_cache(user_uuid_val, 1)

    # prices + commissions
    prices_resp = _ozon_post_json(
        "https://api-seller.ozon.ru/v5/product/info/prices",
        ozon_hdrs,
        {"filter": {"visibility": "ALL"}, "last_id": "", "limit": 1000},
    )
    items = prices_resp.get("items") or []

    settings = _get_ozon_promo_settings(user_uuid_val)

    out_items: list[dict[str, Any]] = []
    for item in items:
        offer_id = str(item.get("offer_id") or "")
        if not offer_id:
            continue
        if offer_id not in ms_opt:
            continue
        opt_price_value = int(ms_opt.get(offer_id) or 0)
        if offer_id not in realization:
            realization[offer_id] = {"sale_qty": 0, "avg_seller_price": 0, "avg_list": []}

        price_block = item.get("price") or {}
        marketing_seller_price = float(price_block.get("marketing_seller_price") or 0)
        price = float(price_block.get("price") or 0)
        min_price = float(price_block.get("min_price") or 0)
        commissions = item.get("commissions") or {}

        acquiring = 2.0
        sales_percent_fbs = float(commissions.get("sales_percent_fbs") or 0)
        fbs_deliv_to_customer_amount = float(commissions.get("fbs_deliv_to_customer_amount") or 0)
        fbs_direct_flow_trans_max_amount = float(commissions.get("fbs_direct_flow_trans_max_amount") or 0)
        fbs_direct_flow_trans_min_amount = float(commissions.get("fbs_direct_flow_trans_min_amount") or 0)
        fbs_first_mile_max_amount = float(commissions.get("fbs_first_mile_max_amount") or 0)

        fbo_deliv_to_customer_amount = float(commissions.get("fbo_deliv_to_customer_amount") or 0)
        fbo_direct_flow_trans_max_amount = float(commissions.get("fbo_direct_flow_trans_max_amount") or 0)
        fbo_direct_flow_trans_min_amount = float(commissions.get("fbo_direct_flow_trans_min_amount") or 0)
        sales_percent_fbo = float(commissions.get("sales_percent_fbo") or 0)

        fbs_direct_flow_trans = (fbs_direct_flow_trans_max_amount + fbs_direct_flow_trans_min_amount) / 2.0
        fbo_direct_flow_trans = (fbo_direct_flow_trans_max_amount + fbo_direct_flow_trans_min_amount) / 2.0
        fbs_first_mile_avg = fbs_first_mile_max_amount

        fbo_delivery_total = (
            marketing_seller_price * (sales_percent_fbo / 100.0)
            + marketing_seller_price * (acquiring / 100.0)
            + fbo_direct_flow_trans
            + fbo_deliv_to_customer_amount
        )
        fbs_delivery_total = (
            marketing_seller_price * (sales_percent_fbs / 100.0)
            + marketing_seller_price * (acquiring / 100.0)
            + fbs_direct_flow_trans
            + fbs_deliv_to_customer_amount
            + fbs_first_mile_avg
        )

        profit_price_fbo = int(marketing_seller_price) - int(fbo_delivery_total) - opt_price_value
        profit_price_fbs = int(marketing_seller_price) - int(fbs_delivery_total) - opt_price_value
        profit_percent_fbo = (profit_price_fbo / opt_price_value * 100.0) if opt_price_value else 0.0
        profit_percent_fbs = (profit_price_fbs / opt_price_value * 100.0) if opt_price_value else 0.0

        color = _profit_color(profit_percent_fbs)
        if percent_color and percent_color in ("green", "yellow", "red") and color != percent_color:
            continue

        # enrich avg_list with delivery/profit like OWM
        avg_list_out: list[dict[str, Any]] = []
        for avg in realization[offer_id].get("avg_list") or []:
            avg_price = float(avg.get("avg_price") or 0)
            avg_fbo_delivery_total = (
                avg_price * (sales_percent_fbo / 100.0)
                + avg_price * (acquiring / 100.0)
                + fbo_direct_flow_trans
                + fbo_deliv_to_customer_amount
            )
            avg_fbs_delivery_total = (
                avg_price * (sales_percent_fbs / 100.0)
                + avg_price * (acquiring / 100.0)
                + fbs_direct_flow_trans
                + fbs_deliv_to_customer_amount
                + fbs_first_mile_avg
            )
            avg_profit_price_fbo = int(avg_price) - int(avg_fbo_delivery_total) - opt_price_value
            avg_profit_price_fbs = int(avg_price) - int(avg_fbs_delivery_total) - opt_price_value
            avg_profit_percent_fbo = (avg_profit_price_fbo / opt_price_value * 100.0) if opt_price_value else 0.0
            avg_profit_percent_fbs = (avg_profit_price_fbs / opt_price_value * 100.0) if opt_price_value else 0.0
            avg_list_out.append(
                {
                    "count": int(avg.get("count") or 0),
                    "avg_price": int(avg_price),
                    "fbo_delivery_total": int(avg_fbo_delivery_total),
                    "fbs_delivery_total": int(avg_fbs_delivery_total),
                    "profit_price_fbo": int(avg_profit_price_fbo),
                    "profit_price_fbs": int(avg_profit_price_fbs),
                    "profit_percent_fbo": int(avg_profit_percent_fbo),
                    "profit_percent_fbs": int(avg_profit_percent_fbs),
                }
            )

        out_items.append(
            {
                "offer_id": offer_id,
                "product_id": int(float(item.get("product_id") or 0)),
                "price": int(price),
                "min_price": int(min_price),
                "marketing_seller_price": int(marketing_seller_price),
                "opt_price": int(opt_price_value),
                "sale_qty": int(realization[offer_id].get("sale_qty") or 0),
                "avg_seller_price": int(realization[offer_id].get("avg_seller_price") or 0),
                "avg_list": avg_list_out,
                "profit_price_fbo": int(profit_price_fbo),
                "profit_price_fbs": int(profit_price_fbs),
                "profit_percent_fbo": int(profit_percent_fbo),
                "profit_percent_fbs": int(profit_percent_fbs),
                "fbs_delivery_total": int(fbs_delivery_total),
                "fbo_delivery_total": int(fbo_delivery_total),
                "acquiring": 2,
                "sales_percent_fbs": sales_percent_fbs,
                "sales_percent_fbo": sales_percent_fbo,
                "fbs_deliv_to_customer_amount": fbs_deliv_to_customer_amount,
                "fbs_direct_flow_trans": fbs_direct_flow_trans,
                "fbs_first_mile_avg": fbs_first_mile_avg,
                "fbo_deliv_to_customer_amount": fbo_deliv_to_customer_amount,
                "fbo_direct_flow_trans": fbo_direct_flow_trans,
                "color": color,
                "settings": settings.get(offer_id) or {},
            }
        )

    out_items.sort(key=lambda x: x.get("offer_id") or "")
    return {"items": out_items, "period": {"year": start_date.year, "month": start_date.month}}


@app.get("/wb/promotions")
def wb_promotions(
    x_user_uuid: str | None = Header(default=None),
    percent_color: str | None = Query(default=None),
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    wb_hdrs = _wb_headers(user_uuid_val)
    ms_opt = _moysklad_opt_prices(user_uuid_val)
    realization = _realization_from_wb_finance_cache(user_uuid_val, 1)
    settings = _get_wb_promo_settings(user_uuid_val)

    out_items: list[dict[str, Any]] = []
    for item in _wb_list_goods(wb_hdrs):
        nm_id = int(item.get("nmID") or 0)
        offer_id = str(item.get("vendorCode") or nm_id).strip()
        if not nm_id or not offer_id:
            continue
        if offer_id not in ms_opt:
            continue
        sizes = item.get("sizes") or []
        first_size = sizes[0] if sizes else {}
        price = int(float(first_size.get("price") or 0))
        discounted_price = int(float(first_size.get("discountedPrice") or 0))
        discount = int(float(item.get("discount") or 0))
        opt_price_value = int(ms_opt.get(offer_id) or 0)
        sale_qty = int((realization.get(offer_id) or {}).get("sale_qty") or 0)
        profit_price = discounted_price - opt_price_value
        profit_percent = (profit_price / opt_price_value * 100.0) if opt_price_value else 0.0
        color = _profit_color(profit_percent)
        if percent_color and percent_color in ("green", "yellow", "red") and color != percent_color:
            continue
        out_items.append(
            {
                "offer_id": offer_id,
                "nm_id": nm_id,
                "price": price,
                "discounted_price": discounted_price,
                "discount": discount,
                "club_discount": int(float(item.get("clubDiscount") or 0)),
                "editable_size_price": bool(item.get("editableSizePrice")),
                "is_bad_turnover": bool(item.get("isBadTurnover")),
                "opt_price": opt_price_value,
                "sale_qty": sale_qty,
                "profit_price": int(profit_price),
                "profit_percent": int(profit_percent),
                "color": color,
                "sizes": sizes,
                "settings": settings.get(str(nm_id)) or {},
            }
        )

    out_items.sort(key=lambda x: str(x.get("offer_id") or ""))
    return {"items": out_items}


@app.get("/ozon/promotions/settings")
def get_ozon_promotions_settings(x_user_uuid: str | None = Header(default=None)) -> dict[str, Any]:
    return _get_ozon_promo_settings(_user_uuid(x_user_uuid))


@app.post("/ozon/promotions/settings")
def save_ozon_promotions_settings(
    body: OzonPromoProductSettingsIn, x_user_uuid: str | None = Header(default=None)
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    offer_id = (body.offer_id or "").strip()
    if body.yourprice > 0 or body.minprice > 0:
        _update_ozon_prices(
            _ozon_headers(user_uuid_val),
            offer_id=offer_id,
            yourprice=body.yourprice,
            minprice=body.minprice,
        )
    _save_ozon_promo_settings(user_uuid_val, body)
    return {"status": "ok"}


@app.post("/wb/promotions/settings")
def save_wb_promotions_settings(
    body: WbPromoProductSettingsIn, x_user_uuid: str | None = Header(default=None)
) -> dict[str, Any]:
    user_uuid_val = _user_uuid(x_user_uuid)
    if body.nm_id <= 0:
        raise HTTPException(status_code=400, detail="nm_id is required")
    result = _wb_update_price_discount(_wb_headers(user_uuid_val), body.nm_id, body.price, body.discount)
    _save_wb_promo_settings(user_uuid_val, body)
    return {"status": "ok", "result": result}


@app.get("/moysklad/settings")
def get_moysklad_settings(x_user_uuid: str | None = Header(default=None)) -> ProviderSettingsIn:
    return _get_provider_settings("moysklad", _user_uuid(x_user_uuid))


@app.post("/moysklad/settings")
def save_moysklad_settings(body: ProviderSettingsIn, x_user_uuid: str | None = Header(default=None)) -> dict[str, str]:
    _save_provider_settings("moysklad", _user_uuid(x_user_uuid), body)
    return {"status": "ok"}

@app.get("/moysklad/organizations")
def list_moysklad_organizations(x_user_uuid: str | None = Header(default=None)) -> list[MsOption]:
    user_uuid_val = _user_uuid(x_user_uuid)
    token = _get_moysklad_token(user_uuid_val)
    data = _moysklad_get(token, "https://api.moysklad.ru/api/remap/1.2/entity/organization/")
    rows = data.get("rows") or []
    return [MsOption(id=str(x.get("id") or ""), name=str(x.get("name") or "")) for x in rows if x.get("id")]


@app.get("/moysklad/agents")
def list_moysklad_agents(x_user_uuid: str | None = Header(default=None)) -> list[MsOption]:
    user_uuid_val = _user_uuid(x_user_uuid)
    token = _get_moysklad_token(user_uuid_val)
    data = _moysklad_get(token, "https://api.moysklad.ru/api/remap/1.2/entity/counterparty/")
    rows = data.get("rows") or []
    return [MsOption(id=str(x.get("id") or ""), name=str(x.get("name") or "")) for x in rows if x.get("id")]

@app.get("/moysklad/storages")
def list_moysklad_storages(x_user_uuid: str | None = Header(default=None)) -> list[MsOption]:
    user_uuid_val = _user_uuid(x_user_uuid)
    token = _get_moysklad_token(user_uuid_val)
    data = _moysklad_get(token, "https://api.moysklad.ru/api/remap/1.2/entity/store")
    rows = data.get("rows") or []
    return [MsOption(id=str(x.get("id") or ""), name=str(x.get("name") or "")) for x in rows if x.get("id")]

@app.get("/moysklad/statuses")
def list_moysklad_statuses(x_user_uuid: str | None = Header(default=None)) -> list[MsOption]:
    user_uuid_val = _user_uuid(x_user_uuid)
    token = _get_moysklad_token(user_uuid_val)
    data = _moysklad_get(token, "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata")
    states = data.get("states") or []
    return [MsOption(id=str(x.get("id") or ""), name=str(x.get("name") or "")) for x in states if x.get("id")]


@app.get("/moysklad/contragents")
def get_moysklad_contragents(x_user_uuid: str | None = Header(default=None)) -> MoyskladContragentsIn:
    return _get_moysklad_contragents(_user_uuid(x_user_uuid))


@app.post("/moysklad/contragents")
def save_moysklad_contragents(
    body: MoyskladContragentsIn, x_user_uuid: str | None = Header(default=None)
) -> dict[str, str]:
    _save_moysklad_contragents(_user_uuid(x_user_uuid), body)
    return {"status": "ok"}

@app.get("/moysklad/storages-settings")
def get_moysklad_storages_settings(x_user_uuid: str | None = Header(default=None)) -> MoyskladStorageIn:
    return _get_moysklad_storage(_user_uuid(x_user_uuid))


@app.post("/moysklad/storages-settings")
def save_moysklad_storages_settings(
    body: MoyskladStorageIn, x_user_uuid: str | None = Header(default=None)
) -> dict[str, str]:
    _save_moysklad_storage(_user_uuid(x_user_uuid), body)
    return {"status": "ok"}


@app.get("/moysklad/statuses-settings")
def get_moysklad_statuses_settings(x_user_uuid: str | None = Header(default=None)) -> MoyskladStatusIn:
    return _get_moysklad_status(_user_uuid(x_user_uuid))


@app.post("/moysklad/statuses-settings")
def save_moysklad_statuses_settings(
    body: MoyskladStatusIn, x_user_uuid: str | None = Header(default=None)
) -> dict[str, str]:
    _save_moysklad_status(_user_uuid(x_user_uuid), body)
    return {"status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


