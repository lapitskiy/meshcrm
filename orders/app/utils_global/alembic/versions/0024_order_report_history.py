"""add order report comments and issues

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_reports", sa.Column("issue_kind", sa.Text(), nullable=True))

    op.create_table(
        "order_report_issue_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("issue_kind", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["order_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_order_report_issue_history_report_id_created_at",
        "order_report_issue_history",
        ["report_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "order_report_comment_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["order_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_order_report_comment_history_report_id_created_at",
        "order_report_comment_history",
        ["report_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_order_report_comment_history_report_id_created_at", table_name="order_report_comment_history")
    op.drop_table("order_report_comment_history")
    op.drop_index("idx_order_report_issue_history_report_id_created_at", table_name="order_report_issue_history")
    op.drop_table("order_report_issue_history")
    op.drop_column("order_reports", "issue_kind")
