"""create service_category_access table

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_category_access",
        sa.Column("service_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_uuid", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["service_category_id"], ["service_categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("service_category_id", "user_uuid", name="pk_service_category_access"),
    )
    op.create_index(
        "idx_service_category_access_user_uuid",
        "service_category_access",
        ["user_uuid"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_service_category_access_user_uuid", table_name="service_category_access")
    op.drop_table("service_category_access")
