"""block duplicate order reports per user day warehouse

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-29
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_duplicate_order_report()
        RETURNS trigger AS $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM order_reports r
                WHERE r.report_date = NEW.report_date
                  AND r.warehouse_id = NEW.warehouse_id
                  AND r.created_by_uuid = NEW.created_by_uuid
                  AND r.id <> NEW.id
            ) THEN
                RAISE unique_violation USING MESSAGE = 'duplicate order report for user, date and warehouse';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_duplicate_order_report
        BEFORE INSERT OR UPDATE OF report_date, warehouse_id, created_by_uuid
        ON order_reports
        FOR EACH ROW
        EXECUTE FUNCTION prevent_duplicate_order_report();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_duplicate_order_report ON order_reports")
    op.execute("DROP FUNCTION IF EXISTS prevent_duplicate_order_report()")
