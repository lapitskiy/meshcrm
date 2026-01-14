import json
import os
import time
import uuid
from datetime import datetime, timezone

import clickhouse_connect
from redis import Redis


def env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if val is None or val == "":
        raise RuntimeError(f"Missing env var: {name}")
    return val


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


REDIS_URL = env("REDIS_URL", "redis://redis:6379/0")
EVENTS_STREAM = env("EVENTS_STREAM", "case_events")
CONSUMER_GROUP = env("EVENTS_CONSUMER_GROUP", "analytics")
SERVICE_NAME = env("SERVICE_NAME", "analytics-consumer")

CLICKHOUSE_HOST = env("CLICKHOUSE_HOST", "clickhouse")
CLICKHOUSE_HTTP_PORT = int(env("CLICKHOUSE_HTTP_PORT", "8123"))
CLICKHOUSE_USER = env("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_DB = env("CLICKHOUSE_DB", "analytics")


def rds() -> Redis:
    return Redis.from_url(REDIS_URL, decode_responses=True)


def ch():
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST,
        port=CLICKHOUSE_HTTP_PORT,
        username=CLICKHOUSE_USER,
        password=CLICKHOUSE_PASSWORD,
    )


def ensure_consumer_group() -> None:
    client = rds()
    try:
        client.xgroup_create(EVENTS_STREAM, CONSUMER_GROUP, id="0-0", mkstream=True)
    except Exception:
        pass


def ensure_clickhouse_schema() -> None:
    client = ch()
    client.command(f"CREATE DATABASE IF NOT EXISTS {CLICKHOUSE_DB}")
    client.command(
        f"""
        CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.case_events
        (
          event_id UUID,
          case_uuid UUID,
          source String,
          event_type String,
          payload String,
          created_at DateTime,
          schema_version UInt32
        )
        ENGINE = MergeTree
        ORDER BY (case_uuid, created_at)
        """
    )


def parse_dt(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return utcnow()


def main() -> None:
    ensure_consumer_group()
    # ClickHouse may need time on first start; wait until it's ready (don't crash the consumer).
    while True:
        try:
            ensure_clickhouse_schema()
            break
        except Exception:
            time.sleep(1)

    redis_client = rds()
    ch_client = ch()
    consumer_name = f"{SERVICE_NAME}-{uuid.uuid4()}"

    while True:
        entries = redis_client.xreadgroup(
            groupname=CONSUMER_GROUP,
            consumername=consumer_name,
            streams={EVENTS_STREAM: ">"},
            count=50,
            block=5000,
        )
        if not entries:
            continue

        rows = []
        ack_ids: list[str] = []
        for _, msgs in entries:
            for msg_id, fields in msgs:
                ack_ids.append(msg_id)
                payload_json = fields.get("payload_json") or "{}"
                try:
                    # validate JSON but store raw string (ClickHouse-ready)
                    json.loads(payload_json)
                except Exception:
                    payload_json = "{}"

                rows.append(
                    (
                        uuid.UUID(fields.get("event_id") or str(uuid.uuid4())),
                        uuid.UUID(fields.get("case_uuid") or str(uuid.uuid4())),
                        fields.get("source") or "unknown",
                        fields.get("event_type") or "unknown",
                        payload_json,
                        parse_dt(fields.get("created_at") or utcnow().isoformat()),
                        int(fields.get("schema_version") or 1),
                    )
                )

        if rows:
            ch_client.insert(
                f"{CLICKHOUSE_DB}.case_events",
                rows,
                column_names=["event_id", "case_uuid", "source", "event_type", "payload", "created_at", "schema_version"],
            )
        if ack_ids:
            redis_client.xack(EVENTS_STREAM, CONSUMER_GROUP, *ack_ids)


if __name__ == "__main__":
    main()


