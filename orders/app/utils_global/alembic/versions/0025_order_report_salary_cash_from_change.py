"""add salary cash from change to order reports

Revision ID: 0025
Revises: 0024
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_reports",
        sa.Column("salary_cash_from_change", sa.Numeric(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("order_reports", "salary_cash_from_change")
