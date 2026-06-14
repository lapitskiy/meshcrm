"""add print form page size

Revision ID: 0006_print_form_page_size
Revises: 0005_ord_rep_sal_cash
Create Date: 2026-04-25
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0006_print_form_page_size"
down_revision: Union[str, None] = "0005_ord_rep_sal_cash"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        ADD COLUMN IF NOT EXISTS page_width_mm INTEGER NOT NULL DEFAULT 200,
        ADD COLUMN IF NOT EXISTS page_height_mm INTEGER NOT NULL DEFAULT 300,
        ADD COLUMN IF NOT EXISTS page_margin_mm INTEGER NOT NULL DEFAULT 0;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE print_forms
        DROP COLUMN IF EXISTS page_margin_mm,
        DROP COLUMN IF EXISTS page_height_mm,
        DROP COLUMN IF EXISTS page_width_mm;
        """
    )
