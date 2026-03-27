import json
import os
from pathlib import Path
from typing import Any
import time

import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
MANIFESTS_DIR = Path("/app/manifests")


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS plugins (
              name TEXT PRIMARY KEY,
              enabled BOOLEAN NOT NULL,
              manifest JSONB NOT NULL
            );
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


def seed_from_files() -> None:
    with db() as conn, conn.cursor() as cur:
        for p in sorted(MANIFESTS_DIR.glob("*.json")):
            manifest = json.loads(p.read_text(encoding="utf-8"))
            name = manifest.get("name") or p.stem
            cur.execute(
                """
                INSERT INTO plugins (name, enabled, manifest)
                VALUES (%s, TRUE, %s::jsonb)
                ON CONFLICT (name) DO UPDATE SET manifest=EXCLUDED.manifest
                """,
                (name, json.dumps(manifest, ensure_ascii=False)),
            )


class PluginToggleIn(BaseModel):
    enabled: bool


class ModuleLinkToggleIn(BaseModel):
    enabled: bool


app = FastAPI(title="plugin-registry", version="0.1.0")


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
def list_plugins(enabled_only: bool = True) -> list[dict[str, Any]]:
    with db() as conn, conn.cursor() as cur:
        if enabled_only:
            cur.execute("SELECT manifest FROM plugins WHERE enabled=TRUE ORDER BY name")
        else:
            cur.execute("SELECT manifest FROM plugins ORDER BY name")
        return [row[0] for row in cur.fetchall()]


@app.get("/plugins/_meta")
def list_plugins_meta(enabled_only: bool = True) -> list[dict[str, Any]]:
    with db() as conn, conn.cursor() as cur:
        if enabled_only:
            cur.execute(
                "SELECT name, enabled, manifest FROM plugins WHERE enabled=TRUE ORDER BY name"
            )
        else:
            cur.execute("SELECT name, enabled, manifest FROM plugins ORDER BY name")
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
    source_module: str, target_module: str, body: ModuleLinkToggleIn
) -> dict[str, Any]:
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


@app.post("/plugins/{name}/toggle")
def toggle_plugin(name: str, body: PluginToggleIn) -> dict[str, Any]:
    with db() as conn, conn.cursor() as cur:
        cur.execute("UPDATE plugins SET enabled=%s WHERE name=%s", (body.enabled, name))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="plugin not found")
    return {"name": name, "enabled": body.enabled}


