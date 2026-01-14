from fastapi import FastAPI

app = FastAPI(title="orders", version="0.0.0-stub")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


