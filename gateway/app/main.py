import asyncio
import base64
import binascii
import json
import smtplib
import os
import secrets
import string
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
import ssl
from typing import Iterable, Any
import logging

import httpx
import jwt
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


KEYCLOAK_INTERNAL_URL = env("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = env("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_CLIENT_ID = env("KEYCLOAK_CLIENT_ID", "hubcrm-ui")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")
KEYCLOAK_ADMIN_USER = env("KEYCLOAK_ADMIN", "admin")
KEYCLOAK_ADMIN_PASSWORD = env("KEYCLOAK_ADMIN_PASSWORD", "admin")
USER_ADMIN_ROLES = {"superadmin", "admin"}
SMTP_CONFIG_PATH = Path("/app/app/config/smtp.json")
PROFILE_AVATAR_DIR = Path("/app/app/uploads/avatars")
PROFILE_AVATAR_MAX_BYTES = 200 * 1024

OIDC_ISSUER_RAW = env("OIDC_ISSUER", "http://localhost:8081/realms/hubcrm")
OIDC_ISSUERS = [x.strip() for x in OIDC_ISSUER_RAW.split(",") if x.strip()]
OIDC_AUDIENCE = os.getenv("OIDC_AUDIENCE", "")

JWKS_URL = f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
TOKEN_URL = f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"
KEYCLOAK_ADMIN_TOKEN_URL = f"{KEYCLOAK_INTERNAL_URL}/realms/master/protocol/openid-connect/token"
KEYCLOAK_ADMIN_USERS_URL = f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/users"

_jwk_client = jwt.PyJWKClient(JWKS_URL)
logger = logging.getLogger("gateway.auth")

CASES_URL = env("CASES_BASE_URL", os.getenv("CASES_URL", "http://core-cases:8000"))
REGISTRY_URL = env("REGISTRY_BASE_URL", os.getenv("REGISTRY_URL", "http://plugin-registry:8000"))
ACCOUNTING_URL = env("ACCOUNTING_BASE_URL", os.getenv("ACCOUNTING_URL", "http://accounting:8000"))
DOCUMENTS_URL = env("DOCUMENTS_BASE_URL", os.getenv("DOCUMENTS_URL", "http://documents:8000"))
CONTACTS_URL = env("CONTACTS_BASE_URL", os.getenv("CONTACTS_URL", "http://contacts:8000"))
ORDERS_URL = env("ORDERS_BASE_URL", os.getenv("ORDERS_URL", "http://orders:8000"))
AI_MEMORY_URL = env("AI_MEMORY_BASE_URL", os.getenv("AI_MEMORY_URL", "http://ai-memory:8000"))
MARKETPLACES_URL = env("MARKETPLACES_BASE_URL", os.getenv("MARKETPLACES_URL", "http://marketplaces:8000"))
FINANCE_URL = env("FINANCE_BASE_URL", os.getenv("FINANCE_URL", "http://finance:8000"))
WAREHOUSES_URL = env("WAREHOUSES_BASE_URL", os.getenv("WAREHOUSES_URL", "http://warehouses:8000"))
SKUPKA_URL = env("SKUPKA_BASE_URL", os.getenv("SKUPKA_URL", "http://skupka:8000"))
SOCIAL_URL = env("SOCIAL_BASE_URL", os.getenv("SOCIAL_URL", "http://social:8000"))


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def get_unverified_token_info(token: str) -> dict[str, Any]:
    info: dict[str, Any] = {"token_len": len(token)}
    try:
        header = jwt.get_unverified_header(token)
        info["kid"] = header.get("kid")
        info["alg"] = header.get("alg")
    except Exception as e:
        info["header_error"] = repr(e)

    try:
        payload = jwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_aud": False,
            },
        )
        info["iss"] = payload.get("iss")
        info["sub"] = payload.get("sub")
        info["aud"] = payload.get("aud")
        info["azp"] = payload.get("azp")
        info["exp"] = payload.get("exp")
    except Exception as e:
        info["payload_error"] = repr(e)
    return info


