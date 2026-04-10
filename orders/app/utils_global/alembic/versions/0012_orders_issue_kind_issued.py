"""allow issued issue_kind

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-10
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_orders_issue_kind", "orders", type_="check")
    op.create_check_constraint(
        "ck_orders_issue_kind",
        "orders",
        "issue_kind IS NULL OR issue_kind IN ('return', 'problem', 'issued')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_orders_issue_kind", "orders", type_="check")
    op.create_check_constraint(
        "ck_orders_issue_kind",
        "orders",
        "issue_kind IS NULL OR issue_kind IN ('return', 'problem')",
    )
