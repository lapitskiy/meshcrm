"""attendance auto close fields

Revision ID: 0002_attendance_auto_close
Revises: 0001_init_staff_schema
Create Date: 2026-04-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_attendance_auto_close"
down_revision: Union[str, None] = "0001_init_staff_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS close_comment TEXT NOT NULL DEFAULT '';")
    op.execute(
        "ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS closed_automatically BOOLEAN NOT NULL DEFAULT FALSE;"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS closed_automatically;")
    op.execute("ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS close_comment;")