def extract_roles(payload: dict[str, Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for role in payload.get("realm_access", {}).get("roles", []) or []:
        role_s = str(role).strip()
        if role_s and role_s not in seen:
            seen.add(role_s)
            out.append(role_s)

    resource_access = payload.get("resource_access", {}) or {}
    for client_data in resource_access.values():
        if not isinstance(client_data, dict):
            continue
        for role in client_data.get("roles", []) or []:
            role_s = str(role).strip()
            if role_s and role_s not in seen:
                seen.add(role_s)
                out.append(role_s)
    return out


def require_user_admin(request: Request) -> dict[str, Any]:
    payload = verify_jwt(request)
    roles = set(extract_roles(payload))
    if roles.intersection(USER_ADMIN_ROLES):
        return payload
    raise HTTPException(status_code=403, detail="forbidden: admin role required")


async def require_users_manage_access(request: Request) -> dict[str, Any]:
    payload = verify_jwt(request)
    roles = set(extract_roles(payload))
    if roles.intersection(USER_ADMIN_ROLES):
        return payload

    user_uuid = str(payload.get("sub") or "").strip()
    if not user_uuid:
        raise HTTPException(status_code=401, detail="invalid token")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{REGISTRY_URL}/plugins/access/check/users.manage",
            headers={
                "x-user-uuid": user_uuid,
                "x-user-roles": ",".join(sorted(roles)),
            },
        )
    if not is_success_response(resp):
        raise HTTPException(status_code=502, detail=f"failed to check users.manage access: {resp.status_code}")
    if not bool((resp.json() or {}).get("allowed")):
        raise HTTPException(status_code=403, detail="forbidden: users.manage required")
    return payload


def normalize_text(value: Any, max_len: int) -> str:
    return str(value or "").strip()[:max_len]


def normalize_email(value: Any) -> str:
    email = normalize_text(value, 255).lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    return email


def normalize_role_names(role_names: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for role_name in role_names:
        normalized = normalize_text(role_name, 255)
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def keycloak_attr_value(attrs: Any, name: str) -> str:
    if not isinstance(attrs, dict):
        return ""
    raw = attrs.get(name)
    if isinstance(raw, list):
        return normalize_text(raw[0] if raw else "", 255)
    return normalize_text(raw, 255)


def is_assignable_realm_role(role_name: str) -> bool:
    if not role_name:
        return False
    if role_name in {"offline_access", "uma_authorization"}:
        return False
    if role_name.startswith("default-roles-"):
        return False
    return True


def build_user_out(user: dict[str, Any], role_names: list[str]) -> "UserOut":
    first_name = normalize_text(user.get("firstName"), 120)
    last_name = normalize_text(user.get("lastName"), 120)
    email = normalize_text(user.get("email"), 255)
    username = normalize_text(user.get("username"), 255) or email
    attrs = user.get("attributes") or {}
    full_name = " ".join(part for part in [first_name, last_name] if part).strip() or username or email
    return UserOut(
        id=normalize_text(user.get("id"), 255),
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        full_name=full_name,
        phone=keycloak_attr_value(attrs, "phone"),
        position=keycloak_attr_value(attrs, "position"),
        enabled=bool(user.get("enabled", True)),
        roles=sorted(normalize_role_names(role_names)),
    )


def generate_temporary_password(length: int = 12) -> str:
    if length < 8:
        length = 8
    alphabet = string.ascii_letters + string.digits
    password = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
    ]
    while len(password) < length:
        password.append(secrets.choice(alphabet))
    secrets.SystemRandom().shuffle(password)
    return "".join(password)


def is_success_response(resp: httpx.Response) -> bool:
    return 200 <= resp.status_code < 300


def require_current_user_uuid(request: Request) -> str:
    payload = verify_jwt(request)
    user_uuid = normalize_text(payload.get("sub"), 255)
    if not user_uuid:
        raise HTTPException(status_code=401, detail="invalid token")
    return user_uuid


def profile_avatar_path(user_uuid: str) -> Path:
    return PROFILE_AVATAR_DIR / f"{user_uuid}.jpg"


def avatar_bytes_to_data_url(raw: bytes) -> str:
    if not raw:
        return ""
    return f"data:image/jpeg;base64,{base64.b64encode(raw).decode('ascii')}"


def parse_avatar_data_url(data_url: Any) -> bytes:
    value = str(data_url or "").strip()
    prefix = "data:image/jpeg;base64,"
    if not value.startswith(prefix):
        raise HTTPException(status_code=400, detail="avatar must be jpeg image")
    try:
        raw = base64.b64decode(value[len(prefix) :], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid avatar payload") from exc
    if not raw:
        raise HTTPException(status_code=400, detail="avatar is empty")
    if len(raw) > PROFILE_AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="avatar must be 200kb or smaller")
    return raw


class RoleOut(BaseModel):
    name: str
    description: str = ""


class UserUpsertIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    phone: str = Field(default="", max_length=100)
    position: str = Field(default="", max_length=150)
    enabled: bool = True
    roles: list[str] = Field(default_factory=list)


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    first_name: str
    last_name: str
    full_name: str
    phone: str
    position: str
    enabled: bool
    roles: list[str]


class UserCreateOut(UserOut):
    temporary_password: str


class UserCreateIn(UserUpsertIn):
    send_email: bool = False


class UserPasswordResetIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)
    temporary: bool = True
    send_email: bool = False


