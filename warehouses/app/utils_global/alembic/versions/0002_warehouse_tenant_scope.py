"""add tenant scope to warehouses

Revision ID: 0002_warehouse_tenant_scope
Revises: 0001_init_warehouses_acl
Create Date: 2026-05-14
"""

from typing import Union

from alembic import op

revision: str = "0002_warehouse_tenant_scope"
down_revision: Union[str, None] = "0001_init_warehouses_acl"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS tenant_id TEXT")
    op.execute("ALTER TABLE warehouse_access ADD COLUMN IF NOT EXISTS tenant_id TEXT")
    op.execute("ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_name_key")
    op.execute("CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_created_at ON warehouses(tenant_id, created_at)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_tenant_name ON warehouses(tenant_id, name)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_warehouse_access_tenant_user_uuid ON warehouse_access(tenant_id, user_uuid)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_warehouse_access_tenant_user_uuid")
    op.execute("DROP INDEX IF EXISTS idx_warehouses_tenant_name")
    op.execute("DROP INDEX IF EXISTS idx_warehouses_tenant_created_at")
    op.execute("ALTER TABLE warehouse_access DROP COLUMN IF EXISTS tenant_id")
    op.execute("ALTER TABLE warehouses DROP COLUMN IF EXISTS tenant_id")
