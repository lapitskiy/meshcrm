from uuid import UUID, uuid4

from app.domain.work_types.entity import WorkType


class PsycopgWorkTypeRepository:
    def __init__(self, conn) -> None:
        self._conn = conn

    def create(self, service_category_id: UUID, name: str) -> WorkType:
        new_id = uuid4()
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    INSERT INTO work_types (id, service_category_id, name)
                    VALUES (%s, %s, %s)
                    RETURNING id, service_category_id, name, created_at
                    """,
                    (new_id, service_category_id, name),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "violates foreign key" in text:
                    raise ValueError("Service category not found") from exc
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Work type with this name already exists in selected category") from exc
                raise
            row = cur.fetchone()
            cur.execute("SELECT name FROM service_categories WHERE id = %s", (row[1],))
            category_row = cur.fetchone()
        self._conn.commit()
        return WorkType(
            id=row[0],
            service_category_id=row[1],
            name=row[2],
            created_at=row[3],
            service_category_name=category_row[0] if category_row else "",
        )

    def list_all(
        self,
        service_category_id: UUID | None = None,
        accessible_category_ids: list[UUID] | None = None,
        name_query: str | None = None,
        limit: int = 100,
    ) -> list[WorkType]:
        sql = """
            SELECT wt.id, wt.service_category_id, sc.name, wt.name, wt.created_at
            FROM work_types wt
            JOIN service_categories sc ON sc.id = wt.service_category_id
        """
        clauses: list[str] = []
        params_list: list = []
        if service_category_id is not None:
            clauses.append("wt.service_category_id = %s")
            params_list.append(service_category_id)
        if accessible_category_ids is not None:
            if not accessible_category_ids:
                return []
            clauses.append("wt.service_category_id = ANY(%s)")
            params_list.append(accessible_category_ids)
        if name_query:
            clauses.append("wt.name ILIKE %s")
            params_list.append(f"%{name_query}%")
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY wt.created_at DESC LIMIT %s"
        params_list.append(limit)
        params = tuple(params_list)

        with self._conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return [
            WorkType(
                id=row[0],
                service_category_id=row[1],
                service_category_name=row[2],
                name=row[3],
                created_at=row[4],
            )
            for row in rows
        ]

    def update(self, work_type_id: UUID, service_category_id: UUID, name: str) -> WorkType:
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    UPDATE work_types
                    SET service_category_id = %s, name = %s
                    WHERE id = %s
                    RETURNING id, service_category_id, name, created_at
                    """,
                    (service_category_id, name, work_type_id),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "violates foreign key" in text:
                    raise ValueError("Service category not found") from exc
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Work type with this name already exists in selected category") from exc
                raise
            row = cur.fetchone()
            if row is None:
                self._conn.rollback()
                raise ValueError("Work type not found")
            cur.execute("SELECT name FROM service_categories WHERE id = %s", (row[1],))
            category_row = cur.fetchone()
        self._conn.commit()
        return WorkType(
            id=row[0],
            service_category_id=row[1],
            name=row[2],
            created_at=row[3],
            service_category_name=category_row[0] if category_row else "",
        )

    def delete(self, work_type_id: UUID) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM work_types WHERE id = %s", (work_type_id,))
            affected = cur.rowcount
        if affected == 0:
            self._conn.rollback()
            raise ValueError("Work type not found")
        self._conn.commit()
