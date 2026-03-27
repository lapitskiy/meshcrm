from uuid import UUID, uuid4

from app.domain.statuses.entity import Status


class PsycopgStatusRepository:
    def __init__(self, conn) -> None:
        self._conn = conn

    def create(self, name: str, color: str) -> Status:
        new_id = uuid4()
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    INSERT INTO statuses (id, name, color, sort_order)
                    VALUES (
                      %s,
                      %s,
                      %s,
                      COALESCE((SELECT MAX(sort_order) + 1 FROM statuses), 1)
                    )
                    RETURNING id, name, color, sort_order, created_at
                    """,
                    (new_id, name, color),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Status with this name already exists") from exc
                raise
            row = cur.fetchone()
        self._conn.commit()
        return Status(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])

    def list_all(self) -> list[Status]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, color, sort_order, created_at
                FROM statuses
                ORDER BY sort_order ASC, created_at ASC
                """
            )
            rows = cur.fetchall()
        return [Status(id=r[0], name=r[1], color=r[2], sort_order=r[3], created_at=r[4]) for r in rows]

    def update(self, status_id: UUID, name: str, color: str) -> Status:
        with self._conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    UPDATE statuses
                    SET name = %s, color = %s
                    WHERE id = %s
                    RETURNING id, name, color, sort_order, created_at
                    """,
                    (name, color, status_id),
                )
            except Exception as exc:
                self._conn.rollback()
                text = str(exc).lower()
                if "duplicate key" in text or "unique" in text:
                    raise ValueError("Status with this name already exists") from exc
                raise
            row = cur.fetchone()
            if row is None:
                self._conn.rollback()
                raise ValueError("Status not found")
        self._conn.commit()
        return Status(id=row[0], name=row[1], color=row[2], sort_order=row[3], created_at=row[4])

    def delete(self, status_id: UUID) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM statuses WHERE id = %s", (status_id,))
            affected = cur.rowcount
        if affected == 0:
            self._conn.rollback()
            raise ValueError("Status not found")
        self._conn.commit()

    def reorder(self, ids_in_order: list[UUID]) -> None:
        with self._conn.cursor() as cur:
            cur.execute("SELECT id FROM statuses")
            existing_ids = {row[0] for row in cur.fetchall()}
            incoming_ids = set(ids_in_order)
            if existing_ids != incoming_ids:
                raise ValueError("Reorder payload must contain all statuses exactly once")
            # Two-phase update avoids unique collisions on sort_order.
            for index, status_id in enumerate(ids_in_order, start=1):
                cur.execute("UPDATE statuses SET sort_order = %s WHERE id = %s", (-index, status_id))
            for index, status_id in enumerate(ids_in_order, start=1):
                cur.execute("UPDATE statuses SET sort_order = %s WHERE id = %s", (index, status_id))
        self._conn.commit()
