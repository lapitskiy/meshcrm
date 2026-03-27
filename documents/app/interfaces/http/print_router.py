import json
from datetime import datetime
from uuid import UUID, uuid4
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.infrastructure.db.connection import get_connection


router = APIRouter(prefix="/print", tags=["print"])

REGISTRY_BASE_URL = "http://plugin-registry:8000"


class PrintFormCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    category_id: UUID | None = None


class PrintFormOut(BaseModel):
    id: UUID
    title: str
    content_json: dict
    content_html: str
    category_id: UUID | None = None
    category_name: str = ""
    created_by_uuid: str | None = None
    created_at: datetime
    updated_at: datetime


class PrintFormUpdateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content_json: dict = Field(default_factory=dict)
    content_html: str = ""
    category_id: UUID | None = None


class PrintFormListItemOut(BaseModel):
    id: UUID
    title: str
    category_id: UUID | None = None
    category_name: str = ""
    updated_at: datetime


class PrintVariableOut(BaseModel):
    module_name: str
    var_key: str
    label: str
    allowed: bool


class PrintCategoryCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PrintCategoryUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PrintCategoryOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    updated_at: datetime


def _user_uuid_from_headers(request: Request) -> str | None:
    value = str(request.headers.get("x-user-uuid", "")).strip()
    return value or None


def _linked_modules_for_documents() -> list[str]:
    try:
        with urlopen(f"{REGISTRY_BASE_URL}/plugins/_links?enabled_only=true", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "[]")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="plugin-registry unavailable") from exc
    out: list[str] = []
    for row in payload or []:
        if row.get("source_module") == "documents" and row.get("enabled") is True:
            target = str(row.get("target_module") or "").strip()
            if target:
                out.append(target)
    return out


@router.get("/variables", response_model=list[PrintVariableOut])
def list_variables(respect_links: bool = True) -> list[PrintVariableOut]:
    allowed_modules: set[str] | None = None
    if respect_links:
        allowed_modules = set(_linked_modules_for_documents())
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT module_name, var_key, label
                FROM print_variable_defs
                WHERE enabled=TRUE
                ORDER BY module_name, var_key
                """
            )
            rows = cur.fetchall()
        out: list[PrintVariableOut] = []
        for r in rows:
            module_name = str(r[0])
            allowed = True if allowed_modules is None else (module_name in allowed_modules)
            out.append(PrintVariableOut(module_name=module_name, var_key=r[1], label=r[2], allowed=allowed))
        return out
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/categories", response_model=list[PrintCategoryOut])
def list_categories(limit: int = 500) -> list[PrintCategoryOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 1000))
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, created_at, updated_at
                FROM print_categories
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (safe_limit,),
            )
            rows = cur.fetchall()
        return [
            PrintCategoryOut(id=UUID(str(r[0])), name=r[1], created_at=r[2], updated_at=r[3])
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("/categories", response_model=PrintCategoryOut, status_code=201)
def create_category(body: PrintCategoryCreateIn) -> PrintCategoryOut:
    conn = None
    try:
        category_id = uuid4()
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO print_categories (id, name, created_at, updated_at)
                VALUES (%s, %s, NOW(), NOW())
                RETURNING id, name, created_at, updated_at
                """,
                (str(category_id), body.name.strip()),
            )
            row = cur.fetchone()
        return PrintCategoryOut(id=UUID(str(row[0])), name=row[1], created_at=row[2], updated_at=row[3])
    except Exception as exc:
        message = str(exc)
        if "uniq_print_categories_name_ci" in message:
            raise HTTPException(status_code=409, detail="category already exists") from exc
        raise HTTPException(status_code=500, detail=message) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/categories/{category_id}", response_model=PrintCategoryOut)
