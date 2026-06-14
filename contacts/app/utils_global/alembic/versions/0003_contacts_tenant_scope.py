"""add tenant scope to contacts

Revision ID: 0003_contacts_tenant_scope
Revises: 0002
Create Date: 2026-05-14
"""

from typing import Union

from alembic import op

revision: str = "0003_contacts_tenant_scope"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id TEXT")
    op.execute("ALTER TABLE contacts DROP CONSTRAINT IF EXISTS uq_contacts_phone")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON contacts(tenant_id, phone)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created_at ON contacts(tenant_id, created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_contacts_tenant_created_at")
    op.execute("DROP INDEX IF EXISTS idx_contacts_tenant_phone")
    op.execute("ALTER TABLE contacts DROP COLUMN IF EXISTS tenant_id")
