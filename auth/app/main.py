import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
import time

import jwt
import psycopg
from fastapi import FastAPI, HTTPException, Request
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


PWD = CryptContext(schemes=["bcrypt"], deprecated="auto")


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


DATABASE_URL = env("DATABASE_URL")
JWT_SECRET = env("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = env("JWT_ALG", "HS256")
ACCESS_TOKEN_TTL_MIN = int(os.getenv("ACCESS_TOKEN_TTL_MIN", "30"))
REFRESH_TOKEN_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "7"))


def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
              user_uuid UUID PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS refresh_tokens (
              token_uuid UUID PRIMARY KEY,
              user_uuid UUID NOT NULL REFERENCES users(user_uuid) ON DELETE CASCADE,
              token_secret TEXT NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              created_at TIMESTAMPTZ NOT NULL
            );
            """
        )


def make_access_token(user_uuid: uuid.UUID, email: str) -> str:
    now = utcnow()
    payload: dict[str, Any] = {
        "sub": str(user_uuid),
        "email": email,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MIN)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def make_refresh_token(user_uuid: uuid.UUID) -> tuple[str, uuid.UUID, str, datetime]:
    token_uuid = uuid.uuid4()
    token_secret = secrets.token_urlsafe(32)
    expires_at = utcnow() + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    # refresh token is a signed JWT carrying token_uuid + token_secret
    payload = {
        "sub": str(user_uuid),
        "type": "refresh",
        "token_uuid": str(token_uuid),
        "token_secret": token_secret,
        "iat": int(utcnow().timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    return token, token_uuid, token_secret, expires_at


class RegisterIn(BaseModel):
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


app = FastAPI(title="auth", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    for _ in range(60):
        try:
            init_db()
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("auth-db not ready")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/register", response_model=TokenOut)
def register(body: RegisterIn) -> TokenOut:
    user_uuid = uuid.uuid4()
    password_hash = PWD.hash(body.password)
    with db() as conn, conn.cursor() as cur:
        try:
            cur.execute(
                "INSERT INTO users (user_uuid, email, password_hash, created_at) VALUES (%s,%s,%s,%s)",
                (user_uuid, body.email, password_hash, utcnow()),
            )
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=400, detail="email already exists") from e

        refresh_token, token_uuid, token_secret, expires_at = make_refresh_token(user_uuid)
        cur.execute(
            "INSERT INTO refresh_tokens (token_uuid, user_uuid, token_secret, expires_at, created_at) VALUES (%s,%s,%s,%s,%s)",
            (token_uuid, user_uuid, token_secret, expires_at, utcnow()),
        )
    return TokenOut(access_token=make_access_token(user_uuid, body.email), refresh_token=refresh_token)


@app.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn) -> TokenOut:
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT user_uuid, password_hash FROM users WHERE email=%s", (body.email,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="invalid credentials")
        user_uuid_str, password_hash = row
        if not PWD.verify(body.password, password_hash):
            raise HTTPException(status_code=401, detail="invalid credentials")
        user_uuid_val = uuid.UUID(str(user_uuid_str))

        refresh_token, token_uuid, token_secret, expires_at = make_refresh_token(user_uuid_val)
        cur.execute(
            "INSERT INTO refresh_tokens (token_uuid, user_uuid, token_secret, expires_at, created_at) VALUES (%s,%s,%s,%s,%s)",
            (token_uuid, user_uuid_val, token_secret, expires_at, utcnow()),
        )
        return TokenOut(access_token=make_access_token(user_uuid_val, body.email), refresh_token=refresh_token)


@app.post("/auth/refresh", response_model=TokenOut)
def refresh(body: RefreshIn) -> TokenOut:
    try:
        payload = jwt.decode(body.refresh_token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception as e:
        raise HTTPException(status_code=401, detail="invalid refresh token") from e

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="invalid refresh token")

    user_uuid = uuid.UUID(payload["sub"])
    token_uuid = uuid.UUID(payload["token_uuid"])
    token_secret = payload["token_secret"]

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT token_secret, expires_at FROM refresh_tokens WHERE token_uuid=%s AND user_uuid=%s",
            (token_uuid, user_uuid),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="refresh token revoked")
        stored_secret, expires_at = row
        if str(stored_secret) != str(token_secret):
            raise HTTPException(status_code=401, detail="refresh token revoked")
        if expires_at < utcnow():
            raise HTTPException(status_code=401, detail="refresh token expired")

        # rotate
        cur.execute("DELETE FROM refresh_tokens WHERE token_uuid=%s", (token_uuid,))
        cur.execute("SELECT email FROM users WHERE user_uuid=%s", (user_uuid,))
        email_row = cur.fetchone()
        email = email_row[0] if email_row else ""

        new_refresh_token, new_token_uuid, new_token_secret, new_expires_at = make_refresh_token(user_uuid)
        cur.execute(
            "INSERT INTO refresh_tokens (token_uuid, user_uuid, token_secret, expires_at, created_at) VALUES (%s,%s,%s,%s,%s)",
            (new_token_uuid, user_uuid, new_token_secret, new_expires_at, utcnow()),
        )

    return TokenOut(access_token=make_access_token(user_uuid, email), refresh_token=new_refresh_token)


@app.get("/auth/me")
def me(request: Request) -> dict[str, Any]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    token = auth.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception as e:
        raise HTTPException(status_code=401, detail="invalid token") from e
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="invalid token")
    return {"user_uuid": payload.get("sub"), "email": payload.get("email")}


