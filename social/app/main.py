import os
import time
from urllib.parse import urlencode, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen
import json
import random

import psycopg2
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing env var: {name}")
    return value


DATABASE_URL = env("DATABASE_URL")
ADMIN_ROLES = {"superadmin", "admin"}

MANIFEST = {
    "name": "social",
    "bounded_context": "social",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Соцсети",
            "items": [
                {"id": "settings", "title": "Настройки"},
                {"id": "vk", "title": "Вконтакте"},
            ],
        }
    },
    "api": {"base_url": "http://social:8000"},
}


class VkSettingsIn(BaseModel):
    name: str = Field(default="", max_length=120)
    api_base_url: str = Field(default="", max_length=255)
    api_token: str = Field(default="", max_length=512)
    api_version: str = Field(default="5.199", max_length=20)
    longpoll_wait: int = Field(default=25, ge=1, le=90)
    group_id: str = Field(default="", max_length=120)
    confirmation_code: str = Field(default="", max_length=120)
    callback_secret: str = Field(default="", max_length=255)
    enabled: bool = False


class VkSettingsOut(VkSettingsIn):
    id: int
    is_default: bool = False
    updated_at: str


class VkSettingsSelectOut(BaseModel):
    id: int
    name: str = ""
    resolved_name: str = ""
    group_id: str = ""
    enabled: bool = False
    is_default: bool = False


class VkConnectionOut(BaseModel):
    connected: bool
    message: str = ""


class VkLongPollSessionOut(BaseModel):
    connected: bool
    message: str = ""
    server: str = ""
    key: str = ""
    ts: str = ""
    wait: int = 25
    updates_count: int = 0


class VkMessageOut(BaseModel):
    event_type: str
    event_id: str
    text: str = ""
    from_id: str = ""
    sender_name: str = ""
    is_outgoing: bool = False
    peer_id: str = ""
    created_at: int = 0
    attachments: list[dict] = []


class VkMessagesOut(BaseModel):
    connected: bool
    message: str = ""
    ts: str = ""
    updates_count: int = 0
    messages: list[VkMessageOut] = []


class VkConversationOut(BaseModel):
    peer_id: str
    last_message_text: str = ""
    last_from_id: str = ""
    last_from_name: str = ""
    last_message_ts: int = 0
    messages_count: int = 0


class VkReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class VkReplyOut(BaseModel):
    ok: bool
    vk_message_id: int | None = None
    message: str = ""


