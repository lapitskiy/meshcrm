import os

def get_connection():
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    try:
        import psycopg
    except Exception as exc:
        raise RuntimeError("psycopg is not installed in container, rebuild image or install dependency") from exc
    return psycopg.connect(url)
