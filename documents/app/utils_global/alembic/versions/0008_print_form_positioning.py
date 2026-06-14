"""add print form positioning

Revision ID: 0008_print_form_positioning
Revises: 0007_print_form_auto_height
Create Date: 2026-04-25
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0008_print_form_positioning"
down_revision: Union[str, None] = "0007_print_form_auto_height"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        ADD COLUMN IF NOT EXISTS page_offset_x_mm INTEGER,
        ADD COLUMN IF NOT EXISTS page_offset_y_mm INTEGER,
        ADD COLUMN IF NOT EXISTS page_rotation_deg INTEGER;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        DROP COLUMN IF EXISTS page_rotation_deg,
        DROP COLUMN IF EXISTS page_offset_y_mm,
        DROP COLUMN IF EXISTS page_offset_x_mm;
        """
    )
