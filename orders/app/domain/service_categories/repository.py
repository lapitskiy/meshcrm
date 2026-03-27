from typing import Protocol
from uuid import UUID

from app.domain.service_categories.entity import ServiceCategory


class ServiceCategoryRepository(Protocol):
    def create(self, name: str) -> ServiceCategory: ...

    def list_all(self) -> list[ServiceCategory]: ...

    def update(self, category_id: UUID, name: str) -> ServiceCategory: ...

    def delete(self, category_id: UUID) -> None: ...
