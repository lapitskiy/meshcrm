"""add order issue tracking

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("issue_kind", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "ck_orders_issue_kind",
        "orders",
        "issue_kind IS NULL OR issue_kind IN ('return', 'problem')",
    )
    op.create_index("idx_orders_issue_kind", "orders", ["issue_kind"], unique=False)

    op.create_table(
        "order_issue_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("issue_kind", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("issue_kind IN ('return', 'problem')", name="ck_order_issue_history_issue_kind"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_order_issue_history_order_id_created_at",
        "order_issue_history",
        ["order_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_order_issue_history_order_id_created_at", table_name="order_issue_history")
    op.drop_table("order_issue_history")
    op.drop_index("idx_orders_issue_kind", table_name="orders")
    op.drop_constraint("ck_orders_issue_kind", "orders", type_="check")
    op.drop_column("orders", "issue_kind")
