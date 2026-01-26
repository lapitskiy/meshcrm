import os
import uuid

import psycopg
from fastapi import FastAPI
from fastapi import Header, HTTPException
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


@app.on_event("startup")
def _startup() -> None:
    init_db()


class ApiSettingsIn(BaseModel):
    moy_sklad_api: str = ""
    yandex_market_api: str = ""
    wildberries_api: str = ""
    ozon_client_id: str = ""
    ozon_api: str = ""


def _user_uuid(x_user_uuid: str | None) -> uuid.UUID:
    if not x_user_uuid:
        raise HTTPException(status_code=401, detail="missing x-user-uuid")
    try:
        return uuid.UUID(x_user_uuid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid x-user-uuid") from e


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


