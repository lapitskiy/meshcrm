"""init schema

Revision ID: 0001
Revises:
Create Date: 2026-01-26
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
          user_uuid UUID PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          token_uuid UUID PRIMARY KEY,
          user_uuid UUID NOT NULL REFERENCES users(user_uuid) ON DELETE CASCADE,
          token_secret TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS refresh_tokens;")
    op.execute("DROP TABLE IF EXISTS users;")

