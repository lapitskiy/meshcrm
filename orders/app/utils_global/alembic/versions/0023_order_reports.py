"""create order reports

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_number", sa.Integer(), sa.Identity(start=1), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("total_revenue", sa.Numeric(), server_default="0", nullable=False),
        sa.Column("total_master_salary", sa.Numeric(), server_default="0", nullable=False),
        sa.Column("total_cash_remainder", sa.Numeric(), server_default="0", nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_number"),
    )
    op.create_index("idx_order_reports_report_date", "order_reports", ["report_date"], unique=False)
    op.create_index("idx_order_reports_warehouse_id", "order_reports", ["warehouse_id"], unique=False)
    op.create_index("idx_order_reports_created_by_uuid", "order_reports", ["created_by_uuid"], unique=False)
    op.create_index("idx_order_reports_created_at", "order_reports", ["created_at"], unique=False)

    op.create_table(
        "order_report_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_number", sa.Integer(), nullable=True),
        sa.Column("service_name", sa.Text(), nullable=False),
        sa.Column("service_object_name", sa.Text(), nullable=False),
        sa.Column("revenue", sa.Numeric(), server_default="0", nullable=False),
        sa.Column("cost_price", sa.Numeric(), server_default="0", nullable=False),
        sa.Column("comment", sa.Text(), server_default="", nullable=False),
        sa.Column("profit_percent", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_old_order", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["order_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_order_report_lines_report_id_sort_order", "order_report_lines", ["report_id", "sort_order"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_order_report_lines_report_id_sort_order", table_name="order_report_lines")
    op.drop_table("order_report_lines")
    op.drop_index("idx_order_reports_created_at", table_name="order_reports")
    op.drop_index("idx_order_reports_created_by_uuid", table_name="order_reports")
    op.drop_index("idx_order_reports_warehouse_id", table_name="order_reports")
    op.drop_index("idx_order_reports_report_date", table_name="order_reports")
    op.drop_table("order_reports")
