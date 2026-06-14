import os

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

config = context.config


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required for Alembic")
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgresql://"):
        rest = url[len("postgresql://") :]
        return f"postgresql+psycopg://{rest}"
    return url


def run_migrations_online() -> None:
    config.set_main_option("sqlalchemy.url", _db_url())
    connectable = create_engine(config.get_main_option("sqlalchemy.url"), poolclass=NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
