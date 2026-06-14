"""add orders report print variables

Revision ID: 0004_orders_report_vars
Revises: 0003_print_categories
Create Date: 2026-04-16
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0004_orders_report_vars"
down_revision: Union[str, None] = "0003_print_categories"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO print_variable_defs (module_name, var_key, label)
        VALUES
          ('orders_report', 'report_number', 'Номер отчёта'),
          ('orders_report', 'report_date', 'Дата отчёта'),
          ('orders_report', 'warehouse_name', 'Склад'),
          ('orders_report', 'created_by_name', 'Кто сформировал отчёт'),
          ('orders_report', 'created_at', 'Дата и время создания отчёта'),
          ('orders_report', 'total_revenue', 'Выручка'),
          ('orders_report', 'total_master_salary', 'ЗП мастера'),
          ('orders_report', 'total_cash_remainder', 'Остаток в кассе'),
          ('orders_report', 'issue_kind', 'Проблема отчёта'),
          ('orders_report', 'day_lines_text', 'Заказы за день (текст)'),
          ('orders_report', 'old_lines_text', 'Старые заказы (текст)'),
          ('orders_report', 'all_lines_text', 'Все строки отчёта (текст)')
        ON CONFLICT (module_name, var_key) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM print_variable_defs
        WHERE module_name = 'orders_report'
          AND var_key IN (
            'report_number',
            'report_date',
            'warehouse_name',
            'created_by_name',
            'created_at',
            'total_revenue',
            'total_master_salary',
            'total_cash_remainder',
            'issue_kind',
            'day_lines_text',
            'old_lines_text',
            'all_lines_text'
          );
        """
    )
