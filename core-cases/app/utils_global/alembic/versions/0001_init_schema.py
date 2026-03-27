"""init schema

Revision ID: 0001
Revises:
Create Date: 2026-01-26
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cases (
          case_uuid UUID PRIMARY KEY,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          created_by UUID NULL
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cases;")

