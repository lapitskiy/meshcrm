"""init staff schema

Revision ID: 0001_init_staff_schema
Revises:
Create Date: 2026-04-17 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_init_staff_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_branches (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          address TEXT NOT NULL DEFAULT '',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_schedules (
          id UUID PRIMARY KEY,
          user_uuid TEXT NOT NULL,
          branch_id UUID NULL REFERENCES staff_branches(id) ON DELETE SET NULL,
          name TEXT NOT NULL DEFAULT '',
          weekday INTEGER NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (weekday BETWEEN 0 AND 6)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance_sessions (
          id UUID PRIMARY KEY,
          user_uuid TEXT NOT NULL,
          branch_id UUID NULL REFERENCES staff_branches(id) ON DELETE SET NULL,
          schedule_id UUID NULL REFERENCES staff_schedules(id) ON DELETE SET NULL,
          work_date DATE NOT NULL,
          check_in_at TIMESTAMPTZ NOT NULL,
          check_out_at TIMESTAMPTZ NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          comment TEXT NOT NULL DEFAULT '',
          close_comment TEXT NOT NULL DEFAULT '',
          closed_automatically BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_staff_schedules_user_uuid_weekday ON staff_schedules(user_uuid, weekday);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_attendance_sessions_user_uuid_work_date ON attendance_sessions(user_uuid, work_date);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_attendance_sessions_branch_id_work_date ON attendance_sessions(branch_id, work_date);"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_open_session_per_user
        ON attendance_sessions(user_uuid)
        WHERE check_out_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_attendance_open_session_per_user;")
    op.execute("DROP INDEX IF EXISTS idx_attendance_sessions_branch_id_work_date;")
    op.execute("DROP INDEX IF EXISTS idx_attendance_sessions_user_uuid_work_date;")
    op.execute("DROP INDEX IF EXISTS idx_staff_schedules_user_uuid_weekday;")
    op.execute("DROP TABLE IF EXISTS attendance_sessions;")
    op.execute("DROP TABLE IF EXISTS staff_schedules;")
    op.execute("DROP TABLE IF EXISTS staff_branches;")
