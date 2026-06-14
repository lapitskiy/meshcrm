"""add salary cash from revenue to order reports

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_reports",
        sa.Column("salary_cash_from_revenue", sa.Numeric(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("order_reports", "salary_cash_from_revenue")
