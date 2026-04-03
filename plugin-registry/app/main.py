import json
import os
from pathlib import Path
from typing import Any
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import psycopg
from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from pydantic import BaseModel, Field


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
MANIFESTS_DIR = Path("/app/manifests")
KEYCLOAK_INTERNAL_URL = env("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = env("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_ADMIN_USER = env("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = env("KEYCLOAK_ADMIN_PASSWORD", "admin")
ACCESS_ADMIN_ROLES = {"superadmin", "admin"}
SPECIAL_ACCESS_NAMES = {"users.manage"}


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS plugins (
              name TEXT PRIMARY KEY,
              enabled BOOLEAN NOT NULL,
              manifest JSONB NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        cur.execute(
            """
            ALTER TABLE plugins
            ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
            """
        )
        cur.execute(
            """
            WITH ordered AS (
              SELECT name, ROW_NUMBER() OVER (ORDER BY sort_order ASC, name ASC) AS rn
              FROM plugins
            )
            UPDATE plugins p
            SET sort_order = ordered.rn
            FROM ordered
            WHERE p.name = ordered.name
              AND (p.sort_order IS NULL OR p.sort_order = 0);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS module_links (
              source_module TEXT NOT NULL,
              target_module TEXT NOT NULL,
              enabled BOOLEAN NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (source_module, target_module),
              CHECK (source_module <> target_module)
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS module_access (
              module_name TEXT NOT NULL,
              user_uuid TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'viewer',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (module_name, user_uuid)
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_module_access_user_uuid ON module_access(user_uuid)")


def seed_from_files() -> None:
    with db() as conn, conn.cursor() as cur:
        for p in sorted(MANIFESTS_DIR.glob("*.json")):
            manifest = json.loads(p.read_text(encoding="utf-8"))
            name = manifest.get("name") or p.stem
            cur.execute(
                """
                INSERT INTO plugins (name, enabled, manifest, sort_order)
                VALUES (
                  %s,
                  TRUE,
                  %s::jsonb,
                  COALESCE((SELECT MAX(sort_order) + 1 FROM plugins), 1)
                )
                ON CONFLICT (name) DO UPDATE SET manifest=EXCLUDED.manifest
                """,
                (name, json.dumps(manifest, ensure_ascii=False)),
            )


class PluginToggleIn(BaseModel):
    enabled: bool


class PluginUpsertIn(BaseModel):
    enabled: bool = True
    manifest: dict[str, Any]


class ModuleLinkToggleIn(BaseModel):
    enabled: bool


class UserLiteOut(BaseModel):
    user_uuid: str
    username: str
    email: str
    full_name: str


class UserModuleAccessOut(BaseModel):
    user_uuid: str
    module_names: list[str]


class UserModuleAccessReplaceIn(BaseModel):
    module_names: list[str] = Field(default_factory=list)
    role: str = Field(default="viewer", min_length=1, max_length=50)


class PluginOrderReplaceIn(BaseModel):
    names: list[str] = Field(default_factory=list)


app = FastAPI(title="plugin-registry", version="0.1.0")


def require_user_uuid(request: FastAPIRequest) -> str:
    user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    return user_uuid


def roles_from_headers(request: FastAPIRequest) -> set[str]:
    raw = str(request.headers.get("x-user-roles", "")).strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def is_access_admin(request: FastAPIRequest) -> bool:
    return bool(roles_from_headers(request).intersection(ACCESS_ADMIN_ROLES))


def require_access_admin(request: FastAPIRequest) -> str:
    user_uuid = require_user_uuid(request)
    if is_access_admin(request):
        return user_uuid
    raise HTTPException(status_code=403, detail="forbidden: admin role required")


def keycloak_admin_token() -> str:
    data = urlencode(
        {
            "client_id": "admin-cli",
            "grant_type": "password",
            "username": KEYCLOAK_ADMIN_USER,
            "password": KEYCLOAK_ADMIN_PASSWORD,
        }
    ).encode()
    req = Request(
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


def allowed_access_names(cur: psycopg.Cursor) -> set[str]:
    cur.execute("SELECT name FROM plugins")
    names = {row[0] for row in cur.fetchall()}
    return names.union(SPECIAL_ACCESS_NAMES)


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            seed_from_files()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("registry-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/plugins")
def list_plugins(request: FastAPIRequest, enabled_only: bool = True) -> list[dict[str, Any]]:
    with db() as conn, conn.cursor() as cur:
        user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
        is_admin = is_access_admin(request)
        if user_uuid and not is_admin:
            if enabled_only:
                cur.execute(
                    """
                    SELECT p.manifest
                    FROM plugins p
                    WHERE p.enabled=TRUE
                      AND EXISTS (
                        SELECT 1 FROM module_access ma
                        WHERE ma.module_name = p.name AND ma.user_uuid = %s
                      )
                    ORDER BY p.sort_order ASC, p.name ASC
                    """,
                    (user_uuid,),
                )
            else:
                cur.execute(
                    """
                    SELECT p.manifest
                    FROM plugins p
                    WHERE EXISTS (
                      SELECT 1 FROM module_access ma
                      WHERE ma.module_name = p.name AND ma.user_uuid = %s
                    )
                    ORDER BY p.sort_order ASC, p.name ASC
                    """,
                    (user_uuid,),
                )
        elif enabled_only:
            cur.execute("SELECT manifest FROM plugins WHERE enabled=TRUE ORDER BY sort_order ASC, name ASC")
        else:
            cur.execute("SELECT manifest FROM plugins ORDER BY sort_order ASC, name ASC")
        return [row[0] for row in cur.fetchall()]


@app.get("/plugins/_meta")
def list_plugins_meta(request: FastAPIRequest, enabled_only: bool = True) -> list[dict[str, Any]]:
    with db() as conn, conn.cursor() as cur:
        user_uuid = str(request.headers.get("x-user-uuid", "")).strip()
        is_admin = is_access_admin(request)
        if user_uuid and not is_admin:
            if enabled_only:
                cur.execute(
                    """
                    SELECT p.name, p.enabled, p.manifest
                    FROM plugins p
                    WHERE p.enabled=TRUE
                      AND EXISTS (
                        SELECT 1 FROM module_access ma
                        WHERE ma.module_name = p.name AND ma.user_uuid = %s
                      )
                    ORDER BY p.sort_order ASC, p.name ASC
                    """,
                    (user_uuid,),
                )
            else:
                cur.execute(
                    """
                    SELECT p.name, p.enabled, p.manifest
                    FROM plugins p
                    WHERE EXISTS (
                      SELECT 1 FROM module_access ma
                      WHERE ma.module_name = p.name AND ma.user_uuid = %s
                    )
                    ORDER BY p.sort_order ASC, p.name ASC
                    """,
                    (user_uuid,),
                )
        elif enabled_only:
            cur.execute(
                "SELECT name, enabled, manifest FROM plugins WHERE enabled=TRUE ORDER BY sort_order ASC, name ASC"
            )
        else:
            cur.execute("SELECT name, enabled, manifest FROM plugins ORDER BY sort_order ASC, name ASC")
        return [
            {"name": name, "enabled": enabled, "manifest": manifest}
            for (name, enabled, manifest) in cur.fetchall()
        ]


@app.get("/plugins/_links")
def list_module_links(enabled_only: bool = False) -> list[dict[str, Any]]:
    with db() as conn, conn.cursor() as cur:
        if enabled_only:
            cur.execute(
                """
                SELECT source_module, target_module, enabled
                FROM module_links
                WHERE enabled=TRUE
                ORDER BY source_module, target_module
                """
            )
        else:
            cur.execute(
                """
                SELECT source_module, target_module, enabled
                FROM module_links
                ORDER BY source_module, target_module
                """
            )
        return [
            {
                "source_module": source_module,
                "target_module": target_module,
                "enabled": enabled,
            }
            for (source_module, target_module, enabled) in cur.fetchall()
        ]


@app.put("/plugins/_links/{source_module}/{target_module}")
def set_module_link(
    source_module: str, target_module: str, body: ModuleLinkToggleIn, request: FastAPIRequest
) -> dict[str, Any]:
    require_access_admin(request)
    if source_module == target_module:
        raise HTTPException(status_code=400, detail="source_module must differ from target_module")
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM plugins WHERE name=%s", (source_module,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="source module not found")
        cur.execute("SELECT 1 FROM plugins WHERE name=%s", (target_module,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="target module not found")
        cur.execute(
            """
            INSERT INTO module_links (source_module, target_module, enabled, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (source_module, target_module)
            DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=NOW()
            """,
            (source_module, target_module, body.enabled),
        )
    return {
        "source_module": source_module,
        "target_module": target_module,
        "enabled": body.enabled,
    }


@app.put("/plugins/_order")
def replace_plugins_order(body: PluginOrderReplaceIn, request: FastAPIRequest) -> dict[str, Any]:
    require_access_admin(request)
    names = [str(x).strip() for x in body.names if str(x).strip()]
    names = list(dict.fromkeys(names))
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM plugins ORDER BY sort_order ASC, name ASC")
        existing_names = [row[0] for row in cur.fetchall()]
        if set(names) != set(existing_names):
            raise HTTPException(status_code=400, detail="names must match all existing plugins exactly")
        for index, plugin_name in enumerate(names, start=1):
            cur.execute("UPDATE plugins SET sort_order=%s WHERE name=%s", (index, plugin_name))
    return {"ok": True, "count": len(names)}


@app.get("/plugins/{name}")
def get_plugin(name: str) -> dict[str, Any]:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT enabled, manifest FROM plugins WHERE name=%s", (name,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="plugin not found")
        enabled, manifest = row
        if not enabled:
            raise HTTPException(status_code=404, detail="plugin disabled")
        return manifest


@app.put("/plugins/{name}")
def upsert_plugin(name: str, body: PluginUpsertIn, request: FastAPIRequest) -> dict[str, Any]:
    require_access_admin(request)
    manifest_name = str((body.manifest or {}).get("name") or "").strip()
    if manifest_name and manifest_name != name:
        raise HTTPException(status_code=400, detail="manifest.name must match path name")
    required_keys = {"name", "bounded_context", "version", "events", "api"}
    if not required_keys.issubset(set((body.manifest or {}).keys())):
        raise HTTPException(status_code=400, detail="manifest missing required fields")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO plugins (name, enabled, manifest, sort_order)
            VALUES (
              %s,
              %s,
              %s::jsonb,
              COALESCE((SELECT MAX(sort_order) + 1 FROM plugins), 1)
            )
            ON CONFLICT (name)
            DO UPDATE SET enabled=EXCLUDED.enabled, manifest=EXCLUDED.manifest
            RETURNING name, enabled, manifest
            """,
            (name, body.enabled, json.dumps(body.manifest, ensure_ascii=False)),
        )
        row = cur.fetchone()
    return {"name": row[0], "enabled": row[1], "manifest": row[2]}


@app.post("/plugins/{name}/toggle")
def toggle_plugin(name: str, body: PluginToggleIn, request: FastAPIRequest) -> dict[str, Any]:
    require_access_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute("UPDATE plugins SET enabled=%s WHERE name=%s", (body.enabled, name))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="plugin not found")
    return {"name": name, "enabled": body.enabled}


@app.get("/plugins/access/users/search", response_model=list[UserLiteOut])
def search_users(q: str, request: FastAPIRequest) -> list[UserLiteOut]:
    require_access_admin(request)
    term = q.strip()
    if len(term) < 2:
        return []
    token = keycloak_admin_token()
    req = Request(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users?search={term}&max=20",
        headers={"authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as resp:
        payload = resp.read().decode("utf-8")
    rows = json.loads(payload) or []
    out: list[UserLiteOut] = []
    for row in rows:
        user_uuid = str((row or {}).get("id") or "").strip()
        if not user_uuid:
            continue
        first = str((row or {}).get("firstName") or "").strip()
        last = str((row or {}).get("lastName") or "").strip()
        full_name = f"{first} {last}".strip() or str((row or {}).get("username") or "").strip() or user_uuid
        out.append(
            UserLiteOut(
                user_uuid=user_uuid,
                username=str((row or {}).get("username") or "").strip(),
                email=str((row or {}).get("email") or "").strip(),
                full_name=full_name,
            )
        )
    return out


@app.get("/plugins/access/users/{user_uuid}", response_model=UserModuleAccessOut)
def get_user_access(user_uuid: str, request: FastAPIRequest) -> UserModuleAccessOut:
    require_access_admin(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT module_name FROM module_access WHERE user_uuid=%s ORDER BY created_at ASC, module_name ASC",
            (user_uuid,),
        )
        rows = cur.fetchall()
    return UserModuleAccessOut(user_uuid=user_uuid, module_names=[row[0] for row in rows])


@app.get("/plugins/access/check/{access_name}")
def check_access(access_name: str, request: FastAPIRequest) -> dict[str, Any]:
    user_uuid = require_user_uuid(request)
    if is_access_admin(request):
        return {"access_name": access_name, "allowed": True}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM module_access WHERE module_name=%s AND user_uuid=%s",
            (access_name, user_uuid),
        )
        allowed = cur.fetchone() is not None
    return {"access_name": access_name, "allowed": allowed}


@app.put("/plugins/access/users/{user_uuid}", response_model=UserModuleAccessOut)
def replace_user_access(user_uuid: str, body: UserModuleAccessReplaceIn, request: FastAPIRequest) -> UserModuleAccessOut:
    require_access_admin(request)
    role = body.role.strip().lower()
    if not role:
        raise HTTPException(status_code=400, detail="role must not be empty")
    module_names = [str(name).strip() for name in body.module_names if str(name).strip()]
    module_names = list(dict.fromkeys(module_names))
    with db() as conn, conn.cursor() as cur:
        if module_names:
            existing_names = allowed_access_names(cur)
            if not set(module_names).issubset(existing_names):
                raise HTTPException(status_code=400, detail="some module_names do not exist")
        cur.execute("DELETE FROM module_access WHERE user_uuid=%s", (user_uuid,))
        for module_name in module_names:
            cur.execute(
                """
                INSERT INTO module_access (module_name, user_uuid, role)
                VALUES (%s, %s, %s)
                ON CONFLICT (module_name, user_uuid) DO UPDATE SET role=EXCLUDED.role
                """,
                (module_name, user_uuid, role),
            )
    return UserModuleAccessOut(user_uuid=user_uuid, module_names=module_names)


