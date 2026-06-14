"""add qz flag to print forms

Revision ID: 0009_print_form_qz
Revises: 0008_print_form_positioning
Create Date: 2026-04-26
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0009_print_form_qz"
down_revision: Union[str, None] = "0008_print_form_positioning"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        ADD COLUMN IF NOT EXISTS qz_enabled BOOLEAN NOT NULL DEFAULT FALSE;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        DROP COLUMN IF EXISTS qz_enabled;
        """
    )
