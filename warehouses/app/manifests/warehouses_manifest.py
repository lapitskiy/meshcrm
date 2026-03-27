MANIFEST = {
    "name": "warehouses",
    "bounded_context": "warehouses",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Склады/Точки",
            "items": [
                {"id": "list", "title": "Склады"},
                {"id": "settings", "title": "Настройки"},
            ],
        },
        "order_create": {
            "title": "Склады",
            "warehouse_by_access": True,
            "list_endpoint": "/warehouses/warehouses/accessible",
            "step_order": 30,
        },
    },
    "api": {"base_url": "http://warehouses:8000"},
}
