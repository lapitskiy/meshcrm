from uuid import UUID

from app.application.statuses.dto import CreateStatusIn, UpdateStatusIn
from app.domain.statuses.entity import Status
from app.domain.statuses.repository import StatusRepository


class StatusUseCases:
    def __init__(self, repo: StatusRepository) -> None:
        self._repo = repo

    def create(self, payload: CreateStatusIn) -> Status:
        name = payload.name.strip()
        if not name:
            raise ValueError("Status name must not be empty")
        return self._repo.create(name=name, color=payload.color)

    def list_all(self) -> list[Status]:
        return self._repo.list_all()

    def update(self, status_id: UUID, payload: UpdateStatusIn) -> Status:
        name = payload.name.strip()
        if not name:
            raise ValueError("Status name must not be empty")
        return self._repo.update(status_id=status_id, name=name, color=payload.color)

    def delete(self, status_id: UUID) -> None:
        self._repo.delete(status_id=status_id)

    def reorder(self, ids_in_order: list[UUID]) -> None:
        if not ids_in_order:
            return
        self._repo.reorder(ids_in_order)
