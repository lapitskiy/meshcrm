"""add supply request display status history

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("supply_requests", sa.Column("display_status", sa.Text(), nullable=True))
    op.create_table(
        "supply_request_status_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("supply_request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["supply_request_id"], ["supply_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_supply_request_status_history_request_id_changed_at",
        "supply_request_status_history",
        ["supply_request_id", "changed_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_supply_request_status_history_request_id_changed_at", table_name="supply_request_status_history")
    op.drop_table("supply_request_status_history")
    op.drop_column("supply_requests", "display_status")
