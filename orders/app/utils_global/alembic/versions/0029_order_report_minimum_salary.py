"""add minimum salary to order reports

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_reports",
        sa.Column("minimum_salary", sa.Numeric(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("order_reports", "minimum_salary")
