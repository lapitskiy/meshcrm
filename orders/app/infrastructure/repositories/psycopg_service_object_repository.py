from uuid import UUID, uuid4

from app.domain.service_objects.entity import ServiceObject


class PsycopgServiceObjectRepository:
    def __init__(self, conn) -> None:
        self._conn = conn

    def create(self, service_category_id: UUID, name: str) -> ServiceObject:
        new_id = uuid4()
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    INSERT INTO service_objects (id, service_category_id, name)
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
                    raise ValueError("Service object with this name already exists in selected category") from exc
                raise
            row = cur.fetchone()
            cur.execute("SELECT name FROM service_categories WHERE id = %s", (row[1],))
            category_row = cur.fetchone()
        self._conn.commit()
        return ServiceObject(
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
    ) -> list[ServiceObject]:
        sql = """
            SELECT so.id, so.service_category_id, sc.name, so.name, so.created_at
            FROM service_objects so
            JOIN service_categories sc ON sc.id = so.service_category_id
        """
        clauses: list[str] = []
        params_list: list = []
        if service_category_id is not None:
            clauses.append("so.service_category_id = %s")
            params_list.append(service_category_id)
        if accessible_category_ids is not None:
            if not accessible_category_ids:
                return []
            clauses.append("so.service_category_id = ANY(%s)")
            params_list.append(accessible_category_ids)
        if name_query:
            clauses.append("so.name ILIKE %s")
            params_list.append(f"%{name_query}%")
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY so.created_at DESC LIMIT %s"
        params_list.append(limit)
        params = tuple(params_list)

        with self._conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return [
            ServiceObject(
                id=row[0],
                service_category_id=row[1],
                service_category_name=row[2],
                name=row[3],
                created_at=row[4],
            )
            for row in rows
        ]

    def update(self, object_id: UUID, service_category_id: UUID, name: str) -> ServiceObject:
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    UPDATE service_objects
                    SET service_category_id = %s, name = %s
                    WHERE id = %s
                    RETURNING id, service_category_id, name, created_at
                    """,
                    (service_category_id, name, object_id),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "violates foreign key" in text:
                    raise ValueError("Service category not found") from exc
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Service object with this name already exists in selected category") from exc
                raise
            row = cur.fetchone()
            if row is None:
                self._conn.rollback()
                raise ValueError("Service object not found")
            cur.execute("SELECT name FROM service_categories WHERE id = %s", (row[1],))
            category_row = cur.fetchone()
        self._conn.commit()
        return ServiceObject(
            id=row[0],
            service_category_id=row[1],
            name=row[2],
            created_at=row[3],
            service_category_name=category_row[0] if category_row else "",
        )

    def delete(self, object_id: UUID) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM service_objects WHERE id = %s", (object_id,))
            affected = cur.rowcount
        if affected == 0:
            self._conn.rollback()
            raise ValueError("Service object not found")
        self._conn.commit()
