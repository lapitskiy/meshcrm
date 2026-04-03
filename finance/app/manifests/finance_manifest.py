MANIFEST = {
    "name": "finance",
    "bounded_context": "finance",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Бухглатерия",
            "items": [
                {"id": "money", "title": "Учёт денег заказы"},
                {"id": "money-skupka", "title": "Учёт денег скупка"},
                {"id": "settings", "title": "Настройки"},
            ],
        },
        "order_create": {
            "title": "Бухглатерия",
            "pricing_by_work_types": True,
        },
    },
    "api": {"base_url": "http://finance:8000"},
}
