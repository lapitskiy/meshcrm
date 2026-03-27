from typing import Protocol
from uuid import UUID

from app.domain.work_types.entity import WorkType


class WorkTypeRepository(Protocol):
    def create(self, service_category_id: UUID, name: str) -> WorkType: ...

    def list_all(
        self,
        service_category_id: UUID | None = None,
        name_query: str | None = None,
        limit: int = 100,
    ) -> list[WorkType]: ...

    def update(self, work_type_id: UUID, service_category_id: UUID, name: str) -> WorkType: ...

    def delete(self, work_type_id: UUID) -> None: ...
