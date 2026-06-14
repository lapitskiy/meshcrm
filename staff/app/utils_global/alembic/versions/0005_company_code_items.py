"""add company code items

Revision ID: 0005_company_code_items
Revises: 0004_session_issues_photos
Create Date: 2026-04-27 00:00:00
"""

from alembic import op


revision = "0005_company_code_items"
down_revision = "0004_session_issues_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_company_code_items (
          id UUID PRIMARY KEY,
          chapter_name TEXT NOT NULL,
          article_name TEXT NOT NULL,
          point_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (chapter_name, article_name, point_name)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_staff_company_code_items_names "
        "ON staff_company_code_items(chapter_name, article_name, point_name);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_staff_company_code_items_names;")
    op.execute("DROP TABLE IF EXISTS staff_company_code_items;")
