"""create supply requests

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "supply_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_text", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["service_category_id"], ["service_categories.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_supply_requests_created_at",
        "supply_requests",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "idx_supply_requests_order_id_created_at",
        "supply_requests",
        ["order_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "supply_request_photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("supply_request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["supply_request_id"], ["supply_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_supply_request_photos_request_id_created_at",
        "supply_request_photos",
        ["supply_request_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_supply_request_photos_request_id_created_at", table_name="supply_request_photos")
    op.drop_table("supply_request_photos")
    op.drop_index("idx_supply_requests_order_id_created_at", table_name="supply_requests")
    op.drop_index("idx_supply_requests_created_at", table_name="supply_requests")
    op.drop_table("supply_requests")
