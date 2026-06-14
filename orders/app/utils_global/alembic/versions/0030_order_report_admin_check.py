"""add admin check to order reports

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_reports", sa.Column("checked_by_admin_uuid", sa.Text(), nullable=True))
    op.add_column("order_reports", sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_order_reports_checked_at", "order_reports", ["checked_at"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_order_reports_checked_at", table_name="order_reports")
    op.drop_column("order_reports", "checked_at")
    op.drop_column("order_reports", "checked_by_admin_uuid")
