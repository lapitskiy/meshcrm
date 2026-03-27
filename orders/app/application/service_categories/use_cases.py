from uuid import UUID

from app.application.service_categories.dto import CreateServiceCategoryIn, UpdateServiceCategoryIn
from app.domain.service_categories.entity import ServiceCategory
from app.domain.service_categories.repository import ServiceCategoryRepository


class ServiceCategoryUseCases:
    def __init__(self, repo: ServiceCategoryRepository) -> None:
        self._repo = repo

    def create(self, payload: CreateServiceCategoryIn) -> ServiceCategory:
        name = payload.name.strip()
        if not name:
            raise ValueError("Category name must not be empty")
        return self._repo.create(name=name)

    def list_all(self) -> list[ServiceCategory]:
        return self._repo.list_all()

    def update(self, category_id: UUID, payload: UpdateServiceCategoryIn) -> ServiceCategory:
        name = payload.name.strip()
        if not name:
            raise ValueError("Category name must not be empty")
        return self._repo.update(category_id=category_id, name=name)

    def delete(self, category_id: UUID) -> None:
        self._repo.delete(category_id=category_id)
