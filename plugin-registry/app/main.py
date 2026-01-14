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


