import os
import base64
import json
import urllib.request
import datetime
import uuid
from collections import defaultdict
from typing import Any

import psycopg
from fastapi import FastAPI
from fastapi import Header, HTTPException, Query
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


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
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


def _ozon_post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = e.read().decode("utf-8")
        except Exception:
            msg = str(e)
        raise HTTPException(status_code=502, detail=f"ozon upstream error: {msg}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="ozon upstream error") from e


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
    tasks = _ozon_list_discount_tasks(ozon_hdrs, ["NEW"], 50)
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
    if months_ago < 1:
        raise HTTPException(status_code=400, detail="months_ago must be >= 1")
    if months_ago > 24:
        raise HTTPException(status_code=400, detail="months_ago too large (max 24)")

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


