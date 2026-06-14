"""add usage counters to order dictionaries

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("service_objects", sa.Column("usage_count", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("work_types", sa.Column("usage_count", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.create_index("idx_service_objects_usage_count", "service_objects", ["usage_count"], unique=False)
    op.create_index("idx_work_types_usage_count", "work_types", ["usage_count"], unique=False)
    op.execute(
        """
        UPDATE service_objects so
        SET usage_count = counts.usage_count
        FROM (
            SELECT service_object_id AS id, COUNT(*)::integer AS usage_count
            FROM orders
            WHERE service_object_id IS NOT NULL
            GROUP BY service_object_id
        ) counts
        WHERE so.id = counts.id
        """
    )
    op.execute(
        """
        UPDATE work_types wt
        SET usage_count = counts.usage_count
        FROM (
            SELECT work_type_id, COUNT(*)::integer AS usage_count
            FROM (
                SELECT DISTINCT o.id AS order_id, item.value::uuid AS work_type_id
                FROM orders o
                CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(o.work_type_ids, '[]'::jsonb)) AS item(value)
            ) used
            GROUP BY work_type_id
        ) counts
        WHERE wt.id = counts.work_type_id
        """
    )


def downgrade() -> None:
    op.drop_index("idx_work_types_usage_count", table_name="work_types")
    op.drop_index("idx_service_objects_usage_count", table_name="service_objects")
    op.drop_column("work_types", "usage_count")
    op.drop_column("service_objects", "usage_count")
