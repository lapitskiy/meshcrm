import os

import psycopg2


def get_connection():
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    return conn

