import os
import uuid
import json
import ssl
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from typing import Any
import time

import psycopg
from fastapi import FastAPI, HTTPException, Header, Query
from pydantic import BaseModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
MARKETPLACES_BASE_URL = env("MARKETPLACES_BASE_URL", "http://marketplaces:8000")
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


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
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_provider_settings (
              user_uuid UUID PRIMARY KEY,
              provider TEXT NOT NULL DEFAULT 'gigachat',
              model TEXT NOT NULL DEFAULT 'GigaChat',
              base_url TEXT NOT NULL DEFAULT 'https://gigachat.devices.sberbank.ru/api/v1',
              oauth_url TEXT NOT NULL DEFAULT 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
              oauth_scope TEXT NOT NULL DEFAULT 'GIGACHAT_API_PERS',
              basic_auth_b64 TEXT NOT NULL DEFAULT '',
              tls_insecure BOOLEAN NOT NULL DEFAULT FALSE,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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


class GigachatSettingsIn(BaseModel):
    provider: str = "gigachat"
    model: str = "GigaChat"
    base_url: str = "https://gigachat.devices.sberbank.ru/api/v1"
    oauth_url: str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    oauth_scope: str = "GIGACHAT_API_PERS"
    basic_auth_b64: str = ""
    tls_insecure: bool = False


class FinanceInsightOut(BaseModel):
    result: str
    source: str
    months_ago: int


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


def _user_uuid(x_user_uuid: str | None) -> uuid.UUID:
    if not x_user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    try:
        return uuid.UUID(x_user_uuid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid x-user-uuid") from e


def _get_gigachat_settings(user_uuid_val: uuid.UUID) -> GigachatSettingsIn:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT provider, model, base_url, oauth_url, oauth_scope, basic_auth_b64, tls_insecure
            FROM ai_provider_settings
            WHERE user_uuid=%s
            """,
            (user_uuid_val,),
        )
        row = cur.fetchone()
    if not row:
        return GigachatSettingsIn()
    return GigachatSettingsIn(
        provider=str(row[0] or "gigachat"),
        model=str(row[1] or "GigaChat"),
        base_url=str(row[2] or "https://gigachat.devices.sberbank.ru/api/v1"),
        oauth_url=str(row[3] or "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
        oauth_scope=str(row[4] or "GIGACHAT_API_PERS"),
        basic_auth_b64=str(row[5] or ""),
        tls_insecure=bool(row[6]),
    )


def _save_gigachat_settings(user_uuid_val: uuid.UUID, body: GigachatSettingsIn) -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ai_provider_settings (
              user_uuid, provider, model, base_url, oauth_url, oauth_scope, basic_auth_b64, tls_insecure, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (user_uuid) DO UPDATE SET
              provider=EXCLUDED.provider,
              model=EXCLUDED.model,
              base_url=EXCLUDED.base_url,
              oauth_url=EXCLUDED.oauth_url,
              oauth_scope=EXCLUDED.oauth_scope,
              basic_auth_b64=EXCLUDED.basic_auth_b64,
              tls_insecure=EXCLUDED.tls_insecure,
              updated_at=NOW()
            """,
            (
                user_uuid_val,
                body.provider,
                body.model,
                body.base_url,
                body.oauth_url,
                body.oauth_scope,
                body.basic_auth_b64,
                bool(body.tls_insecure),
            ),
        )


def _urlopen(req: urllib.request.Request, timeout_sec: int = 60, tls_insecure: bool = False):
    if tls_insecure:
        ctx = ssl._create_unverified_context()
        return urllib.request.urlopen(req, timeout=timeout_sec, context=ctx)
    return urllib.request.urlopen(req, timeout=timeout_sec)


def _gigachat_get_token(settings: GigachatSettingsIn) -> str:
    if not settings.basic_auth_b64.strip():
        raise HTTPException(status_code=400, detail="gigachat basic_auth_b64 is empty")
    body = urllib.parse.urlencode(
        {"scope": settings.oauth_scope or "GIGACHAT_API_PERS", "grant_type": "client_credentials"}
    ).encode("utf-8")
    req = urllib.request.Request(settings.oauth_url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    req.add_header("Authorization", f"Basic {settings.basic_auth_b64.strip()}")
    req.add_header("RqUID", str(uuid.uuid4()))
    try:
        with _urlopen(req, timeout_sec=30, tls_insecure=settings.tls_insecure) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            raw = ""
        raise HTTPException(status_code=502, detail=f"gigachat oauth http {getattr(e, 'code', '?')}: {raw}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"gigachat oauth error: {str(e)}") from e
    try:
        token = str((json.loads(raw) or {}).get("access_token") or "").strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail="gigachat oauth invalid json") from e
    if not token:
        raise HTTPException(status_code=502, detail="gigachat oauth no access_token")
    return token


def _gigachat_chat(settings: GigachatSettingsIn, prompt: str) -> str:
    token = _gigachat_get_token(settings)
    base = (settings.base_url or "").rstrip("/")
    url = f"{base}/chat/completions" if not base.endswith("/chat/completions") else base
    payload = {
        "model": settings.model or "GigaChat",
        "messages": [{"role": "system", "content": "Ты аналитик маркетплейсов."}, {"role": "user", "content": prompt}],
        "temperature": 0.1,
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with _urlopen(req, timeout_sec=90, tls_insecure=settings.tls_insecure) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            raw = ""
        raise HTTPException(status_code=502, detail=f"gigachat chat http {getattr(e, 'code', '?')}: {raw}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"gigachat chat error: {str(e)}") from e
    try:
        data = json.loads(raw)
        return str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
    except Exception as e:
        raise HTTPException(status_code=502, detail="gigachat chat invalid json") from e


def _get_finances_from_marketplaces(user_uuid_val: uuid.UUID, months_ago: int) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{MARKETPLACES_BASE_URL}/ozon/finances?months_ago={months_ago}&mode=cache",
        method="GET",
        headers={"x-user-uuid": str(user_uuid_val), "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            raw = ""
        raise HTTPException(status_code=502, detail=f"marketplaces finances error: {raw}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"marketplaces finances unavailable: {str(e)}") from e
    try:
        return json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=502, detail="marketplaces finances invalid json") from e


def _load_prompt_template(file_name: str) -> str:
    path = PROMPTS_DIR / file_name
    try:
        text = path.read_text(encoding="utf-8").strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"prompt file missing: {file_name}") from e
    if not text:
        raise HTTPException(status_code=500, detail=f"prompt file empty: {file_name}")
    return text


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


@app.get("/settings/gigachat", response_model=GigachatSettingsIn)
def get_gigachat_settings(x_user_uuid: str | None = Header(default=None)) -> GigachatSettingsIn:
    return _get_gigachat_settings(_user_uuid(x_user_uuid))


@app.post("/settings/gigachat")
def save_gigachat_settings(body: GigachatSettingsIn, x_user_uuid: str | None = Header(default=None)) -> dict[str, str]:
    _save_gigachat_settings(_user_uuid(x_user_uuid), body)
    return {"status": "ok"}


@app.post("/insights/ozon-finances", response_model=FinanceInsightOut)
def analyze_ozon_finances(
    x_user_uuid: str | None = Header(default=None),
    months_ago: int = Query(default=1, ge=1, le=24),
) -> FinanceInsightOut:
    user_uuid_val = _user_uuid(x_user_uuid)
    settings = _get_gigachat_settings(user_uuid_val)
    finances = _get_finances_from_marketplaces(user_uuid_val, months_ago)
    data_json = json.dumps(finances, ensure_ascii=False)
    step1_template = _load_prompt_template("ozon_finances_step1.txt")
    step2_template = _load_prompt_template("ozon_finances_step2.txt")
    step1_prompt = step1_template.format(data_json=data_json, months_ago=months_ago)
    step1_result = _gigachat_chat(settings, step1_prompt).strip()
    if not step1_result:
        raise HTTPException(status_code=502, detail="empty ai response on step1")
    step2_prompt = step2_template.format(data_json=data_json, step1_result=step1_result, months_ago=months_ago)
    step2_result = _gigachat_chat(settings, step2_prompt).strip()
    if not step2_result:
        raise HTTPException(status_code=502, detail="empty ai response on step2")
    return FinanceInsightOut(result=step2_result, source="gigachat", months_ago=months_ago)