def db():
    return psycopg2.connect(DATABASE_URL)


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


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS social_vk_settings (
              singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
              api_base_url TEXT NOT NULL DEFAULT '',
              api_token TEXT NOT NULL DEFAULT '',
              api_version TEXT NOT NULL DEFAULT '5.199',
              longpoll_wait INTEGER NOT NULL DEFAULT 25,
              group_id TEXT NOT NULL DEFAULT '',
              confirmation_code TEXT NOT NULL DEFAULT '',
              callback_secret TEXT NOT NULL DEFAULT '',
              longpoll_server TEXT NOT NULL DEFAULT '',
              longpoll_key TEXT NOT NULL DEFAULT '',
              longpoll_ts TEXT NOT NULL DEFAULT '',
              enabled BOOLEAN NOT NULL DEFAULT FALSE,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS social_vk_conversations (
              peer_id TEXT PRIMARY KEY,
              last_message_text TEXT NOT NULL DEFAULT '',
              last_from_id TEXT NOT NULL DEFAULT '',
              last_message_ts BIGINT NOT NULL DEFAULT 0,
              messages_count INTEGER NOT NULL DEFAULT 0,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS social_vk_messages (
              id BIGSERIAL PRIMARY KEY,
              event_id TEXT NOT NULL UNIQUE,
              peer_id TEXT NOT NULL,
              from_id TEXT NOT NULL DEFAULT '',
              text TEXT NOT NULL DEFAULT '',
              message_ts BIGINT NOT NULL DEFAULT 0,
              raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS social_vk_group_settings (
              id BIGSERIAL PRIMARY KEY,
              name TEXT NOT NULL DEFAULT '',
              api_base_url TEXT NOT NULL DEFAULT '',
              api_token TEXT NOT NULL DEFAULT '',
              api_version TEXT NOT NULL DEFAULT '5.199',
              longpoll_wait INTEGER NOT NULL DEFAULT 25,
              group_id TEXT NOT NULL DEFAULT '',
              confirmation_code TEXT NOT NULL DEFAULT '',
              callback_secret TEXT NOT NULL DEFAULT '',
              longpoll_server TEXT NOT NULL DEFAULT '',
              longpoll_key TEXT NOT NULL DEFAULT '',
              longpoll_ts TEXT NOT NULL DEFAULT '',
              enabled BOOLEAN NOT NULL DEFAULT FALSE,
              is_default BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_social_vk_group_settings_default_true
            ON social_vk_group_settings (is_default)
            WHERE is_default = TRUE;
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_social_vk_group_settings_group_id
            ON social_vk_group_settings (group_id)
            WHERE group_id <> '';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_messages
            ADD COLUMN IF NOT EXISTS vk_group_id TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            DROP INDEX IF EXISTS uq_social_vk_messages_group_event;
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_messages
            DROP CONSTRAINT IF EXISTS social_vk_messages_event_id_key;
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_social_vk_messages_group_event
            ON social_vk_messages(vk_group_id, event_id);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_social_vk_messages_group_peer_ts
            ON social_vk_messages(vk_group_id, peer_id, message_ts DESC, id DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_social_vk_messages_peer_ts
            ON social_vk_messages(peer_id, message_ts DESC, id DESC);
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS api_base_url TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS api_token TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS api_version TEXT NOT NULL DEFAULT '5.199';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS longpoll_wait INTEGER NOT NULL DEFAULT 25;
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS confirmation_code TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS longpoll_server TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS longpoll_key TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            ALTER TABLE social_vk_settings
            ADD COLUMN IF NOT EXISTS longpoll_ts TEXT NOT NULL DEFAULT '';
            """
        )
        cur.execute(
            """
            INSERT INTO social_vk_settings (
              singleton, api_base_url, api_token, api_version, longpoll_wait,
              group_id, callback_secret, enabled
            )
            VALUES (TRUE, '', '', '5.199', 25, '', '', FALSE)
            ON CONFLICT (singleton) DO NOTHING;
            """
        )
        cur.execute(
            """
            INSERT INTO social_vk_group_settings (
              name, api_base_url, api_token, api_version, longpoll_wait,
              group_id, confirmation_code, callback_secret, longpoll_server, longpoll_key, longpoll_ts,
              enabled, is_default, created_at, updated_at
            )
            SELECT
              CASE WHEN s.group_id <> '' THEN ('VK #' || s.group_id) ELSE 'VK Group' END,
              s.api_base_url, s.api_token, s.api_version, s.longpoll_wait,
              s.group_id, s.confirmation_code, s.callback_secret, s.longpoll_server, s.longpoll_key, s.longpoll_ts,
              s.enabled, TRUE, NOW(), s.updated_at
            FROM social_vk_settings s
            WHERE NOT EXISTS (SELECT 1 FROM social_vk_group_settings);
            """
        )
        cur.execute(
            """
            WITH picked AS (
              SELECT id
              FROM social_vk_group_settings
              ORDER BY is_default DESC, updated_at DESC, id ASC
              LIMIT 1
            )
            UPDATE social_vk_group_settings g
            SET is_default = (g.id = p.id)
            FROM picked p;
            """
        )


app = FastAPI(title="social", version="1.0.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("social-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "social"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "social", "bounded_context": "social", "status": "running"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


def _row_to_vk_settings_out(row: tuple) -> VkSettingsOut:
    return VkSettingsOut(
        id=int(row[0]),
        name=str(row[1] or ""),
        api_base_url=row[2],
        api_token=row[3],
        api_version=row[4],
        longpoll_wait=int(row[5] or 25),
        group_id=row[6],
        confirmation_code=row[7],
        callback_secret=row[8],
        enabled=bool(row[9]),
        is_default=bool(row[10]),
        updated_at=row[11].isoformat(),
    )


def _load_vk_group_row(settings_id: int | None = None) -> tuple:
    with db() as conn, conn.cursor() as cur:
        if settings_id is not None:
            cur.execute(
                """
                SELECT
                  id, name, api_base_url, api_token, api_version, longpoll_wait,
                  group_id, confirmation_code, callback_secret, enabled, is_default, updated_at
                FROM social_vk_group_settings
                WHERE id = %s
                """,
                (int(settings_id),),
            )
        else:
            cur.execute(
                """
                SELECT
                  id, name, api_base_url, api_token, api_version, longpoll_wait,
                  group_id, confirmation_code, callback_secret, enabled, is_default, updated_at
                FROM social_vk_group_settings
                ORDER BY is_default DESC, updated_at DESC, id ASC
                LIMIT 1
                """
            )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="vk settings not found")
    return row


@app.get("/settings/vk", response_model=VkSettingsOut)
def get_vk_settings(request: Request, settings_id: int | None = None) -> VkSettingsOut:
    require_user_uuid(request)
    row = _load_vk_group_row(settings_id=settings_id)
    return _row_to_vk_settings_out(row)


@app.put("/settings/vk", response_model=VkSettingsOut)
def update_vk_settings(body: VkSettingsIn, request: Request, settings_id: int | None = None) -> VkSettingsOut:
    require_admin(request)
    target = _load_vk_group_row(settings_id=settings_id)
    target_id = int(target[0])
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE social_vk_group_settings
                SET
                  name=%s,
                  api_base_url=%s,
                  api_token=%s,
                  api_version=%s,
                  longpoll_wait=%s,
                  group_id=%s,
                  confirmation_code=%s,
                  callback_secret=%s,
                  enabled=%s,
                  updated_at=NOW()
                WHERE id = %s
                RETURNING
                  id, name, api_base_url, api_token, api_version, longpoll_wait,
                  group_id, confirmation_code, callback_secret, enabled, is_default, updated_at
                """,
                (
                    body.name.strip(),
                    body.api_base_url.strip(),
                    body.api_token.strip(),
                    body.api_version.strip() or "5.199",
                    int(body.longpoll_wait),
                    body.group_id.strip(),
                    body.confirmation_code.strip(),
                    body.callback_secret.strip(),
                    body.enabled,
                    target_id,
                ),
            )
            row = cur.fetchone()
    except psycopg2.Error as exc:
        if "uq_social_vk_group_settings_group_id" in str(exc):
            raise HTTPException(status_code=409, detail="group_id already exists") from exc
        raise
    return _row_to_vk_settings_out(row)


@app.get("/settings/vk/groups", response_model=list[VkSettingsSelectOut])
def list_vk_groups(request: Request) -> list[VkSettingsSelectOut]:
    require_user_uuid(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, group_id, enabled, is_default, api_token, api_version
            FROM social_vk_group_settings
            ORDER BY is_default DESC, updated_at DESC, id ASC
            """
        )
        rows = cur.fetchall()
    return [
        VkSettingsSelectOut(
            id=int(row[0]),
            name=str(row[1] or ""),
            resolved_name=_resolve_vk_group_title(
                token=str(row[5] or "").strip(),
                version=str(row[6] or "5.199"),
                group_id=str(row[2] or "").strip(),
            ),
            group_id=str(row[2] or ""),
            enabled=bool(row[3]),
            is_default=bool(row[4]),
        )
        for row in rows
    ]


@app.post("/settings/vk/groups", response_model=VkSettingsOut)
def create_vk_group(body: VkSettingsIn, request: Request) -> VkSettingsOut:
    require_admin(request)
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM social_vk_group_settings")
            count = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(
                """
                INSERT INTO social_vk_group_settings (
                  name, api_base_url, api_token, api_version, longpoll_wait,
                  group_id, confirmation_code, callback_secret, enabled, is_default
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING
                  id, name, api_base_url, api_token, api_version, longpoll_wait,
                  group_id, confirmation_code, callback_secret, enabled, is_default, updated_at
                """,
                (
                    body.name.strip() or "VK Group",
                    body.api_base_url.strip(),
                    body.api_token.strip(),
                    body.api_version.strip() or "5.199",
                    int(body.longpoll_wait),
                    body.group_id.strip(),
                    body.confirmation_code.strip(),
                    body.callback_secret.strip(),
                    body.enabled,
                    count == 0,
                ),
            )
            row = cur.fetchone()
    except psycopg2.Error as exc:
        if "uq_social_vk_group_settings_group_id" in str(exc):
            raise HTTPException(status_code=409, detail="group_id already exists") from exc
        raise
    return _row_to_vk_settings_out(row)


@app.post("/settings/vk/groups/{settings_id}/default", response_model=VkSettingsOut)
def set_default_vk_group(settings_id: int, request: Request) -> VkSettingsOut:
    require_admin(request)
    _load_vk_group_row(settings_id=settings_id)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE social_vk_group_settings
            SET is_default = (id = %s), updated_at = NOW()
            """,
            (int(settings_id),),
        )
    return _row_to_vk_settings_out(_load_vk_group_row(settings_id=settings_id))


@app.delete("/settings/vk/groups/{settings_id}")
def delete_vk_group(settings_id: int, request: Request) -> dict[str, bool]:
    require_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM social_vk_group_settings")
        total = int((cur.fetchone() or [0])[0] or 0)
        if total <= 1:
            raise HTTPException(status_code=400, detail="at least one vk group required")
        cur.execute("SELECT id, is_default FROM social_vk_group_settings WHERE id=%s", (int(settings_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="vk settings not found")
        cur.execute("DELETE FROM social_vk_group_settings WHERE id=%s", (int(settings_id),))
        if bool(row[1]):
            cur.execute(
                """
                UPDATE social_vk_group_settings
                SET is_default = (id = (
                  SELECT id FROM social_vk_group_settings ORDER BY updated_at DESC, id ASC LIMIT 1
                ))
                """
            )
    return {"ok": True}


@app.get("/settings/vk/connection", response_model=VkConnectionOut)
def check_vk_connection(request: Request, settings_id: int | None = None) -> VkConnectionOut:
    require_user_uuid(request)
    row = _load_vk_group_row(settings_id=settings_id)
    api_base_url = str(row[2] or "").strip()
    if not api_base_url:
        return VkConnectionOut(connected=False, message="api_base_url is empty")
    parsed = urlparse(api_base_url)
    if parsed.scheme not in {"http", "https"}:
        return VkConnectionOut(connected=False, message="api_base_url must start with http:// or https://")
    try:
        req = UrlRequest(api_base_url, method="GET")
        with urlopen(req, timeout=7) as resp:
            status_code = int(getattr(resp, "status", 200))
        return VkConnectionOut(connected=True, message=f"http {status_code}")
    except HTTPError as exc:
        return VkConnectionOut(connected=True, message=f"http {exc.code}")
    except URLError as exc:
        return VkConnectionOut(connected=False, message=f"network error: {exc.reason}")
    except Exception as exc:
        return VkConnectionOut(connected=False, message=f"connection failed: {exc}")


def _load_vk_lp_row(settings_id: int | None = None) -> tuple:
    with db() as conn, conn.cursor() as cur:
        if settings_id is not None:
            cur.execute(
                """
                SELECT
                  id, api_token, api_version, longpoll_wait, group_id,
                  longpoll_server, longpoll_key, longpoll_ts
                FROM social_vk_group_settings
                WHERE id = %s
                """,
                (int(settings_id),),
            )
        else:
            cur.execute(
                """
                SELECT
                  id, api_token, api_version, longpoll_wait, group_id,
                  longpoll_server, longpoll_key, longpoll_ts
                FROM social_vk_group_settings
                ORDER BY is_default DESC, updated_at DESC, id ASC
                LIMIT 1
                """
            )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="vk settings not found")
    return row


def _vk_api_call(method: str, token: str, version: str, params: dict) -> dict:
    query = {
        **params,
        "access_token": token,
        "v": version or "5.199",
    }
    url = f"https://api.vk.com/method/{method}?{urlencode(query)}"
    req = UrlRequest(url, method="GET")
    with urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8") or "{}")
    if "error" in payload:
        error = payload.get("error") or {}
        code = error.get("error_code")
        msg = error.get("error_msg") or "vk api error"
        raise HTTPException(status_code=502, detail=f"vk error {code}: {msg}")
    return payload.get("response") or {}


def _bootstrap_longpoll_for_row(settings_row: tuple) -> tuple[str, str, str]:
    settings_id_value, api_token, api_version, _, group_id, _, _, _ = settings_row
    token = str(api_token or "").strip()
    gid = str(group_id or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="api_token is empty")
    if not gid.isdigit():
        raise HTTPException(status_code=400, detail="group_id must be numeric")
    response = _vk_api_call(
        method="groups.getLongPollServer",
        token=token,
        version=str(api_version or "5.199"),
        params={"group_id": int(gid)},
    )
    server = str(response.get("server") or "").strip()
    key = str(response.get("key") or "").strip()
    ts = str(response.get("ts") or "").strip()
    if not (server and key and ts):
        raise HTTPException(status_code=502, detail="vk longpoll response is incomplete")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE social_vk_group_settings
            SET longpoll_server=%s, longpoll_key=%s, longpoll_ts=%s, updated_at=NOW()
            WHERE id = %s
            """,
            (server, key, ts, int(settings_id_value)),
        )
    return server, key, ts


def _normalize_vk_message_event(item: dict) -> VkMessageOut | None:
    if not isinstance(item, dict):
        return None
    event_type = str(item.get("type") or "").strip()
    if event_type != "message_new":
        return None
    event_id = str(item.get("event_id") or "").strip()
    obj = item.get("object") or {}
    msg_obj = obj.get("message") if isinstance(obj, dict) else {}
    if not isinstance(msg_obj, dict):
        msg_obj = {}
    text = str(msg_obj.get("text") or "").strip()
    if not text:
        attachments = msg_obj.get("attachments") if isinstance(msg_obj, dict) else []
        if isinstance(attachments, list) and attachments:
            types = []
            for a in attachments[:3]:
                t = str((a or {}).get("type") or "").strip()
                if t:
                    types.append(t)
            text = f"[Вложения: {', '.join(types)}]" if types else "[Вложение]"
    from_id = str(msg_obj.get("from_id") or "").strip()
    peer_id = str(msg_obj.get("peer_id") or "").strip()
    try:
        created_at = int(msg_obj.get("date") or 0)
    except Exception:
        created_at = 0
    if not peer_id:
        return None
    if not event_id:
        conv_msg_id = str(msg_obj.get("conversation_message_id") or "").strip()
        event_id = f"{peer_id}:{created_at}:{conv_msg_id}"
    return VkMessageOut(
        event_type=event_type,
        event_id=event_id,
        text=text,
        from_id=from_id,
        peer_id=peer_id,
        created_at=created_at,
    )


def _encode_conv_peer(group_id: str, peer_id: str) -> str:
    return f"{str(group_id).strip()}:{str(peer_id).strip()}"


def _decode_conv_peer(encoded_peer: str) -> str:
    value = str(encoded_peer or "").strip()
    if ":" not in value:
        return value
    return value.split(":", 1)[1]


def _persist_vk_messages(updates: list[dict], group_id: str) -> list[VkMessageOut]:
    stored: list[VkMessageOut] = []
    gid = str(group_id or "").strip()
    with db() as conn, conn.cursor() as cur:
        for item in updates:
            normalized = _normalize_vk_message_event(item)
            if normalized is None:
                continue
            conv_peer_id = _encode_conv_peer(gid, normalized.peer_id)
            cur.execute(
                """
                INSERT INTO social_vk_messages (vk_group_id, event_id, peer_id, from_id, text, message_ts, raw_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (vk_group_id, event_id) DO NOTHING
                """,
                (
                    gid,
                    normalized.event_id,
                    normalized.peer_id,
                    normalized.from_id,
                    normalized.text,
                    int(normalized.created_at or 0),
                    json.dumps(item, ensure_ascii=False),
                ),
            )
            if cur.rowcount == 0:
                continue
            cur.execute(
                """
                INSERT INTO social_vk_conversations (peer_id, last_message_text, last_from_id, last_message_ts, messages_count, updated_at)
                VALUES (%s, %s, %s, %s, 1, NOW())
                ON CONFLICT (peer_id) DO UPDATE
                SET
                  last_message_text = CASE
                    WHEN EXCLUDED.last_message_ts >= social_vk_conversations.last_message_ts
                    THEN EXCLUDED.last_message_text
                    ELSE social_vk_conversations.last_message_text
                  END,
                  last_from_id = CASE
                    WHEN EXCLUDED.last_message_ts >= social_vk_conversations.last_message_ts
                    THEN EXCLUDED.last_from_id
                    ELSE social_vk_conversations.last_from_id
                  END,
                  last_message_ts = GREATEST(social_vk_conversations.last_message_ts, EXCLUDED.last_message_ts),
                  messages_count = social_vk_conversations.messages_count + 1,
                  updated_at = NOW()
                """,
                (
                    conv_peer_id,
                    normalized.text,
                    normalized.from_id,
                    int(normalized.created_at or 0),
                ),
            )
            stored.append(normalized)
    return stored


def _poll_longpoll_updates(wait_seconds: int, settings_id: int | None = None) -> tuple[bool, str, str, list[dict]]:
    lp_row = _load_vk_lp_row(settings_id=settings_id)
    settings_id_value, _, _, _, _, server, key, ts = lp_row
    server = str(server or "").strip()
    key = str(key or "").strip()
    ts = str(ts or "").strip()
    if not (server and key and ts):
        try:
            server, key, ts = _bootstrap_longpoll_for_row(lp_row)
        except Exception as exc:
            return False, f"longpoll is not initialized: {exc}", ts, []
    safe_wait = max(1, min(int(wait_seconds), 90))
    payload: dict = {}
    for attempt in range(2):
        check_url = f"{server}?{urlencode({'act': 'a_check', 'key': key, 'ts': ts, 'wait': safe_wait})}"
        try:
            req = UrlRequest(check_url, method="GET")
            with urlopen(req, timeout=safe_wait + 12) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
        except Exception as exc:
            return False, f"longpoll request failed: {exc}", ts, []

        failed = int(payload.get("failed") or 0)
        if failed == 0:
            break
        if failed == 1:
            ts = str(payload.get("ts") or ts).strip()
            continue
        if failed in (2, 3):
            if attempt == 0:
                try:
                    server, key, ts = _bootstrap_longpoll_for_row(lp_row)
                    continue
                except Exception as exc:
                    return False, f"vk longpoll failed={failed}: {exc}", ts, []
            return False, f"vk longpoll failed={failed}", ts, []
        return False, f"vk longpoll failed={failed}", ts, []

    new_ts = str(payload.get("ts") or ts).strip()
    updates = payload.get("updates") or []
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE social_vk_group_settings
            SET longpoll_ts=%s, updated_at=NOW()
            WHERE id = %s
            """,
            (new_ts, int(settings_id_value)),
        )
    return True, "ok", new_ts, updates


def _extract_attachments_from_raw(raw_json: dict) -> list[dict]:
    obj = (raw_json or {}).get("object") or {}
    msg = obj.get("message") if isinstance(obj, dict) else {}
    if not isinstance(msg, dict):
        msg = {}
    raw_attachments = msg.get("attachments") or []
    if not isinstance(raw_attachments, list):
        return []
    out: list[dict] = []
    for att in raw_attachments:
        if not isinstance(att, dict):
            continue
        att_type = str(att.get("type") or "").strip()
        if not att_type:
            continue
        title = ""
        url = ""
        payload = att.get(att_type) if isinstance(att.get(att_type), dict) else {}
        if att_type == "photo":
            sizes = payload.get("sizes") if isinstance(payload, dict) else []
            if isinstance(sizes, list) and sizes:
                best = max((s for s in sizes if isinstance(s, dict)), key=lambda s: int(s.get("width") or 0), default={})
                url = str(best.get("url") or "").strip()
            title = "Фото"
        elif att_type == "doc":
            url = str((payload or {}).get("url") or "").strip()
            title = str((payload or {}).get("title") or "Документ").strip()
        elif att_type == "audio_message":
            url = str((payload or {}).get("link_ogg") or (payload or {}).get("link_mp3") or "").strip()
            title = "Голосовое сообщение"
        else:
            title = att_type
        out.append({"type": att_type, "title": title or att_type, "url": url})
    return out


def _resolve_sender_names(from_ids: list[str], token: str, version: str, own_group_id: str) -> dict[str, str]:
    result: dict[str, str] = {}
    unique_ids = []
    seen: set[str] = set()
    for raw in from_ids:
        fid = str(raw or "").strip()
        if not fid or fid in seen:
            continue
        seen.add(fid)
        unique_ids.append(fid)

    own_group_marker = f"-{str(own_group_id or '').strip()}"
    for fid in unique_ids:
        if own_group_marker and fid == own_group_marker:
            result[fid] = "Мы"

    user_ids: list[str] = []
    group_ids: list[str] = []
    for fid in unique_ids:
        if fid in result:
            continue
        if fid.startswith("-") and fid[1:].isdigit():
            group_ids.append(fid[1:])
        elif fid.isdigit():
            user_ids.append(fid)
        else:
            result[fid] = fid

    if user_ids:
        try:
            users = _vk_api_call(
                method="users.get",
                token=token,
                version=version,
                params={"user_ids": ",".join(user_ids)},
            )
            if isinstance(users, list):
                for item in users:
                    uid = str((item or {}).get("id") or "").strip()
                    if not uid:
                        continue
                    first_name = str((item or {}).get("first_name") or "").strip()
                    last_name = str((item or {}).get("last_name") or "").strip()
                    full_name = " ".join(part for part in [first_name, last_name] if part).strip() or uid
                    result[uid] = full_name
        except Exception:
            for uid in user_ids:
                result.setdefault(uid, uid)

    if group_ids:
        try:
            groups = _vk_api_call(
                method="groups.getById",
                token=token,
                version=version,
                params={"group_ids": ",".join(group_ids)},
            )
            if isinstance(groups, list):
                for item in groups:
                    gid = str((item or {}).get("id") or "").strip()
                    name = str((item or {}).get("name") or "").strip()
                    if gid:
                        result[f"-{gid}"] = name or f"Сообщество {gid}"
        except Exception:
            for gid in group_ids:
                result.setdefault(f"-{gid}", f"Сообщество {gid}")

    return result


def _resolve_vk_group_title(token: str, version: str, group_id: str) -> str:
    gid = str(group_id or "").strip()
    if not (token and gid.isdigit()):
        return ""
    try:
        groups = _vk_api_call(
            method="groups.getById",
            token=str(token or "").strip(),
            version=str(version or "5.199"),
            params={"group_id": int(gid)},
        )
        if isinstance(groups, list) and groups:
            return str((groups[0] or {}).get("name") or "").strip()
    except Exception:
        return ""
    return ""


@app.post("/settings/vk/longpoll/bootstrap", response_model=VkLongPollSessionOut)
def bootstrap_vk_longpoll(request: Request, settings_id: int | None = None) -> VkLongPollSessionOut:
    require_admin(request)
    settings_row = _load_vk_lp_row(settings_id=settings_id)
    _, _, _, longpoll_wait, _, _, _, _ = settings_row
    try:
        server, key, ts = _bootstrap_longpoll_for_row(settings_row)
    except HTTPException as exc:
        return VkLongPollSessionOut(connected=False, message=str(exc.detail), wait=int(longpoll_wait or 25))
    except Exception as exc:
        return VkLongPollSessionOut(connected=False, message=str(exc), wait=int(longpoll_wait or 25))
    return VkLongPollSessionOut(
        connected=True,
        message="longpoll session initialized",
        server=server,
        key=key,
        ts=ts,
        wait=int(longpoll_wait or 25),
    )


@app.get("/settings/vk/longpoll/check", response_model=VkLongPollSessionOut)
def check_vk_longpoll(request: Request, settings_id: int | None = None) -> VkLongPollSessionOut:
    require_user_uuid(request)
    settings_row = _load_vk_lp_row(settings_id=settings_id)
    _, _, longpoll_wait, group_id, server, key, _ = settings_row[1:]
    wait = int(longpoll_wait or 25)
    connected, message, new_ts, updates = _poll_longpoll_updates(wait_seconds=1, settings_id=settings_id)
    if not connected:
        return VkLongPollSessionOut(connected=False, message=message, wait=wait)
    _persist_vk_messages(updates, group_id=str(group_id or "").strip())
    return VkLongPollSessionOut(
        connected=True,
        message="longpoll ok",
        server=server,
        key=key,
        ts=new_ts,
        wait=wait,
        updates_count=len(updates),
    )


@app.get("/settings/vk/longpoll/messages", response_model=VkMessagesOut)
def get_vk_longpoll_messages(
    request: Request, limit: int = 30, settings_id: int | None = None
) -> VkMessagesOut:
    require_user_uuid(request)
    safe_limit = max(1, min(int(limit), 100))
    settings_row = _load_vk_lp_row(settings_id=settings_id)
    _, api_token, api_version, _, group_id, _, _, _ = settings_row
    gid = str(group_id or "").strip()
    connected, message, new_ts, updates = _poll_longpoll_updates(wait_seconds=1, settings_id=settings_id)
    if not connected:
        return VkMessagesOut(connected=False, message=message, ts=new_ts)
    _persist_vk_messages(updates, group_id=gid)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT event_id, peer_id, from_id, text, message_ts
            FROM social_vk_messages
            WHERE vk_group_id = %s
            ORDER BY message_ts DESC, id DESC
            LIMIT %s
            """,
            (gid, safe_limit),
        )
        rows = cur.fetchall()
    messages = [
        VkMessageOut(
            event_type="message_new",
            event_id=str(row[0]),
            peer_id=str(row[1]),
            from_id=str(row[2]),
            text=str(row[3] or ""),
            created_at=int(row[4] or 0),
        )
        for row in rows
    ]
    sender_map = _resolve_sender_names(
        [item.from_id for item in messages],
        token=str(api_token or "").strip(),
        version=str(api_version or "5.199"),
        own_group_id=str(group_id or "").strip(),
    )
    own_group_marker = f"-{str(group_id or '').strip()}"
    for item in messages:
        item.sender_name = sender_map.get(item.from_id, item.from_id)
        item.is_outgoing = bool(own_group_marker and item.from_id == own_group_marker)
    return VkMessagesOut(
        connected=True,
        message="ok",
        ts=new_ts,
        updates_count=len(updates),
        messages=messages,
    )


@app.get("/vk/conversations", response_model=list[VkConversationOut])
def list_vk_conversations(request: Request, limit: int = 50, settings_id: int | None = None) -> list[VkConversationOut]:
    require_user_uuid(request)
    safe_limit = max(1, min(int(limit), 200))
    settings_row = _load_vk_lp_row(settings_id=settings_id)
    _, api_token, api_version, _, group_id, _, _, _ = settings_row
    gid = str(group_id or "").strip()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT peer_id, last_message_text, last_from_id, last_message_ts, messages_count
            FROM social_vk_conversations
            WHERE peer_id LIKE %s
            ORDER BY last_message_ts DESC, updated_at DESC
            LIMIT %s
            """,
            (f"{gid}:%", safe_limit),
        )
        rows = cur.fetchall()
    items = [
        VkConversationOut(
            peer_id=_decode_conv_peer(str(row[0] or "")),
            last_message_text=str(row[1] or ""),
            last_from_id=str(row[2] or ""),
            last_message_ts=int(row[3] or 0),
            messages_count=int(row[4] or 0),
        )
        for row in rows
    ]
    sender_map = _resolve_sender_names(
        [item.last_from_id for item in items],
        token=str(api_token or "").strip(),
        version=str(api_version or "5.199"),
        own_group_id=str(group_id or "").strip(),
    )
    for item in items:
        item.last_from_name = sender_map.get(item.last_from_id, item.last_from_id)
    return items


@app.get("/vk/conversations/{peer_id}/messages", response_model=list[VkMessageOut])
def list_vk_conversation_messages(
    request: Request, peer_id: str, limit: int = 50, offset: int = 0, settings_id: int | None = None
) -> list[VkMessageOut]:
    require_user_uuid(request)
    safe_limit = max(1, min(int(limit), 200))
    safe_offset = max(0, int(offset))
    settings_row = _load_vk_lp_row(settings_id=settings_id)
    _, api_token, api_version, _, group_id, _, _, _ = settings_row
    gid = str(group_id or "").strip()
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT event_id, peer_id, from_id, text, message_ts, raw_json
            FROM social_vk_messages
            WHERE vk_group_id=%s AND peer_id=%s
            ORDER BY message_ts DESC, id DESC
            LIMIT %s OFFSET %s
            """,
            (gid, str(peer_id).strip(), safe_limit, safe_offset),
        )
        rows = cur.fetchall()
    items = [
        VkMessageOut(
            event_type="message_new",
            event_id=str(row[0]),
            peer_id=str(row[1]),
            from_id=str(row[2] or ""),
            text=str(row[3] or ""),
            created_at=int(row[4] or 0),
            attachments=_extract_attachments_from_raw(row[5] if isinstance(row[5], dict) else {}),
        )
        for row in rows
    ]
    sender_map = _resolve_sender_names(
        [item.from_id for item in items],
        token=str(api_token or "").strip(),
        version=str(api_version or "5.199"),
        own_group_id=str(group_id or "").strip(),
    )
    own_group_marker = f"-{str(group_id or '').strip()}"
    for item in items:
        item.sender_name = sender_map.get(item.from_id, item.from_id)
        item.is_outgoing = bool(own_group_marker and item.from_id == own_group_marker)
    return items


@app.post("/vk/conversations/{peer_id}/reply", response_model=VkReplyOut)
def send_vk_conversation_reply(
    request: Request, peer_id: str, body: VkReplyIn, settings_id: int | None = None
) -> VkReplyOut:
    require_user_uuid(request)
    settings_row = _load_vk_lp_row(settings_id=settings_id)
    _, api_token, api_version, _, group_id, _, _, _ = settings_row
    token = str(api_token or "").strip()
    gid = str(group_id or "").strip()
    target_peer_id = str(peer_id or "").strip()
    text = str(body.text or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="api_token is empty")
    if not gid.isdigit():
        raise HTTPException(status_code=400, detail="group_id must be numeric")
    if not target_peer_id.isdigit():
        raise HTTPException(status_code=400, detail="peer_id must be numeric")
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")

    random_id = random.randint(1, 2_147_483_647)
    response = _vk_api_call(
        method="messages.send",
        token=token,
        version=str(api_version or "5.199"),
        params={
            "peer_id": int(target_peer_id),
            "random_id": random_id,
            "message": text,
            "group_id": int(gid),
        },
    )
    vk_message_id = int(response or 0)
    now_ts = int(time.time())
    event_id = f"out:{target_peer_id}:{vk_message_id}:{now_ts}"
    conv_peer_id = _encode_conv_peer(gid, target_peer_id)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO social_vk_messages (vk_group_id, event_id, peer_id, from_id, text, message_ts, raw_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (vk_group_id, event_id) DO NOTHING
            """,
            (
                gid,
                event_id,
                target_peer_id,
                f"-{gid}",
                text,
                now_ts,
                json.dumps({"type": "message_out", "vk_message_id": vk_message_id}, ensure_ascii=False),
            ),
        )
        cur.execute(
            """
            INSERT INTO social_vk_conversations (peer_id, last_message_text, last_from_id, last_message_ts, messages_count, updated_at)
            VALUES (%s, %s, %s, %s, 1, NOW())
            ON CONFLICT (peer_id) DO UPDATE
            SET
              last_message_text = EXCLUDED.last_message_text,
              last_from_id = EXCLUDED.last_from_id,
              last_message_ts = GREATEST(social_vk_conversations.last_message_ts, EXCLUDED.last_message_ts),
              messages_count = social_vk_conversations.messages_count + 1,
              updated_at = NOW()
            """,
            (conv_peer_id, text, f"-{gid}", now_ts),
        )
    return VkReplyOut(ok=True, vk_message_id=vk_message_id, message="sent")


@app.post("/vk/callback")
def vk_callback(payload: dict) -> Response:
    event_type = str(payload.get("type") or "").strip()
    incoming_group_id = str(payload.get("group_id") or "").strip()
    if not incoming_group_id:
        return Response(content="group_id is required", media_type="text/plain", status_code=400)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT group_id, confirmation_code, callback_secret, enabled
            FROM social_vk_group_settings
            WHERE group_id = %s
            ORDER BY is_default DESC, updated_at DESC, id ASC
            LIMIT 1
            """
            ,
            (incoming_group_id,),
        )
        row = cur.fetchone()
    if not row:
        return Response(content="settings not found", media_type="text/plain", status_code=500)
    group_id, confirmation_code, callback_secret, enabled = row
    if not bool(enabled):
        return Response(content="disabled", media_type="text/plain", status_code=403)
    if event_type == "confirmation":
        expected_group_id = str(group_id or "").strip()
        if expected_group_id and incoming_group_id and incoming_group_id != expected_group_id:
            return Response(content="group_id mismatch", media_type="text/plain", status_code=400)
        return Response(content=str(confirmation_code or "").strip(), media_type="text/plain")
    if callback_secret:
        incoming_secret = str(payload.get("secret") or "").strip()
        if incoming_secret != str(callback_secret).strip():
            return Response(content="invalid secret", media_type="text/plain", status_code=403)
    return Response(content="ok", media_type="text/plain")
