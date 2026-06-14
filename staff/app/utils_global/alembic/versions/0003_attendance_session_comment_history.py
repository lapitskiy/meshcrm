"""add attendance session comment history

Revision ID: 0003_session_comments
Revises: 0002_attendance_auto_close
Create Date: 2026-04-19 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_session_comments"
down_revision: Union[str, None] = "0002_attendance_auto_close"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance_session_comment_history (
          id UUID PRIMARY KEY,
          session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          comment TEXT NOT NULL,
          created_by_uuid TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_attendance_session_comment_history_session_id_created_at "
        "ON attendance_session_comment_history(session_id, created_at DESC);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_attendance_session_comment_history_session_id_created_at;")
    op.execute("DROP TABLE IF EXISTS attendance_session_comment_history;")