def update_category(category_id: UUID, body: PrintCategoryUpdateIn) -> PrintCategoryOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE print_categories
                SET name=%s, updated_at=NOW()
                WHERE id=%s
                RETURNING id, name, created_at, updated_at
                """,
                (body.name.strip(), str(category_id)),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="category not found")
        return PrintCategoryOut(id=UUID(str(row[0])), name=row[1], created_at=row[2], updated_at=row[3])
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        if "uniq_print_categories_name_ci" in message:
            raise HTTPException(status_code=409, detail="category already exists") from exc
        raise HTTPException(status_code=500, detail=message) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/categories/{category_id}")
def delete_category(category_id: UUID) -> dict:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM print_categories WHERE id=%s", (str(category_id),))
            deleted = cur.rowcount
        if not deleted:
            raise HTTPException(status_code=404, detail="category not found")
        return {"status": "deleted", "id": str(category_id)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("/forms", response_model=PrintFormOut, status_code=201)
def create_form(body: PrintFormCreateIn, request: Request) -> PrintFormOut:
    conn = None
    try:
        form_id = uuid4()
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO print_forms (id, title, content_json, content_html, category_id, created_by_uuid, created_at, updated_at)
                VALUES (%s, %s, %s::jsonb, %s, %s, %s, NOW(), NOW())
                RETURNING id, title, content_json, content_html, category_id, created_by_uuid, created_at, updated_at
                """,
                (
                    str(form_id),
                    body.title.strip(),
                    json.dumps(body.content_json or {}),
                    str(body.content_html or ""),
                    str(body.category_id) if body.category_id else None,
                    _user_uuid_from_headers(request),
                ),
            )
            row = cur.fetchone()
            category_name = ""
            if row[4]:
                cur.execute("SELECT name FROM print_categories WHERE id=%s", (str(row[4]),))
                cat = cur.fetchone()
                category_name = str(cat[0] or "") if cat else ""
        return PrintFormOut(
            id=UUID(str(row[0])),
            title=row[1],
            content_json=row[2] or {},
            content_html=row[3] or "",
            category_id=UUID(str(row[4])) if row[4] else None,
            category_name=category_name,
            created_by_uuid=row[5],
            created_at=row[6],
            updated_at=row[7],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/forms", response_model=list[PrintFormListItemOut])
def list_forms(limit: int = 200) -> list[PrintFormListItemOut]:
    conn = None
    try:
        safe_limit = max(1, min(int(limit), 500))
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT f.id, f.title, f.category_id, COALESCE(c.name, ''), f.updated_at
                FROM print_forms f
                LEFT JOIN print_categories c ON c.id = f.category_id
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (safe_limit,),
            )
            rows = cur.fetchall()
        return [
            PrintFormListItemOut(
                id=UUID(str(r[0])),
                title=r[1],
                category_id=UUID(str(r[2])) if r[2] else None,
                category_name=r[3] or "",
                updated_at=r[4],
            )
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.get("/forms/{form_id}", response_model=PrintFormOut)
def get_form(form_id: UUID) -> PrintFormOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT f.id, f.title, f.content_json, f.content_html, f.category_id, COALESCE(c.name, ''),
                       f.created_by_uuid, f.created_at, f.updated_at
                FROM print_forms f
                LEFT JOIN print_categories c ON c.id = f.category_id
                WHERE f.id=%s
                """,
                (str(form_id),),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="form not found")
        return PrintFormOut(
            id=UUID(str(row[0])),
            title=row[1],
            content_json=row[2] or {},
            content_html=row[3] or "",
            category_id=UUID(str(row[4])) if row[4] else None,
            category_name=row[5] or "",
            created_by_uuid=row[6],
            created_at=row[7],
            updated_at=row[8],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/forms/{form_id}", response_model=PrintFormOut)
def update_form(form_id: UUID, body: PrintFormUpdateIn) -> PrintFormOut:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE print_forms
                SET title=%s, content_json=%s::jsonb, content_html=%s, category_id=%s, updated_at=NOW()
                WHERE id=%s
                RETURNING id, title, content_json, content_html, category_id, created_by_uuid, created_at, updated_at
                """,
                (
                    body.title.strip(),
                    json.dumps(body.content_json or {}),
                    str(body.content_html or ""),
                    str(body.category_id) if body.category_id else None,
                    str(form_id),
                ),
            )
            row = cur.fetchone()
            category_name = ""
            if row and row[4]:
                cur.execute("SELECT name FROM print_categories WHERE id=%s", (str(row[4]),))
                cat = cur.fetchone()
                category_name = str(cat[0] or "") if cat else ""
        if not row:
            raise HTTPException(status_code=404, detail="form not found")
        return PrintFormOut(
            id=UUID(str(row[0])),
            title=row[1],
            content_json=row[2] or {},
            content_html=row[3] or "",
            category_id=UUID(str(row[4])) if row[4] else None,
            category_name=category_name,
            created_by_uuid=row[5],
            created_at=row[6],
            updated_at=row[7],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/forms/{form_id}")
def delete_form(form_id: UUID) -> dict:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM print_forms WHERE id=%s", (str(form_id),))
            deleted = cur.rowcount
        if not deleted:
            raise HTTPException(status_code=404, detail="form not found")
        return {"status": "deleted", "id": str(form_id)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()

