# FINAL PLAN — AI-Native Modular CRM Platform

Это репозиторий-референс реализации архитектуры:

- Flat services layout
- DDD/Clean шаблон одинаковый для всех сервисов
- UUID-centric контракт (`case_uuid`)
- Связи только через события (Redis Streams)
- Postgres = source of truth (на сервис)
- ClickHouse = read-only ускоритель (через `analytics-consumer`)
- Плагины = first-class services (без папки `plugins/`)
- AI Memory = knowledge layer (правила/контракты/ADR)

См. `README.md` для запуска.

# FINAL PLAN — AI-Native Modular CRM Platform

Этот репозиторий сгенерирован по принципам:

- Core управляет CASE, а не заказами
- Case — универсальная единица работы
- case_uuid — единственный сквозной идентификатор
- Один сервис = один bounded context = один контейнер
- Нет общей БД (у каждого сервиса свой Postgres)
- Нет прямых импортов между сервисами
- Все связи — через события (Redis Streams)
- Postgres = source of truth
- ClickHouse = read-only ускоритель
- Плагины можно отключать, Core — нельзя
- AI работает через AI Memory (правила/контракты/ADR)

Структура:

```
crm-platform/
  docker-compose.yml
  .env.example
  shared/contracts/...
  gateway/
  auth/
  core-cases/
  plugin-registry/
  accounting/
  analytics-consumer/
  ai-memory/
  ui-shell/
```


