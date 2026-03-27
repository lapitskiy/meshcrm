from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.service_categories.entity import ServiceCategory
from app.infrastructure.db.models import ServiceCategoryModel


class SqlAlchemyServiceCategoryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, name: str) -> ServiceCategory:
        model = ServiceCategoryModel(name=name)
        self._session.add(model)
        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise ValueError("Category with this name already exists") from exc
        self._session.refresh(model)
        return ServiceCategory(id=model.id, name=model.name, created_at=model.created_at)

    def list_all(self) -> list[ServiceCategory]:
        rows = self._session.execute(select(ServiceCategoryModel).order_by(ServiceCategoryModel.created_at.desc())).scalars().all()
        return [ServiceCategory(id=row.id, name=row.name, created_at=row.created_at) for row in rows]
