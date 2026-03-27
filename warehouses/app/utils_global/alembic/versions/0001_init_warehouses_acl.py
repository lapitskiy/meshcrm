"""init warehouses acl

Revision ID: 0001_init_warehouses_acl
Revises:
Create Date: 2026-03-26 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_init_warehouses_acl"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS warehouses (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS warehouse_access (
          warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
          user_uuid TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'viewer',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (warehouse_id, user_uuid)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_warehouse_access_user_uuid ON warehouse_access(user_uuid);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_warehouse_access_user_uuid;")
    op.execute("DROP TABLE IF EXISTS warehouse_access;")
    op.execute("DROP TABLE IF EXISTS warehouses;")
