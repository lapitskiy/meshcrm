from uuid import UUID

from app.application.work_types.dto import CreateWorkTypeIn, UpdateWorkTypeIn
from app.domain.work_types.entity import WorkType
from app.domain.work_types.repository import WorkTypeRepository


class WorkTypeUseCases:
    def __init__(self, repo: WorkTypeRepository) -> None:
        self._repo = repo

    def create(self, payload: CreateWorkTypeIn) -> WorkType:
        name = payload.name.strip()
        if not name:
            raise ValueError("Work type name must not be empty")
        return self._repo.create(service_category_id=payload.service_category_id, name=name)

    def list_all(
        self,
        service_category_id: UUID | None = None,
        accessible_category_ids: list[UUID] | None = None,
        name_query: str | None = None,
        limit: int = 100,
    ) -> list[WorkType]:
        return self._repo.list_all(
            service_category_id=service_category_id,
            accessible_category_ids=accessible_category_ids,
            name_query=name_query,
            limit=limit,
        )

    def update(self, work_type_id: UUID, payload: UpdateWorkTypeIn) -> WorkType:
        name = payload.name.strip()
        if not name:
            raise ValueError("Work type name must not be empty")
        return self._repo.update(
            work_type_id=work_type_id,
            service_category_id=payload.service_category_id,
            name=name,
        )

    def delete(self, work_type_id: UUID) -> None:
        self._repo.delete(work_type_id=work_type_id)
