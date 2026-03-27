import os

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

try:
    from app.infrastructure.db.base import Base
    from app.infrastructure.db import models  # noqa: F401
except ModuleNotFoundError:
    from infrastructure.db.base import Base  # type: ignore
    from infrastructure.db import models  # type: ignore  # noqa: F401


config = context.config


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required for Alembic")
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgresql://"):
        rest = url[len("postgresql://") :]
        try:
            import psycopg  # noqa: F401

            return f"postgresql+psycopg://{rest}"
        except Exception:
            pass
        try:
            import psycopg2  # noqa: F401

            return f"postgresql+psycopg2://{rest}"
        except Exception:
            pass
    return url


def run_migrations_online() -> None:
    config.set_main_option("sqlalchemy.url", _db_url())
    connectable = create_engine(config.get_main_option("sqlalchemy.url"), poolclass=NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()

