"""staff violations

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-08
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_violations (
            id UUID PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            kpk_point_id UUID NULL REFERENCES staff_kpk_points(id) ON DELETE SET NULL,
            comment TEXT NOT NULL DEFAULT '',
            created_by_uuid TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_staff_violations_user_uuid ON staff_violations(user_uuid);"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS staff_violations;")
