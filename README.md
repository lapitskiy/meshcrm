# HubCRM — AI-Native Modular CRM Platform

**Flat Services · DDD · UUID-centric · ClickHouse-ready**

## 🎯 Цель платформы

Универсальная CRM-платформа, которая может использоваться как:
- CRM заказов
- CRM услуг
- Тикет-система
- Сервис-деск
- Workflow / case-management

**Без изменения ядра**, только за счёт плагинов.

## 🧠 Ключевые принципы (архитектурные аксиомы)

- **Core управляет CASE**, а не заказами
- **Case** — универсальная единица работы
- **case_uuid** — единственный сквозной идентификатор
- Один сервис = один bounded context
- Один сервис = один Docker-контейнер
- **Нет общей БД** — у каждого сервиса свой Postgres
- **Нет прямых импортов** между сервисами — все связи через события
- **PostgreSQL** = source of truth
- **ClickHouse** = read-only ускоритель
- Плагины можно отключать, Core — нельзя
- ИИ работает через AI Memory, а не "угадывает"

## 🏗 Архитектура

```
┌────────────┐
│  UI Shell  │
└─────▲──────┘
      │
┌─────┴──────────┐
│ API Gateway    │
│ JWT · Routing  │
└─────▲──────────┘
      │
┌─────┴──────────────────────────┐
│ Core Services                   │
│  - keycloak                      │
│  - core-cases                   │
│  - plugin-registry               │
└─────▲──────────────────────────┘
      │ domain events (case_uuid)
┌─────┴──────────┐
│ Event Bus      │  (Redis Streams)
└─────▲──────────┘
      │
┌─────┴──────────────────────────────────┐
│ Business Services (Extensions, flat)    │
│ orders · accounting · documents · etc   │
└─────▲──────────────────────────────────┘
      │
┌─────┴──────────┐
│ ClickHouse     │  ← UUID speed layer
└────────────────┘

┌──────────────────────────────┐
│ AI Memory Service             │  ← knowledge layer
└──────────────────────────────┘
```

## 📂 Структура репозитория

```
crm-platform/
├── docker-compose.yml
├── env.example
├── PLAN.md
├── README.md

├── gateway/          # API Gateway (JWT + routing)
├── keycloak/         # OIDC identity provider (realm import)
├── core-cases/       # Core: Case management
├── plugin-registry/  # Core: plugin manifests

├── orders/           # Extension: orders context
├── accounting/       # Extension: accounting context
├── documents/        # Extension: documents context
├── contacts/         # Extension: contacts context

├── analytics-consumer/  # Redis → ClickHouse
├── ai-memory/          # Knowledge layer
├── ui-shell/           # Dynamic UI

└── shared/
    ├── contracts/      # Event types, schemas
    └── adr/            # Architecture Decision Records
```

## 🚀 Быстрый старт

### 1. Подготовка

```bash
# Опционально: скопируй env.example в .env и измени Keycloak admin / passwords
cp env.example .env
```

### 2. Запуск

```bash
docker compose up --build
```

### 3. Проверка

Открой в браузере:
- **Gateway**: http://localhost:8080
- **UI Shell**: http://localhost:3000
- **Keycloak**: http://localhost:8081
- **ClickHouse**: http://localhost:8123

## 🔄 Минимальный flow (MVP)

### 1. Логин (Keycloak)

```bash
# Получить access_token через gateway (проксирует в Keycloak)
curl -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo"}'
```

Ответ содержит `access_token` — используй его в следующих запросах.

### 2. Создание Case

```bash
TOKEN="your_access_token_here"

curl -X POST http://localhost:8080/cases \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Это создаст Case и опубликует событие `case.created` в Redis Streams.

### 3. Проверка событий в ClickHouse

```bash
curl "http://localhost:8123/?query=SELECT%20event_type,case_uuid,source,created_at%20FROM%20analytics.case_events%20ORDER%20BY%20created_at%20DESC%20LIMIT%2010"
```

### 4. Проверка плагинов

```bash
# Список всех плагинов
curl http://localhost:8080/plugins

# Манифест конкретного плагина
curl http://localhost:8080/plugins/accounting
```

## 📋 Порты сервисов

| Сервис | Порт | Описание |
|--------|------|----------|
| Gateway | 8080 | Единая точка входа |
| UI Shell | 3000 | Динамический UI |
| Keycloak | 8081 | Аутентификация (OIDC) |
| Core Cases | 8002 | Управление кейсами |
| Plugin Registry | 8003 | Реестр плагинов |
| Accounting | 8004 | Финансы |
| AI Memory | 8005 | Knowledge layer |
| Documents | 8006 | Документы |
| Contacts | 8007 | Контакты |
| Orders | 8008 | Заказы |
| ClickHouse | 8123 | HTTP API |
| Redis | 6379 | Event bus |

## 📚 Контракты

Смотри `shared/contracts/`:
- `event-types.md` — envelope событий и базовые типы
- `plugin-manifest.schema.json` — схема манифеста плагина
- `ui-extension.schema.json` — схема UI-расширений

## 🧩 Что дальше?

Это **MVP-скелет** для дальнейшего развития:
- Добавь реальную бизнес-логику в плагины
- Расширь UI Shell динамическими формами
- Настрой миграции БД (Alembic)
- Добавь тесты
- Настрой CI/CD

## 📖 Документация

- `PLAN.md` — полный архитектурный план
- `shared/adr/` — Architecture Decision Records
- `shared/contracts/` — контракты между сервисами

## ⚠️ Важно

- Это **MVP** для демонстрации архитектуры
- Таблицы создаются на старте (без миграций) — для скорости первого запуска
- В продакшене используй миграции и секреты из переменных окружения
