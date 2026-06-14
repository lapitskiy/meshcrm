"""KPK codex: numbered chapters, articles, points

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-29
"""

from alembic import op

revision = "0006"
down_revision = "0005_company_code_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_kpk_chapters (
          id UUID PRIMARY KEY,
          chapter_no INTEGER NOT NULL,
          title TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_staff_kpk_chapters_no UNIQUE (chapter_no)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_kpk_articles (
          id UUID PRIMARY KEY,
          chapter_id UUID NOT NULL REFERENCES staff_kpk_chapters(id) ON DELETE CASCADE,
          article_no INTEGER NOT NULL,
          title TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_staff_kpk_articles_chapter_no UNIQUE (chapter_id, article_no)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_kpk_points (
          id UUID PRIMARY KEY,
          article_id UUID NOT NULL REFERENCES staff_kpk_articles(id) ON DELETE CASCADE,
          point_no INTEGER NOT NULL,
          description TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_staff_kpk_points_article_no UNIQUE (article_id, point_no)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_staff_kpk_articles_chapter_id ON staff_kpk_articles(chapter_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_staff_kpk_points_article_id ON staff_kpk_points(article_id);"
    )

    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'staff_company_code_items'
          ) THEN
            INSERT INTO staff_kpk_chapters (id, chapter_no, title, created_at, updated_at)
            SELECT gen_random_uuid(),
                   ROW_NUMBER() OVER (ORDER BY ch)::INTEGER,
                   ch,
                   NOW(),
                   NOW()
            FROM (
              SELECT DISTINCT TRIM(chapter_name) AS ch
              FROM staff_company_code_items
              WHERE TRIM(chapter_name) <> ''
            ) s;

            INSERT INTO staff_kpk_articles (id, chapter_id, article_no, title, created_at, updated_at)
            SELECT gen_random_uuid(),
                   c.id,
                   ROW_NUMBER() OVER (PARTITION BY x.ch ORDER BY x.art)::INTEGER,
                   x.art,
                   NOW(),
                   NOW()
            FROM (
              SELECT DISTINCT TRIM(chapter_name) AS ch, TRIM(article_name) AS art
              FROM staff_company_code_items
              WHERE TRIM(article_name) <> ''
            ) x
            JOIN staff_kpk_chapters c ON c.title = x.ch;

            INSERT INTO staff_kpk_points (id, article_id, point_no, description, created_at, updated_at)
            SELECT gen_random_uuid(),
                   a.id,
                   ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY TRIM(o.point_name))::INTEGER,
                   TRIM(o.point_name),
                   NOW(),
                   NOW()
            FROM staff_company_code_items o
            JOIN staff_kpk_chapters c ON c.title = TRIM(o.chapter_name)
            JOIN staff_kpk_articles a ON a.chapter_id = c.id AND a.title = TRIM(o.article_name)
            WHERE TRIM(o.point_name) <> '';

            DROP TABLE staff_company_code_items;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS staff_kpk_points;")
    op.execute("DROP TABLE IF EXISTS staff_kpk_articles;")
    op.execute("DROP TABLE IF EXISTS staff_kpk_chapters;")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_company_code_items (
          id UUID PRIMARY KEY,
          chapter_name TEXT NOT NULL,
          article_name TEXT NOT NULL,
          point_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (chapter_name, article_name, point_name)
        );
        """
    )
