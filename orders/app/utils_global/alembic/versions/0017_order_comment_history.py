"""create order comment history

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_comment_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_order_comment_history_order_id_created_at",
        "order_comment_history",
        ["order_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_order_comment_history_order_id_created_at", table_name="order_comment_history")
    op.drop_table("order_comment_history")
