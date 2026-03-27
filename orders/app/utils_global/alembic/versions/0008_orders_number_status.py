"""add order_number and status to orders

Revision ID: 0008
Revises: 0007
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number BIGSERIAL")
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Новый'")
    op.execute("UPDATE orders SET status = 'Новый' WHERE status IS NULL OR status = ''")
    op.execute("UPDATE orders SET order_number = nextval(pg_get_serial_sequence('orders', 'order_number')) WHERE order_number IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_number ON orders(order_number)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_orders_order_number")
    op.execute("ALTER TABLE orders DROP COLUMN IF EXISTS status")
    op.execute("ALTER TABLE orders DROP COLUMN IF EXISTS order_number")