class UserPasswordResetOut(BaseModel):
    user_id: str
    email: str
    temporary_password: str
    email_sent: bool


class ProfileAvatarIn(BaseModel):
    data_url: str = Field(min_length=32, max_length=600000)


class ProfileAvatarOut(BaseModel):
    avatar_data_url: str = ""


def load_smtp_config() -> dict[str, Any]:
    try:
        with SMTP_CONFIG_PATH.open("r", encoding="utf-8") as f:
            raw = json.load(f) or {}
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"smtp config not found: {SMTP_CONFIG_PATH}") from e
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid smtp config json: {SMTP_CONFIG_PATH}") from e

    return {
        "host": normalize_text(raw.get("host"), 255),
        "port": int(raw.get("port") or 587),
        "username": normalize_text(raw.get("username"), 255),
        "password": str(raw.get("password") or ""),
        "from_email": normalize_text(raw.get("from_email"), 255),
        "from_name": normalize_text(raw.get("from_name"), 255) or "HubCRM",
        "use_tls": bool(raw.get("use_tls", True)),
        "app_public_url": normalize_text(raw.get("app_public_url"), 255).rstrip("/") or "https://crm.central-service.ru:3443",
    }


def assert_smtp_configured(config: dict[str, Any]) -> None:
    required = {
        "host": config.get("host"),
        "from_email": config.get("from_email"),
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise HTTPException(status_code=400, detail=f"smtp not configured in {SMTP_CONFIG_PATH}: {', '.join(missing)}")


def send_email_message(config: dict[str, Any], to_email: str, subject: str, text_body: str) -> None:
    assert_smtp_configured(config)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((str(config["from_name"]), str(config["from_email"])))
    msg["To"] = to_email
    msg.set_content(text_body)

    if config["use_tls"]:
        with smtplib.SMTP(str(config["host"]), int(config["port"]), timeout=20) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if config["username"]:
                smtp.login(str(config["username"]), str(config["password"]))
            smtp.send_message(msg)
        return

    with smtplib.SMTP(str(config["host"]), int(config["port"]), timeout=20) as smtp:
        if config["username"]:
            smtp.login(str(config["username"]), str(config["password"]))
        smtp.send_message(msg)


def registration_email_text(config: dict[str, Any], user: "UserOut", password: str, temporary: bool) -> str:
    lines = [
        f"Здравствуйте, {user.full_name or user.email}!",
        "",
        "Для вас создан доступ в HubCRM.",
        "",
        f"Адрес входа: {config['app_public_url']}",
        f"Логин: {user.email}",
        f"Пароль: {password}",
    ]
    if temporary:
        lines.extend(["", "При первом входе система попросит сменить пароль."])
    lines.extend(["", "Если доступ был выдан по ошибке, сообщите администратору."])
    return "\n".join(lines)


async def keycloak_admin_headers() -> dict[str, str]:
    data = {
        "client_id": "admin-cli",
        "grant_type": "password",
        "username": KEYCLOAK_ADMIN_USER,
        "password": KEYCLOAK_ADMIN_PASSWORD,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            KEYCLOAK_ADMIN_TOKEN_URL,
            data=data,
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
    if not is_success_response(resp):
        raise HTTPException(status_code=502, detail=f"failed to get keycloak admin token: {resp.status_code}")
    token = str((resp.json() or {}).get("access_token") or "").strip()
    if not token:
        raise HTTPException(status_code=502, detail="failed to get keycloak admin token")
    return {"authorization": f"Bearer {token}"}


async def fetch_assignable_roles(
    client: httpx.AsyncClient,
    headers: dict[str, str],
) -> tuple[list[RoleOut], dict[str, dict[str, Any]]]:
    resp = await client.get(f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{KEYCLOAK_REALM}/roles", headers=headers)
    if not is_success_response(resp):
        raise HTTPException(status_code=502, detail=f"failed to load roles: {resp.status_code}")
    role_rows = resp.json() or []
    items: list[RoleOut] = []
    role_map: dict[str, dict[str, Any]] = {}
    for row in role_rows:
        role_name = normalize_text((row or {}).get("name"), 255)
        if not is_assignable_realm_role(role_name):
            continue
        role_map[role_name] = row
        items.append(RoleOut(name=role_name, description=normalize_text((row or {}).get("description"), 255)))
    items.sort(key=lambda item: item.name.lower())
    return items, role_map


async def fetch_user_role_names(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    user_id: str,
) -> list[str]:
    resp = await client.get(
        f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}/role-mappings/realm",
        headers=headers,
    )
    if not is_success_response(resp):
        raise HTTPException(status_code=502, detail=f"failed to load user roles: {resp.status_code}")
    role_rows = resp.json() or []
    return [
        normalize_text((row or {}).get("name"), 255)
        for row in role_rows
        if is_assignable_realm_role(normalize_text((row or {}).get("name"), 255))
    ]


async def sync_user_roles(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    user_id: str,
    target_roles: list[str],
    role_map: dict[str, dict[str, Any]],
) -> None:
    desired = normalize_role_names(target_roles)
    missing_roles = [role_name for role_name in desired if role_name not in role_map]
    if missing_roles:
        raise HTTPException(status_code=400, detail=f"unknown roles: {', '.join(missing_roles)}")

    current_resp = await client.get(
        f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}/role-mappings/realm",
        headers=headers,
    )
    if not is_success_response(current_resp):
        raise HTTPException(status_code=502, detail=f"failed to load current user roles: {current_resp.status_code}")
    current_rows = current_resp.json() or []
    current_map = {
        normalize_text((row or {}).get("name"), 255): row
        for row in current_rows
        if is_assignable_realm_role(normalize_text((row or {}).get("name"), 255))
    }

    current_names = set(current_map.keys())
    desired_names = set(desired)
    to_add = [role_map[role_name] for role_name in desired if role_name not in current_names]
    to_remove = [current_map[role_name] for role_name in current_names if role_name not in desired_names]

    if to_remove:
        resp = await client.request(
            "DELETE",
            f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}/role-mappings/realm",
            headers={**headers, "content-type": "application/json"},
            json=to_remove,
        )
        if not is_success_response(resp):
            raise HTTPException(status_code=502, detail=f"failed to remove user roles: {resp.status_code}")

    if to_add:
        resp = await client.post(
            f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}/role-mappings/realm",
            headers={**headers, "content-type": "application/json"},
            json=to_add,
        )
        if not is_success_response(resp):
            raise HTTPException(status_code=502, detail=f"failed to add user roles: {resp.status_code}")


