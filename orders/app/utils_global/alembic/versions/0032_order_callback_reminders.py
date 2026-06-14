"""add order callback reminders

Revision ID: 0032
Revises: 0031
Create Date: 2026-05-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_callback_reminders",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("callback_date", sa.Date(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_order_callback_reminders_due", "order_callback_reminders", ["active", "callback_date"], unique=False)
    op.create_index("idx_order_callback_reminders_order_id", "order_callback_reminders", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_order_callback_reminders_order_id", table_name="order_callback_reminders")
    op.drop_index("idx_order_callback_reminders_due", table_name="order_callback_reminders")
    op.drop_table("order_callback_reminders")
