"""create orders table

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_kind", sa.String(length=50), nullable=False),
        sa.Column("service_category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("service_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("serial_model", sa.Text(), nullable=False, server_default=""),
        sa.Column("work_type_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("contact_uuid", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("related_modules", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["service_category_id"], ["service_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["service_object_id"], ["service_objects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_orders_created_at", "orders", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_orders_created_at", table_name="orders")
    op.drop_table("orders")
