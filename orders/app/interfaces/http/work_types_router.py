from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.application.work_types.dto import CreateWorkTypeIn, UpdateWorkTypeIn, WorkTypeOut
from app.application.work_types.use_cases import WorkTypeUseCases
from app.infrastructure.db.connection import get_connection
from app.infrastructure.repositories.psycopg_work_type_repository import PsycopgWorkTypeRepository

router = APIRouter(prefix="/settings/work-types", tags=["orders-work-types"])


@router.get("", response_model=list[WorkTypeOut])
def list_work_types(
    service_category_id: UUID | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[WorkTypeOut]:
    conn = None
    try:
        conn = get_connection()
        use_cases = WorkTypeUseCases(PsycopgWorkTypeRepository(conn))
        return [
            WorkTypeOut.model_validate(item)
            for item in use_cases.list_all(
                service_category_id=service_category_id,
                name_query=q,
                limit=limit,
            )
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("", response_model=WorkTypeOut, status_code=201)
def create_work_type(payload: CreateWorkTypeIn) -> WorkTypeOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = WorkTypeUseCases(PsycopgWorkTypeRepository(conn))
        return WorkTypeOut.model_validate(use_cases.create(payload))
    except ValueError as exc:
        message = str(exc)
        if message == "Service category not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{work_type_id}", response_model=WorkTypeOut)
def update_work_type(work_type_id: UUID, payload: UpdateWorkTypeIn) -> WorkTypeOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = WorkTypeUseCases(PsycopgWorkTypeRepository(conn))
        return WorkTypeOut.model_validate(use_cases.update(work_type_id=work_type_id, payload=payload))
    except ValueError as exc:
        message = str(exc)
        if message in ("Service category not found", "Work type not found"):
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/{work_type_id}", status_code=204)
def delete_work_type(work_type_id: UUID) -> None:
    conn = None
    try:
        conn = get_connection()
        use_cases = WorkTypeUseCases(PsycopgWorkTypeRepository(conn))
        use_cases.delete(work_type_id=work_type_id)
    except ValueError as exc:
        message = str(exc)
        if message == "Work type not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()
