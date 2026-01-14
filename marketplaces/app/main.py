import os

from fastapi import FastAPI


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


# reserved for future use (db, oauth tokens, etc.)
_DATABASE_URL = env("DATABASE_URL", "postgresql://marketplaces:marketplaces_pw@marketplaces-db:5432/marketplaces")

app = FastAPI(title="marketplaces", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


