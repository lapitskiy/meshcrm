"""add display_status to orders

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-10
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("display_status", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE orders
        SET display_status = CASE
            WHEN order_kind = 'onsite' THEN 'Выполнено'
            WHEN order_kind = 'repair' THEN 'Принят в ремонт'
            ELSE NULL
        END
        WHERE display_status IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("orders", "display_status")
