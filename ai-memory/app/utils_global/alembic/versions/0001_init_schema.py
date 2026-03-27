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
        CREATE TABLE IF NOT EXISTS rules (
          rule_uuid UUID PRIMARY KEY,
          rule TEXT NOT NULL,
          enforced BOOLEAN NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS rules;")