async def fetch_user_by_id(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    user_id: str,
) -> dict[str, Any]:
    resp = await client.get(f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}", headers=headers)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="user not found")
    if not is_success_response(resp):
        raise HTTPException(status_code=502, detail=f"failed to load user: {resp.status_code}")
    return resp.json() or {}


def is_public(request: Request) -> bool:
    path = request.url.path
    if path == "/health":
        return True
    if path == "/auth/token":
        return True
    if path == "/social/vk/callback":
        return request.method.upper() == "POST"
    # UI uses this unauthenticated
    if path.startswith("/plugins"):
        return request.method.upper() == "GET"
    return False


def verify_jwt(request: Request) -> dict[str, Any]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        logger.warning("JWT missing bearer token: method=%s path=%s", request.method, request.url.path)
        raise HTTPException(status_code=401, detail="missing token")
    token = auth.split(" ", 1)[1]
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token).key
        options = {"verify_aud": bool(OIDC_AUDIENCE)}
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
            audience=OIDC_AUDIENCE if OIDC_AUDIENCE else None,
            options=options,
        )

        # Keycloak issuer can differ by host/prefix in proxied setups.
        # Keep strict signature validation and enforce realm-level issuer check.
        iss = str(payload.get("iss") or "")
        realm_suffix = f"/realms/{KEYCLOAK_REALM}"
        if not iss.endswith(realm_suffix):
            raise ValueError("issuer realm mismatch")

        if OIDC_ISSUERS and iss not in OIDC_ISSUERS:
            # Accept equivalent realm issuer variants (internal/public) even
            # when host/prefix differs, as long as realm suffix matches.
            pass
    except Exception as e:
        logger.warning(
            "JWT validation failed: method=%s path=%s error=%r token_info=%s expected_issuers=%s audience=%s",
            request.method,
            request.url.path,
            e,
            get_unverified_token_info(token),
            OIDC_ISSUERS,
            OIDC_AUDIENCE or None,
        )
        raise HTTPException(status_code=401, detail="invalid token") from e
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="invalid token")
    return payload


