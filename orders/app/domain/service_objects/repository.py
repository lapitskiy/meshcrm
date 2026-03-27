from typing import Protocol
from uuid import UUID

from app.domain.service_objects.entity import ServiceObject


class ServiceObjectRepository(Protocol):
    def create(self, service_category_id: UUID, name: str) -> ServiceObject: ...

    def list_all(
        self,
        service_category_id: UUID | None = None,
        name_query: str | None = None,
        limit: int = 100,
    ) -> list[ServiceObject]: ...

    def update(self, object_id: UUID, service_category_id: UUID, name: str) -> ServiceObject: ...

    def delete(self, object_id: UUID) -> None: ...
