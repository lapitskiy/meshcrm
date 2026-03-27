from app.domain.service_categories.entity import ServiceCategory
import uuid


class PsycopgServiceCategoryRepository:
    def __init__(self, conn) -> None:
        self._conn = conn

    def create(self, name: str) -> ServiceCategory:
        new_id = uuid.uuid4()
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    INSERT INTO service_categories (id, name)
                    VALUES (%s, %s)
                    RETURNING id, name, created_at
                    """,
                    (new_id, name),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Category with this name already exists") from exc
                raise
            row = cur.fetchone()
        self._conn.commit()
        return ServiceCategory(id=row[0], name=row[1], created_at=row[2])

    def list_all(self) -> list[ServiceCategory]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, created_at
                FROM service_categories
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()
        return [ServiceCategory(id=row[0], name=row[1], created_at=row[2]) for row in rows]

    def update(self, category_id: uuid.UUID, name: str) -> ServiceCategory:
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    UPDATE service_categories
                    SET name = %s
                    WHERE id = %s
                    RETURNING id, name, created_at
                    """,
                    (name, category_id),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Category with this name already exists") from exc
                raise
            row = cur.fetchone()
        if row is None:
            self._conn.rollback()
            raise ValueError("Category not found")
        self._conn.commit()
        return ServiceCategory(id=row[0], name=row[1], created_at=row[2])

    def delete(self, category_id: uuid.UUID) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM service_categories WHERE id = %s", (category_id,))
            affected = cur.rowcount
        if affected == 0:
            self._conn.rollback()
            raise ValueError("Category not found")
        self._conn.commit()