def filtered_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers:
        lk = k.lower()
        if lk in HOP_BY_HOP_HEADERS:
            continue
        if lk == "host":
            continue
        if lk == "content-length":
            continue
        out[k] = v
    return out


async def proxy(request: Request, upstream_base: str, upstream_path: str) -> Response:
    user_uuid = None
    user_roles: list[str] = []
    auth = request.headers.get("authorization", "")
    should_attach_user = (not is_public(request)) or auth.lower().startswith("bearer ")
    if should_attach_user:
        payload = verify_jwt(request)
        user_uuid = str(payload.get("sub"))
        user_roles = extract_roles(payload)

    url = f"{upstream_base}{upstream_path}"
    headers = filtered_headers(request.headers.items())
    if user_uuid:
        headers["x-user-uuid"] = user_uuid
    if user_roles:
        headers["x-user-roles"] = ",".join(user_roles)

    body = await request.body()
    async with httpx.AsyncClient(timeout=30.0) as client:
        upstream_resp = await client.request(
            method=request.method,
            url=url,
            params=request.query_params,
            headers=headers,
            content=body,
        )
    resp_headers = filtered_headers(upstream_resp.headers.items())
    return Response(content=upstream_resp.content, status_code=upstream_resp.status_code, headers=resp_headers)


app = FastAPI(title="gateway", version="0.1.0")

cors_raw = os.getenv("CORS_ALLOW_ORIGINS", "*")
cors_origins = ["*"] if cors_raw.strip() == "*" else [o.strip() for o in cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/token")
async def token_exchange(body: dict[str, Any]) -> Response:
    """
    Dev-friendly token endpoint.
    Exchanges username/password for access token via Keycloak Direct Access Grants.
    """
    username = str(body.get("username") or "")
    password = str(body.get("password") or "")
    if not username or not password:
        raise HTTPException(status_code=400, detail="username/password required")

    data = {
        "grant_type": "password",
        "client_id": KEYCLOAK_CLIENT_ID,
        "username": username,
        "password": password,
    }
    if KEYCLOAK_CLIENT_SECRET:
        data["client_secret"] = KEYCLOAK_CLIENT_SECRET

    async with httpx.AsyncClient(timeout=30.0) as client:
        upstream_resp = await client.post(TOKEN_URL, data=data)
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        headers={"content-type": upstream_resp.headers.get("content-type", "application/json")},
    )


@app.get("/users/roles", response_model=list[RoleOut])
async def list_user_roles(request: Request) -> list[RoleOut]:
    await require_users_manage_access(request)
    headers = await keycloak_admin_headers()
    async with httpx.AsyncClient(timeout=30.0) as client:
        roles, _ = await fetch_assignable_roles(client, headers)
    return roles


@app.get("/users", response_model=list[UserOut])
async def list_users(request: Request, q: str = "") -> list[UserOut]:
    await require_users_manage_access(request)
    headers = await keycloak_admin_headers()
    params: dict[str, Any] = {"max": 200}
    query = normalize_text(q, 255)
    if query:
        params["search"] = query
    async with httpx.AsyncClient(timeout=30.0) as client:
        users_resp = await client.get(KEYCLOAK_ADMIN_USERS_URL, headers=headers, params=params)
        if not is_success_response(users_resp):
            raise HTTPException(status_code=502, detail=f"failed to load users: {users_resp.status_code}")
        user_rows = [
            row
            for row in (users_resp.json() or [])
            if normalize_text((row or {}).get("id"), 255)
            and not normalize_text((row or {}).get("username"), 255).startswith("service-account-")
        ]
        role_lists = await asyncio.gather(
            *(fetch_user_role_names(client, headers, normalize_text((row or {}).get("id"), 255)) for row in user_rows)
        )
    items = [build_user_out(row, role_lists[idx]) for idx, row in enumerate(user_rows)]
    items.sort(key=lambda item: (item.last_name.lower(), item.first_name.lower(), item.email.lower()))
    return items


