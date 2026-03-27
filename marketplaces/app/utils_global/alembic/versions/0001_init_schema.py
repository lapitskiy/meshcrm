"""init schema

Revision ID: 0001
Revises:
Create Date: 2026-01-26
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS marketplace_api_settings (
          user_uuid UUID PRIMARY KEY,
          moy_sklad_api TEXT NOT NULL DEFAULT '',
          yandex_market_api TEXT NOT NULL DEFAULT '',
          wildberries_api TEXT NOT NULL DEFAULT '',
          ozon_client_id TEXT NOT NULL DEFAULT '',
          ozon_api TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS marketplace_api_settings;")

