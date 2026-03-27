"""create work_types table

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["service_category_id"], ["service_categories.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_category_id", "name", name="uq_work_types_category_name"),
    )


def downgrade() -> None:
    op.drop_table("work_types")
