"""add orders report salary cash from revenue variable

Revision ID: 0010_ord_rep_sal_revenue
Revises: 0009_print_form_qz
Create Date: 2026-04-29
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0010_ord_rep_sal_revenue"
down_revision: Union[str, None] = "0009_print_form_qz"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO print_variable_defs (module_name, var_key, label)
        VALUES ('orders_report', 'salary_cash_from_revenue', 'Из выручки на ЗП')
        ON CONFLICT (module_name, var_key) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM print_variable_defs
        WHERE module_name = 'orders_report'
          AND var_key = 'salary_cash_from_revenue';
        """
    )
