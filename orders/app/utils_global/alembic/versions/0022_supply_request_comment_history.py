"""add supply request comment history

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "supply_request_comment_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("supply_request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_by_uuid", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["supply_request_id"], ["supply_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_supply_request_comment_history_request_id_created_at",
        "supply_request_comment_history",
        ["supply_request_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_supply_request_comment_history_request_id_created_at", table_name="supply_request_comment_history")
    op.drop_table("supply_request_comment_history")