@app.post("/users", response_model=UserCreateOut, status_code=201)
async def create_user(body: UserCreateIn, request: Request) -> UserCreateOut:
    await require_users_manage_access(request)
    smtp_config = load_smtp_config() if body.send_email else None
    if body.send_email:
        assert_smtp_configured(smtp_config or {})
    headers = await keycloak_admin_headers()
    temporary_password = generate_temporary_password()
    email = normalize_email(body.email)
    payload = {
        "username": email,
        "email": email,
        "firstName": normalize_text(body.first_name, 120),
        "lastName": normalize_text(body.last_name, 120),
        "enabled": body.enabled,
        "emailVerified": True,
        "attributes": {
            "phone": [normalize_text(body.phone, 100)],
            "position": [normalize_text(body.position, 150)],
        },
        "credentials": [
            {
                "type": "password",
                "value": temporary_password,
                "temporary": True,
            }
        ],
        "requiredActions": ["UPDATE_PASSWORD"],
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        _, role_map = await fetch_assignable_roles(client, headers)
        create_resp = await client.post(
            KEYCLOAK_ADMIN_USERS_URL,
            headers={**headers, "content-type": "application/json"},
            json=payload,
        )
        if create_resp.status_code == 409:
            raise HTTPException(status_code=409, detail="user with this email already exists")
        if not is_success_response(create_resp):
            raise HTTPException(status_code=502, detail=f"failed to create user: {create_resp.status_code}")

        location = create_resp.headers.get("location", "")
        user_id = normalize_text(location.rstrip("/").split("/")[-1] if location else "", 255)
        if not user_id:
            lookup_resp = await client.get(KEYCLOAK_ADMIN_USERS_URL, headers=headers, params={"email": email, "exact": "true"})
            if not is_success_response(lookup_resp) or not (lookup_resp.json() or []):
                raise HTTPException(status_code=502, detail="failed to resolve created user id")
            user_id = normalize_text((lookup_resp.json()[0] or {}).get("id"), 255)
        await sync_user_roles(client, headers, user_id, body.roles, role_map)
        user = await fetch_user_by_id(client, headers, user_id)
        role_names = await fetch_user_role_names(client, headers, user_id)

    user_out = build_user_out(user, role_names)
    if body.send_email:
        try:
            await asyncio.to_thread(
                send_email_message,
                smtp_config or {},
                user_out.email,
                "Доступ в HubCRM",
                registration_email_text(smtp_config or {}, user_out, temporary_password, True),
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"failed to send registration email: {e}") from e
    return UserCreateOut(**user_out.model_dump(), temporary_password=temporary_password)


@app.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpsertIn, request: Request) -> UserOut:
    await require_users_manage_access(request)
    headers = await keycloak_admin_headers()
    email = normalize_email(body.email)
    payload = {
        "username": email,
        "email": email,
        "firstName": normalize_text(body.first_name, 120),
        "lastName": normalize_text(body.last_name, 120),
        "enabled": body.enabled,
        "emailVerified": True,
        "attributes": {
            "phone": [normalize_text(body.phone, 100)],
            "position": [normalize_text(body.position, 150)],
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        _, role_map = await fetch_assignable_roles(client, headers)
        await fetch_user_by_id(client, headers, user_id)
        update_resp = await client.put(
            f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}",
            headers={**headers, "content-type": "application/json"},
            json=payload,
        )
        if update_resp.status_code == 409:
            raise HTTPException(status_code=409, detail="user with this email already exists")
        if not is_success_response(update_resp):
            raise HTTPException(status_code=502, detail=f"failed to update user: {update_resp.status_code}")
        await sync_user_roles(client, headers, user_id, body.roles, role_map)
        user = await fetch_user_by_id(client, headers, user_id)
        role_names = await fetch_user_role_names(client, headers, user_id)

    return build_user_out(user, role_names)


@app.post("/users/{user_id}/reset-password", response_model=UserPasswordResetOut)
async def reset_user_password(user_id: str, body: UserPasswordResetIn, request: Request) -> UserPasswordResetOut:
    await require_users_manage_access(request)
    smtp_config = load_smtp_config() if body.send_email else None
    if body.send_email:
        assert_smtp_configured(smtp_config or {})
    headers = await keycloak_admin_headers()
    password = normalize_text(body.new_password, 128)
    async with httpx.AsyncClient(timeout=30.0) as client:
        user = await fetch_user_by_id(client, headers, user_id)
        role_names = await fetch_user_role_names(client, headers, user_id)
        reset_resp = await client.put(
            f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}/reset-password",
            headers={**headers, "content-type": "application/json"},
            json={
                "type": "password",
                "value": password,
                "temporary": bool(body.temporary),
            },
        )
        if not is_success_response(reset_resp):
            raise HTTPException(status_code=502, detail=f"failed to reset password: {reset_resp.status_code}")
    user_out = build_user_out(user, role_names)
    if body.send_email:
        try:
            await asyncio.to_thread(
                send_email_message,
                smtp_config or {},
                user_out.email,
                "Новый пароль HubCRM",
                registration_email_text(smtp_config or {}, user_out, password, body.temporary),
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"failed to send registration email: {e}") from e
    return UserPasswordResetOut(
        user_id=user_out.id,
        email=user_out.email,
        temporary_password=password,
        email_sent=body.send_email,
    )


