"""add work type name to order report lines

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_report_lines",
        sa.Column("work_type_name", sa.Text(), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("order_report_lines", "work_type_name")
