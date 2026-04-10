"""remove display statuses from settings

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-10
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM statuses
        WHERE name IN ('Выполнено', 'Принят в ремонт')
        """
    )


def downgrade() -> None:
    pass