@app.get("/profile/avatar", response_model=ProfileAvatarOut)
async def get_profile_avatar(request: Request) -> ProfileAvatarOut:
    user_uuid = require_current_user_uuid(request)
    path = profile_avatar_path(user_uuid)
    if not path.exists():
        return ProfileAvatarOut(avatar_data_url="")
    try:
        raw = await asyncio.to_thread(path.read_bytes)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"failed to read avatar: {exc}") from exc
    return ProfileAvatarOut(avatar_data_url=avatar_bytes_to_data_url(raw))


@app.put("/profile/avatar", response_model=ProfileAvatarOut)
async def update_profile_avatar(body: ProfileAvatarIn, request: Request) -> ProfileAvatarOut:
    user_uuid = require_current_user_uuid(request)
    raw = parse_avatar_data_url(body.data_url)
    path = profile_avatar_path(user_uuid)
    try:
        await asyncio.to_thread(PROFILE_AVATAR_DIR.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, raw)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"failed to save avatar: {exc}") from exc
    return ProfileAvatarOut(avatar_data_url=avatar_bytes_to_data_url(raw))


@app.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, request: Request) -> Response:
    await require_users_manage_access(request)
    headers = await keycloak_admin_headers()
    async with httpx.AsyncClient(timeout=30.0) as client:
        delete_resp = await client.delete(f"{KEYCLOAK_ADMIN_USERS_URL}/{user_id}", headers=headers)
    if delete_resp.status_code == 404:
        raise HTTPException(status_code=404, detail="user not found")
    if not is_success_response(delete_resp):
        raise HTTPException(status_code=502, detail=f"failed to delete user: {delete_resp.status_code}")
    return Response(status_code=204)


@app.api_route("/cases{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def cases_proxy(request: Request, rest: str) -> Response:
    return await proxy(request, CASES_URL, f"/cases{rest}")


@app.api_route("/plugins{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def registry_proxy(request: Request, rest: str) -> Response:
    return await proxy(request, REGISTRY_URL, f"/plugins{rest}")


@app.api_route("/accounting{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def accounting_proxy(request: Request, rest: str) -> Response:
    return await proxy(request, ACCOUNTING_URL, f"/accounting{rest}")


@app.api_route("/documents{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def documents_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, DOCUMENTS_URL, upstream_path)


@app.api_route("/contacts{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def contacts_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, CONTACTS_URL, upstream_path)


@app.api_route("/orders{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def orders_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, ORDERS_URL, upstream_path)


@app.api_route("/ai-memory{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def ai_memory_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, AI_MEMORY_URL, upstream_path)


@app.api_route("/marketplaces{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def marketplaces_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, MARKETPLACES_URL, upstream_path)


@app.api_route("/finance{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def finance_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, FINANCE_URL, upstream_path)


@app.api_route("/warehouses{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def warehouses_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, WAREHOUSES_URL, upstream_path)


@app.api_route("/skupka{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def skupka_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, SKUPKA_URL, upstream_path)


@app.api_route("/social{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def social_proxy(request: Request, rest: str) -> Response:
    upstream_path = rest if rest else "/"
    return await proxy(request, SOCIAL_URL, upstream_path)
