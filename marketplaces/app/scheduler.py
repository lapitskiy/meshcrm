import json
import os
import time
import threading
import urllib.request
import urllib.error
from datetime import datetime, timezone


def _env(name: str, default: str) -> str:
    val = os.getenv(name, default)
    return val if val is not None else default


def _run_once(base_url: str, token: str) -> None:
    url = f"{base_url.rstrip('/')}/internal/jobs/ozon/promotions/timer-autoupdate"
    req = urllib.request.Request(
        url=url,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-scheduler-token": token,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode("utf-8")
        payload = json.loads(body) if body else {}
    print(f"[{datetime.now(timezone.utc).isoformat()}] scheduler run ok: {json.dumps(payload)}", flush=True)


def _run_discount_once(base_url: str, token: str) -> None:
    url = f"{base_url.rstrip('/')}/internal/jobs/ozon/promotions/discount-autoprocess"
    req = urllib.request.Request(
        url=url,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-scheduler-token": token,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode("utf-8")
        payload = json.loads(body) if body else {}
    print(f"[{datetime.now(timezone.utc).isoformat()}] discount scheduler run ok: {json.dumps(payload)}", flush=True)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_month = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        next_month = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    this_month = datetime(year, month, 1, tzinfo=timezone.utc)
    return (next_month - this_month).days


def _next_run_utc(now_utc: datetime, day: int, hour: int, minute: int) -> datetime:
    day_this_month = min(max(day, 1), _days_in_month(now_utc.year, now_utc.month))
    candidate = datetime(now_utc.year, now_utc.month, day_this_month, hour, minute, tzinfo=timezone.utc)
    if candidate > now_utc:
        return candidate
    if now_utc.month == 12:
        ny, nm = now_utc.year + 1, 1
    else:
        ny, nm = now_utc.year, now_utc.month + 1
    day_next_month = min(max(day, 1), _days_in_month(ny, nm))
    return datetime(ny, nm, day_next_month, hour, minute, tzinfo=timezone.utc)


def _discount_loop(base_url: str, token: str, interval_seconds: int, run_on_start: bool) -> None:
    print(
        f"[{datetime.now(timezone.utc).isoformat()}] discount scheduler started, interval={interval_seconds}s",
        flush=True,
    )
    if run_on_start:
        try:
            _run_discount_once(base_url, token)
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            print(f"[{datetime.now(timezone.utc).isoformat()}] discount scheduler http error: {e.code} {msg}", flush=True)
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] discount scheduler error: {e}", flush=True)
    while True:
        time.sleep(interval_seconds)
        try:
            _run_discount_once(base_url, token)
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            print(f"[{datetime.now(timezone.utc).isoformat()}] discount scheduler http error: {e.code} {msg}", flush=True)
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] discount scheduler error: {e}", flush=True)


def main() -> None:
    base_url = _env("MARKETPLACES_INTERNAL_URL", "http://marketplaces:8000")
    token = _env("MARKETPLACES_SCHEDULER_TOKEN", "")
    day_of_month = int(_env("MARKETPLACES_SCHEDULER_DAY_OF_MONTH", "10"))
    run_hour_utc = int(_env("MARKETPLACES_SCHEDULER_RUN_HOUR_UTC", "3"))
    run_minute_utc = int(_env("MARKETPLACES_SCHEDULER_RUN_MINUTE_UTC", "0"))
    run_on_start = _env("MARKETPLACES_SCHEDULER_RUN_ON_START", "false").lower() == "true"
    discount_interval_seconds = int(_env("MARKETPLACES_DISCOUNT_SCHEDULER_INTERVAL_SECONDS", "60"))
    discount_run_on_start = _env("MARKETPLACES_DISCOUNT_SCHEDULER_RUN_ON_START", "true").lower() == "true"
    if run_hour_utc < 0 or run_hour_utc > 23:
        run_hour_utc = 3
    if run_minute_utc < 0 or run_minute_utc > 59:
        run_minute_utc = 0
    if discount_interval_seconds < 10:
        discount_interval_seconds = 60
    print(
        f"[{datetime.now(timezone.utc).isoformat()}] marketplaces-scheduler started, dom={day_of_month} time={run_hour_utc:02d}:{run_minute_utc:02d} UTC",
        flush=True,
    )
    discount_thread = threading.Thread(
        target=_discount_loop,
        args=(base_url, token, discount_interval_seconds, discount_run_on_start),
        daemon=True,
    )
    discount_thread.start()
    if run_on_start:
        try:
            _run_once(base_url, token)
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            print(f"[{datetime.now(timezone.utc).isoformat()}] scheduler http error: {e.code} {msg}", flush=True)
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] scheduler error: {e}", flush=True)
    while True:
        now_utc = datetime.now(timezone.utc)
        run_at = _next_run_utc(now_utc, day_of_month, run_hour_utc, run_minute_utc)
        sleep_seconds = max(int((run_at - now_utc).total_seconds()), 30)
        print(
            f"[{datetime.now(timezone.utc).isoformat()}] next run at {run_at.isoformat()}, sleeping {sleep_seconds}s",
            flush=True,
        )
        time.sleep(sleep_seconds)
        try:
            _run_once(base_url, token)
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            print(f"[{datetime.now(timezone.utc).isoformat()}] scheduler http error: {e.code} {msg}", flush=True)
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] scheduler error: {e}", flush=True)


if __name__ == "__main__":
    main()
