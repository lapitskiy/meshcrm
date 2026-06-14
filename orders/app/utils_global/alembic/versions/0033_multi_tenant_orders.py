"""add tenant scope to orders data

Revision ID: 0033
Revises: 0032
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


TENANT_TABLES = [
    "orders",
    "order_status_history",
    "order_issue_history",
    "order_comment_history",
    "order_photo_history",
    "order_callback_reminders",
    "supply_requests",
    "supply_request_photos",
    "supply_request_status_history",
    "supply_request_comment_history",
    "order_reports",
    "order_report_lines",
    "order_report_issue_history",
    "order_report_comment_history",
]


def upgrade() -> None:
    for table_name in TENANT_TABLES:
        op.add_column(table_name, sa.Column("tenant_id", sa.Text(), nullable=True))

    op.create_index("idx_orders_tenant_created_at", "orders", ["tenant_id", "created_at"], unique=False)
    op.create_index("idx_orders_tenant_status", "orders", ["tenant_id", "status"], unique=False)
    op.create_index("idx_orders_tenant_warehouse", "orders", ["tenant_id", "warehouse_id"], unique=False)
    op.create_index("idx_orders_tenant_creator", "orders", ["tenant_id", "created_by_uuid"], unique=False)
    op.create_index("idx_order_reports_tenant_date", "order_reports", ["tenant_id", "report_date"], unique=False)
    op.create_index("idx_supply_requests_tenant_created_at", "supply_requests", ["tenant_id", "created_at"], unique=False)
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_duplicate_order_report ON order_reports")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_duplicate_order_report()
        RETURNS trigger AS $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM order_reports r
                WHERE r.tenant_id = NEW.tenant_id
                  AND r.report_date = NEW.report_date
                  AND r.warehouse_id = NEW.warehouse_id
                  AND r.created_by_uuid = NEW.created_by_uuid
                  AND r.id <> NEW.id
            ) THEN
                RAISE unique_violation;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_duplicate_order_report
        BEFORE INSERT OR UPDATE OF tenant_id, report_date, warehouse_id, created_by_uuid
        ON order_reports
        FOR EACH ROW
        EXECUTE FUNCTION prevent_duplicate_order_report();
        """
    )


def downgrade() -> None:
    op.drop_index("idx_supply_requests_tenant_created_at", table_name="supply_requests")
    op.drop_index("idx_order_reports_tenant_date", table_name="order_reports")
    op.drop_index("idx_orders_tenant_creator", table_name="orders")
    op.drop_index("idx_orders_tenant_warehouse", table_name="orders")
    op.drop_index("idx_orders_tenant_status", table_name="orders")
    op.drop_index("idx_orders_tenant_created_at", table_name="orders")
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_duplicate_order_report ON order_reports")

    for table_name in reversed(TENANT_TABLES):
        op.drop_column(table_name, "tenant_id")
