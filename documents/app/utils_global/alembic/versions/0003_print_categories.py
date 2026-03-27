"""print categories

Revision ID: 0003_print_categories
Revises: 0002_print_forms_and_variables
Create Date: 2026-03-28
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0003_print_categories"
down_revision: Union[str, None] = "0002_print_forms_and_variables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS print_categories (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_print_categories_name_ci
        ON print_categories (LOWER(name));
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uniq_print_categories_name_ci;")
    op.execute("DROP TABLE IF EXISTS print_categories;")
