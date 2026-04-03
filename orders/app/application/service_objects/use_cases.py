from uuid import UUID

from app.application.service_objects.dto import CreateServiceObjectIn, UpdateServiceObjectIn
from app.domain.service_objects.entity import ServiceObject
from app.domain.service_objects.repository import ServiceObjectRepository


class ServiceObjectUseCases:
    def __init__(self, repo: ServiceObjectRepository) -> None:
        self._repo = repo

    def create(self, payload: CreateServiceObjectIn) -> ServiceObject:
        name = payload.name.strip()
        if not name:
            raise ValueError("Service object name must not be empty")
        return self._repo.create(service_category_id=payload.service_category_id, name=name)

    def list_all(
        self,
        service_category_id: UUID | None = None,
        accessible_category_ids: list[UUID] | None = None,
        name_query: str | None = None,
        limit: int = 100,
    ) -> list[ServiceObject]:
        return self._repo.list_all(
            service_category_id=service_category_id,
            accessible_category_ids=accessible_category_ids,
            name_query=name_query,
            limit=limit,
        )

    def update(self, object_id: UUID, payload: UpdateServiceObjectIn) -> ServiceObject:
        name = payload.name.strip()
        if not name:
            raise ValueError("Service object name must not be empty")
        return self._repo.update(
            object_id=object_id,
            service_category_id=payload.service_category_id,
            name=name,
        )

    def delete(self, object_id: UUID) -> None:
        self._repo.delete(object_id=object_id)
