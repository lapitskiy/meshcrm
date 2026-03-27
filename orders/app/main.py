from fastapi import FastAPI

from app.interfaces.http.service_categories_router import router as service_categories_router
from app.interfaces.http.orders_router import router as orders_router
from app.interfaces.http.service_objects_router import router as service_objects_router
from app.interfaces.http.statuses_router import router as statuses_router
from app.interfaces.http.work_types_router import router as work_types_router

app = FastAPI(title="orders", version="0.0.0-stub")
MANIFEST = {
    "name": "orders",
    "bounded_context": "orders",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Заказы",
            "items": [
                {"id": "create", "title": "Создать заказ"},
                {"id": "list", "title": "Список заказов"},
                {"id": "settings", "title": "Настройки"},
            ],
        }
    },
    "api": {"base_url": "http://orders:8000"},
}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


app.include_router(service_categories_router)
app.include_router(orders_router)
app.include_router(work_types_router)
app.include_router(service_objects_router)
app.include_router(statuses_router)


