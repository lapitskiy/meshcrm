"""drop default status from orders

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-29
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ALTER COLUMN status DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'Новый'")
