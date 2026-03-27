MANIFEST = {
    "name": "contacts",
    "bounded_context": "contacts",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {
        "menu": {
            "title": "Контакты",
            "items": [
                {"id": "list", "title": "Список контактов"},
                {"id": "settings", "title": "Настройки"},
            ],
        },
        "order_create": {
            "title": "Контакты",
            "list_endpoint": "/contacts/contacts",
            "search_endpoint": "/contacts/contacts/search",
            "display_fields": [
                {"key": "name", "label": "Имя"},
                {"key": "phone", "label": "Телефон"},
            ],
        },
    },
    "api": {"base_url": "http://contacts:8000"},
}
