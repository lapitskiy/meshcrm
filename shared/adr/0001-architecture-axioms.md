## ADR-0001: Architecture Axioms (Non-negotiable)

Статус: accepted

### Decision

- Core управляет CASE, а не заказами
- Case — универсальная единица работы
- case_uuid — единственный сквозной идентификатор
- Один сервис = один bounded context = один контейнер
- Нет общей БД
- Нет прямых импортов между сервисами
- Все связи — через события
- Postgres = source of truth
- ClickHouse = read-only ускоритель
- Плагины можно отключать, Core — нельзя
- ИИ работает через AI Memory, а не “угадывает”


