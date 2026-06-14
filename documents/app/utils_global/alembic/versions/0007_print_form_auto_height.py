"""add print form auto height

Revision ID: 0007_print_form_auto_height
Revises: 0006_print_form_page_size
Create Date: 2026-04-25
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0007_print_form_auto_height"
down_revision: Union[str, None] = "0006_print_form_page_size"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        ADD COLUMN IF NOT EXISTS page_auto_height BOOLEAN NOT NULL DEFAULT FALSE;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        DROP COLUMN IF EXISTS page_auto_height;
        """
    )
