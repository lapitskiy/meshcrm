## Domain Events — Envelope

Все события **immutable** и идут через Redis Streams. Все payload обязаны включать `case_uuid`.

Минимальный envelope (schema_version=1):

```json
{
  "event_id": "uuid",
  "event_type": "case.created",
  "case_uuid": "uuid",
  "source": "core-cases",
  "payload": {},
  "created_at": "2026-01-05T12:34:56.789Z",
  "schema_version": 1
}
```

## Stream

- Stream: `case_events`

## Core events (v1)

- `case.created`
  - payload: `{ "status": "new" }`
- `case.status_changed`
  - payload: `{ "old_status": "...", "new_status": "..." }`

## Extension examples (v1)

- `price.set` (accounting)
  - payload: `{ "currency": "USD", "amount": 123.45 }`

# Event Types (v1)

Все события публикуются в Redis Streams (`crm.events`) и имеют единый envelope.

## Envelope (JSON)

```json
{
  "event_id": "uuid",
  "schema_version": 1,
  "event_type": "case.created",
  "case_uuid": "uuid",
  "source": "core-cases",
  "payload": { },
  "created_at": "2026-01-05T12:34:56Z"
}
```

## Core

- `case.created`
- `case.status_changed`

## Extensions

- `price.set`


