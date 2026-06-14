"""create recommended_prices table

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommended_prices",
        sa.Column("service_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("work_type_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recommended_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["service_category_id"], ["service_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["service_object_id"], ["service_objects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["work_type_id"], ["work_types.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint(
            "service_category_id",
            "service_object_id",
            "work_type_id",
            name="pk_recommended_prices",
        ),
    )
    op.create_index(
        "ix_recommended_prices_service_object_id",
        "recommended_prices",
        ["service_object_id"],
        unique=False,
    )
    op.create_index(
        "ix_recommended_prices_work_type_id",
        "recommended_prices",
        ["work_type_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_recommended_prices_work_type_id", table_name="recommended_prices")
    op.drop_index("ix_recommended_prices_service_object_id", table_name="recommended_prices")
    op.drop_table("recommended_prices")
