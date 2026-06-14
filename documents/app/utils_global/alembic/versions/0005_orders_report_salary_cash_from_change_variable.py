"""add orders report salary cash from change variable

Revision ID: 0005_ord_rep_sal_cash
Revises: 0004_orders_report_vars
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0005_ord_rep_sal_cash"
down_revision: Union[str, None] = "0004_orders_report_vars"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO print_variable_defs (module_name, var_key, label)
        VALUES ('orders_report', 'salary_cash_from_change', 'Из размена на ЗП')
        ON CONFLICT (module_name, var_key) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM print_variable_defs
        WHERE module_name = 'orders_report'
          AND var_key = 'salary_cash_from_change';
        """
    )
