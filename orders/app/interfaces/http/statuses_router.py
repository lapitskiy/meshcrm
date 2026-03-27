from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.application.statuses.dto import CreateStatusIn, ReorderStatusesIn, StatusOut, UpdateStatusIn
from app.application.statuses.use_cases import StatusUseCases
from app.infrastructure.db.connection import get_connection
from app.infrastructure.repositories.psycopg_status_repository import PsycopgStatusRepository

router = APIRouter(prefix="/settings/statuses", tags=["orders-statuses"])


@router.get("", response_model=list[StatusOut])
def list_statuses() -> list[StatusOut]:
    conn = None
    try:
        conn = get_connection()
        use_cases = StatusUseCases(PsycopgStatusRepository(conn))
        return [StatusOut.model_validate(item) for item in use_cases.list_all()]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("", response_model=StatusOut, status_code=201)
def create_status(payload: CreateStatusIn) -> StatusOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = StatusUseCases(PsycopgStatusRepository(conn))
        return StatusOut.model_validate(use_cases.create(payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.put("/{status_id}", response_model=StatusOut)
def update_status(status_id: UUID, payload: UpdateStatusIn) -> StatusOut:
    conn = None
    try:
        conn = get_connection()
        use_cases = StatusUseCases(PsycopgStatusRepository(conn))
        return StatusOut.model_validate(use_cases.update(status_id=status_id, payload=payload))
    except ValueError as exc:
        message = str(exc)
        if message == "Status not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.delete("/{status_id}", status_code=204)
def delete_status(status_id: UUID) -> None:
    conn = None
    try:
        conn = get_connection()
        use_cases = StatusUseCases(PsycopgStatusRepository(conn))
        use_cases.delete(status_id=status_id)
    except ValueError as exc:
        message = str(exc)
        if message == "Status not found":
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()


@router.post("/reorder", status_code=204)
def reorder_statuses(payload: ReorderStatusesIn) -> None:
    conn = None
    try:
        conn = get_connection()
        use_cases = StatusUseCases(PsycopgStatusRepository(conn))
        use_cases.reorder(ids_in_order=payload.ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if conn is not None:
            conn.close()
