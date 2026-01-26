import os
from typing import Iterable, Any

import httpx
import jwt
from fastapi import FastAPI, HTTPException, Request, Response


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


KEYCLOAK_INTERNAL_URL = env("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = env("KEYCLOAK_REALM", "hubcrm")
KEYCLOAK_CLIENT_ID = env("KEYCLOAK_CLIENT_ID", "hubcrm-ui")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")

OIDC_ISSUER = env("OIDC_ISSUER", "http://localhost:8081/realms/hubcrm")
OIDC_AUDIENCE = os.getenv("OIDC_AUDIENCE", "")

JWKS_URL = f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
TOKEN_URL = f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"

_jwk_client = jwt.PyJWKClient(JWKS_URL)

CASES_URL = env("CASES_BASE_URL", os.getenv("CASES_URL", "http://core-cases:8000"))
REGISTRY_URL = env("REGISTRY_BASE_URL", os.getenv("REGISTRY_URL", "http://plugin-registry:8000"))
ACCOUNTING_URL = env("ACCOUNTING_BASE_URL", os.getenv("ACCOUNTING_URL", "http://accounting:8000"))
DOCUMENTS_URL = env("DOCUMENTS_BASE_URL", os.getenv("DOCUMENTS_URL", "http://documents:8000"))
CONTACTS_URL = env("CONTACTS_BASE_URL", os.getenv("CONTACTS_URL", "http://contacts:8000"))
ORDERS_URL = env("ORDERS_BASE_URL", os.getenv("ORDERS_URL", "http://orders:8000"))
AI_MEMORY_URL = env("AI_MEMORY_BASE_URL", os.getenv("AI_MEMORY_URL", "http://ai-memory:8000"))
MARKETPLACES_URL = env("MARKETPLACES_BASE_URL", os.getenv("MARKETPLACES_URL", "http://marketplaces:8000"))


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


def is_public(request: Request) -> bool:
    path = request.url.path
    if path == "/health":
        return True
    if path == "/auth/token":
        return True
    # UI uses this unauthenticated
    if path.startswith("/plugins"):
        return request.method.upper() == "GET"
    return False


def verify_jwt(request: Request) -> dict[str, Any]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    token = auth.split(" ", 1)[1]
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token).key
        options = {"verify_aud": bool(OIDC_AUDIENCE)}
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
            issuer=OIDC_ISSUER,
            audience=OIDC_AUDIENCE if OIDC_AUDIENCE else None,
            options=options,
        )
    except Exception as e:
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
    if not is_public(request):
        payload = verify_jwt(request)
        user_uuid = str(payload.get("sub"))

    url = f"{upstream_base}{upstream_path}"
    headers = filtered_headers(request.headers.items())
    if user_uuid:
        headers["x-user-uuid"] = user_uuid

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
