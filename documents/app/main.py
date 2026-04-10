"""
Documents Service - Bounded Context: documents

Отвечает за PDF/акты/счета, связаны с Case только через case_uuid.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.interfaces.http.print_router import router as print_router
from app.infrastructure.db.connection import get_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_db() -> None:
    conn = None
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS print_forms (
                  id UUID PRIMARY KEY,
                  title TEXT NOT NULL,
                  content_json JSONB NOT NULL,
                  content_html TEXT NOT NULL DEFAULT '',
                  category_id UUID,
                  created_by_uuid TEXT,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                ALTER TABLE print_forms
                ADD COLUMN IF NOT EXISTS category_id UUID;
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_print_forms_category_id ON print_forms(category_id);"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_print_forms_updated_at ON print_forms(updated_at DESC);"
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS print_variable_defs (
                  module_name TEXT NOT NULL,
                  var_key TEXT NOT NULL,
                  label TEXT NOT NULL,
                  enabled BOOLEAN NOT NULL DEFAULT TRUE,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (module_name, var_key)
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS print_categories (
                  id UUID PRIMARY KEY,
                  name TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uniq_print_categories_name_ci
                ON print_categories (LOWER(name));
                """
            )
            cur.execute(
                """
                INSERT INTO print_variable_defs (module_name, var_key, label)
                VALUES
                  ('contacts', 'contact_name', 'Имя клиента'),
                  ('contacts', 'contact_phone', 'Телефон клиента'),
                  ('contacts', 'contact_email', 'Email клиента'),
                  ('orders', 'order_id', 'UUID заказа'),
                  ('orders', 'order_number', 'Номер заказа'),
                  ('orders', 'order_status', 'Статус заказа'),
                  ('orders', 'order_kind', 'Тип заказа'),
                  ('orders', 'order_created_at', 'Дата создания заказа'),
                  ('orders', 'service_category_name', 'Категория услуг'),
                  ('orders', 'service_object_name', 'Объект ремонта/услуги'),
                  ('orders', 'serial_model', 'Серийный/Модель'),
                  ('orders', 'work_types', 'Виды работ (список)'),
                  ('orders', 'user_name', 'Имя пользователя (мастера)'),
                  ('orders', 'user_login', 'Логин пользователя (мастера)'),
                  ('finance', 'payment_method', 'Способ оплаты'),
                  ('finance', 'is_paid', 'Оплачен заказ (Да/Нет)'),
                  ('finance', 'lines_text', 'Строки оплаты (текст)'),
                  ('finance', 'total_amount', 'Итого сумма'),
                  ('skupka', 'deal_id', 'UUID выкупа'),
                  ('skupka', 'deal_number', 'Номер выкупа'),
                  ('skupka', 'deal_type', 'Тип сделки'),
                  ('skupka', 'realization_status', 'Статус реализации'),
                  ('skupka', 'category_name', 'Категория скупки'),
                  ('skupka', 'purchase_object_name', 'Объект покупки'),
                  ('skupka', 'device_condition_names', 'Состояние устройства (список)'),
                  ('skupka', 'title', 'Название выкупа'),
                  ('skupka', 'client_name', 'Имя клиента'),
                  ('skupka', 'client_phone', 'Телефон клиента'),
                  ('skupka', 'offered_amount', 'Предложенная сумма'),
                  ('skupka', 'amount', 'Сумма оплаты'),
                  ('skupka', 'currency', 'Валюта'),
                  ('skupka', 'payment_method', 'Способ оплаты'),
                  ('skupka', 'warehouse_name', 'Склад'),
                  ('skupka', 'comment', 'Комментарий'),
                  ('skupka', 'user_name', 'Имя сотрудника'),
                  ('skupka', 'user_login', 'Логин сотрудника'),
                  ('skupka', 'created_at', 'Дата создания выкупа'),
                  ('warehouses', 'warehouse_name', 'Склад/точка'),
                  ('warehouses', 'warehouse_address', 'Адрес склада/точки'),
                  ('warehouses', 'warehouse_point_phone', 'Телефон склада/точки'),
                  ('warehouses', 'warehouse_qr_site_svg', 'QR сайта склада (SVG)'),
                  ('warehouses', 'warehouse_qr_yandex_svg', 'QR Яндекс склада (SVG)'),
                  ('warehouses', 'warehouse_qr_vk_svg', 'QR VK склада (SVG)'),
                  ('warehouses', 'warehouse_qr_telegram_svg', 'QR Telegram склада (SVG)')
                ON CONFLICT (module_name, var_key) DO NOTHING;
                """
            )
    finally:
        if conn is not None:
            conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("Documents service starting...")
    init_db()
    yield
    logger.info("Documents service shutting down...")


app = FastAPI(
    title="Documents Service",
    description="Bounded context: documents",
    version="1.0.0",
    lifespan=lifespan,
)

MANIFEST = {
    "name": "documents",
    "bounded_context": "documents",
    "version": "1.0.0",
    "events": {"subscribes": [], "publishes": []},
    "ui": {"menu": {"title": "Документы", "items": []}},
    "api": {"base_url": "http://documents:8000"},
}


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok", "service": "documents"}


@app.get("/manifest")
def manifest() -> dict:
    return MANIFEST


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "documents",
        "bounded_context": "documents",
        "status": "running",
    }


app.include_router(print_router)

