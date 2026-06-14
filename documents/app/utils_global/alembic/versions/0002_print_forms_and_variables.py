"""print forms and variables

Revision ID: 0002_print_forms_and_variables
Revises: 0001
Create Date: 2026-03-27
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0002_print_forms_and_variables"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS print_forms (
          id UUID PRIMARY KEY,
          title TEXT NOT NULL,
          content_json JSONB NOT NULL,
          content_html TEXT NOT NULL DEFAULT '',
          created_by_uuid TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_print_forms_updated_at ON print_forms(updated_at DESC);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS print_variable_defs (
          module_name TEXT NOT NULL,
          var_key TEXT NOT NULL,
          label TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (module_name, var_key)
        );
        """
    )

    op.execute(
        """
        INSERT INTO print_variable_defs (module_name, var_key, label)
        VALUES
          ('contacts', 'contact_name', 'Имя клиента'),
          ('contacts', 'contact_phone', 'Телефон клиента'),
          ('orders', 'order_number', 'Номер заказа'),
          ('orders', 'order_created_at', 'Дата создания заказа'),
          ('orders', 'user_name', 'Имя пользователя (мастера)'),
          ('orders', 'user_login', 'Логин пользователя (мастера)'),
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
          ('orders_report', 'all_lines_text', 'Все строки отчёта (текст)'),
          ('warehouses', 'warehouse_name', 'Склад/точка'),
          ('warehouses', 'warehouse_address', 'Адрес склада/точки'),
          ('warehouses', 'warehouse_point_phone', 'Телефон склада/точки'),
          ('warehouses', 'warehouse_qr_site_svg', 'QR сайта склада (SVG)'),
          ('warehouses', 'warehouse_qr_yandex_svg', 'QR Яндекс склада (SVG)'),
          ('warehouses', 'warehouse_qr_vk_svg', 'QR VK склада (SVG)'),
          ('warehouses', 'warehouse_qr_telegram_svg', 'QR Telegram склада (SVG)')
        ON CONFLICT (module_name, var_key) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS print_variable_defs;")
    op.execute("DROP INDEX IF EXISTS idx_print_forms_updated_at;")
    op.execute("DROP TABLE IF EXISTS print_forms;")

