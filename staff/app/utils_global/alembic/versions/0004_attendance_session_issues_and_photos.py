"""attendance session issues and photos

Revision ID: 0004_session_issues_photos
Revises: 0003_session_comments
Create Date: 2026-04-18 00:00:00
"""

from alembic import op


revision = "0004_session_issues_photos"
down_revision = "0003_session_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance_session_issue_history (
          id UUID PRIMARY KEY,
          session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          issue_kind TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_by_uuid TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance_session_photo_history (
          id UUID PRIMARY KEY,
          session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          mime_type TEXT NOT NULL,
          content BYTEA NOT NULL,
          created_by_uuid TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_attendance_session_issue_history_session_id_created_at "
        "ON attendance_session_issue_history(session_id, created_at DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_attendance_session_photo_history_session_id_created_at "
        "ON attendance_session_photo_history(session_id, created_at DESC);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_attendance_session_photo_history_session_id_created_at;")
    op.execute("DROP INDEX IF EXISTS idx_attendance_session_issue_history_session_id_created_at;")
    op.execute("DROP TABLE IF EXISTS attendance_session_photo_history;")
    op.execute("DROP TABLE IF EXISTS attendance_session_issue_history;")
