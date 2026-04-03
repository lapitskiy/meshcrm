"""LLM client (infrastructure, handles IO)."""

import json
import logging
from pathlib import Path
import ssl
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
import re
from datetime import datetime, timedelta, timezone

from dateutil import tz
from dateutil.parser import parse as dt_parse

from ...contracts.intents import Intent
from ...contracts.intents import GeoIntent, GeoPoint, ReminderIntent, UnknownIntent

logger = logging.getLogger("uvicorn.error")


class LLMClient:
    """LLM client for intent extraction."""
    
    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4",
        *,
        provider: str = "mvp",
        base_url: str = "https://api.deepseek.com",
        oauth_url: str | None = None,
        oauth_scope: str | None = None,
        tls_insecure: bool = False,
        nlu_system_prompt: str | None = None,
        timeout_sec: int = 20,
    ):
        self.api_key = api_key
        self.model = model
        self.provider = provider
        self.base_url = (base_url or "").rstrip("/")
        self.oauth_url = (oauth_url or "").strip() or None
        self.oauth_scope = (oauth_scope or "").strip() or None
        self.tls_insecure = bool(tls_insecure)
        self.nlu_system_prompt = nlu_system_prompt
        self.timeout_sec = int(timeout_sec)
        self._nlu_prompt_cache: str | None = None
        self._gigachat_token: str | None = None
        self._gigachat_token_exp_ts: float = 0.0

    def _urlopen(self, req: urllib.request.Request):
        if self.tls_insecure:
            ctx = ssl._create_unverified_context()
            return urllib.request.urlopen(req, timeout=self.timeout_sec, context=ctx)
        return urllib.request.urlopen(req, timeout=self.timeout_sec)

    def _load_nlu_prompt_from_file(self) -> str | None:
        if self._nlu_prompt_cache is not None:
            return self._nlu_prompt_cache
        try:
            path = Path(__file__).resolve().parent / "prompts" / "nlu_system_prompt.txt"
            text = path.read_text(encoding="utf-8").strip()
            self._nlu_prompt_cache = text or ""
            return text or None
        except Exception:
            self._nlu_prompt_cache = ""
            return None

    @staticmethod
    def _load_prompt_from_file(rel_path: str) -> str | None:
        try:
            path = Path(__file__).resolve().parent / "prompts" / rel_path
            text = path.read_text(encoding="utf-8").strip()
            return text or None
        except Exception:
            return None

    @staticmethod
    def _iso_duration_to_seconds(value: str) -> int | None:
        """
        Parse a small subset of ISO-8601 durations we generate, e.g. PT30M / PT15S / PT1H / PT1H30M.
        """
        s = (value or "").strip().upper()
        m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", s)
        if not m:
            return None
        h = int(m.group(1) or 0)
        mi = int(m.group(2) or 0)
        sec = int(m.group(3) or 0)
        total = h * 3600 + mi * 60 + sec
        return total if total > 0 else None

    def _extract_nlu_mvp(
        self,
        text: str,
        *,
        lat: float | None,
        lon: float | None,
        now: datetime,
    ) -> dict:
        """
        Deterministic fallback NLU JSON (extended schema used by pending_actions):
        - timer/text-timer/alarm/approx-alarm/task/memory-geo/geo-alarm/unknown
        """
        t = (text or "").strip().lower()

        # timer: "поставь таймер на полчаса"
        if re.search(r"\bтаймер\b", t) and re.search(r"\bпол\s*часа\b|\bполчаса\b", t):
            return {"type": "timer", "time": "PT30M"}

        # timer: "таймер на 10 минут/секунд/час"
        m = re.search(r"\bтаймер\b.*?\bна\b\s*(\d+)\s*(секунд\w*|сек\w*|минут\w*|мин\w*|час\w*)\b", t)
        if m:
            n = int(m.group(1))
            unit = m.group(2)
            if n > 0:
                if unit.startswith("сек"):
                    return {"type": "timer", "time": f"PT{n}S"}
                if unit.startswith("мин"):
                    return {"type": "timer", "time": f"PT{n}M"}
                if unit.startswith("час"):
                    return {"type": "timer", "time": f"PT{n}H"}

        # text-timer: "напомни через 10 минут вынуть белье"
        def _parse_ru_duration_to_iso(s: str) -> str | None:
            s = (s or "").strip().lower()
            if re.fullmatch(r"пол\s*часа|полчаса", s):
                return "PT30M"
            if re.fullmatch(r"час|часа|часов", s):
                return "PT1H"
            if re.fullmatch(r"полтора\s*часа|пол\s*тора\s*часа", s):
                return "PT1H30M"
            m2 = re.fullmatch(r"(\d+)\s*(секунд\w*|сек\w*|минут\w*|мин\w*|час\w*)", s)
            if not m2:
                return None
            n = int(m2.group(1))
            if n <= 0:
                return None
            unit = m2.group(2)
            if unit.startswith("сек"):
                return f"PT{n}S"
            if unit.startswith("мин"):
                return f"PT{n}M"
            return f"PT{n}H"

        _DUR_RE = r"(?:пол\s*часа|полчаса|полтора\s*часа|пол\s*тора\s*часа|час(?:а|ов)?|\d+\s*(?:секунд\w*|сек\w*|минут\w*|мин\w*|час\w*))"

        # "напомни (мне) через X <что>"
        m = re.search(rf"\bнапомни\b(?:\s+мне)?\s+через\s+({_DUR_RE})\b\s*(.*)$", t)
        if m:
            dur = _parse_ru_duration_to_iso(m.group(1))
            if dur:
                rest = (m.group(2) or "").strip(" .,!?:;")
                return {"type": "text-timer", "time": dur, "text": (rest[:120] or "Напоминание")}

        # "через X напомни <что>"
        m = re.search(rf"\bчерез\b\s+({_DUR_RE})\s+\bнапомни\b\s*(.*)$", t)
        if m:
            dur = _parse_ru_duration_to_iso(m.group(1))
            if dur:
                rest = (m.group(2) or "").strip(" .,!?:;")
                return {"type": "text-timer", "time": dur, "text": (rest[:120] or "Напоминание")}

        # approx-alarm: "напомни позже <что>"
        m = re.search(r"\bнапомни\b\s+позже\b\s*(.*)$", t)
        if m:
            rest = (m.group(1) or "").strip(" .,!?:;")
            return {
                "type": "approx-alarm",
                "time": (now + timedelta(hours=1)).isoformat(),
                "text": (rest[:120] or "Напоминание"),
                "interest": "50%",
            }

        return {"type": "unknown"}

    def _extract_intent_mvp(
        self,
        text: str,
        *,
        lat: float | None = None,
        lon: float | None = None,
        now: datetime | None = None,
    ) -> Intent:
        """Deterministic fallback intent extractor (no external LLM)."""
        t = (text or "").strip().lower()
        now = now or datetime.now(timezone.utc)

        # "напомни через 10 минут"
        m = re.search(r"напомни\s+через\s+(\d+)\s*(минут|мин|m)\b", t)
        if m:
            minutes = int(m.group(1))
            due_at = now + timedelta(minutes=minutes)
            return ReminderIntent(type="time", due_at=due_at)

        # "напомни в 18:30"
        m = re.search(r"напомни\s+в\s+(\d{1,2}:\d{2})", t)
        if m:
            hhmm = m.group(1)
            base = now if now.tzinfo else now.replace(tzinfo=tz.tzutc())
            due_at = dt_parse(hhmm, default=base)
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=base.tzinfo)
            if due_at <= now:
                due_at = due_at + timedelta(days=1)
            return ReminderIntent(type="time", due_at=due_at)

        # If device sent coordinates, allow creating geo intent (MVP)
        if lat is not None and lon is not None:
            return GeoIntent(type="geo", location=GeoPoint(lat=lat, lon=lon), radius_m=150)

        return UnknownIntent(type="unknown")

    def _deepseek_chat(self, *, messages: list[dict]) -> str:
        if not self.api_key:
            return ""
        if not self.base_url:
            return ""
        url = (
            f"{self.base_url}/v1/chat/completions"
            if not self.base_url.endswith("/chat/completions")
            else self.base_url
        )
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        try:
            with self._urlopen(req) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8")
            except Exception:
                raw = ""
            return raw
        except Exception:
            return ""

        try:
            data = json.loads(raw)
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
        except Exception:
            return ""

    def _gigachat_get_token(self) -> str:
        # api_key is expected to be Basic auth base64 for OAuth.
        if not self.api_key:
            return ""
        now_ts = time.time()
        if self._gigachat_token and now_ts < (self._gigachat_token_exp_ts - 15):
            return self._gigachat_token

        oauth_url = self.oauth_url or "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
        scope = self.oauth_scope or "GIGACHAT_API_PERS"

        body = urllib.parse.urlencode({"scope": scope, "grant_type": "client_credentials"}).encode("utf-8")
        req = urllib.request.Request(oauth_url, data=body, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        req.add_header("Accept", "application/json")
        req.add_header("Authorization", f"Basic {self.api_key}")
        req.add_header("RqUID", str(uuid.uuid4()))

        try:
            with self._urlopen(req) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8")
            except Exception:
                raw = ""
            logger.error("[gigachat] OAuth HTTP %s: %s", getattr(e, "code", "?"), raw[:500])
            self._gigachat_token = None
            self._gigachat_token_exp_ts = 0.0
            return raw
        except Exception as e:
            logger.error("[gigachat] OAuth exception: %s", str(e)[:500])
            self._gigachat_token = None
            self._gigachat_token_exp_ts = 0.0
            return ""

        try:
            data = json.loads(raw)
            token = (data.get("access_token") or "").strip()
            exp = data.get("expires_at")
            # expires_at is usually epoch ms; support seconds too
            if exp is None:
                exp_ts = now_ts + 300
            else:
                try:
                    exp_f = float(exp)
                    exp_ts = exp_f / 1000.0 if exp_f > 1e12 else exp_f
                except Exception:
                    exp_ts = now_ts + 300
            self._gigachat_token = token or None
            self._gigachat_token_exp_ts = exp_ts
            if not token:
                logger.error("[gigachat] OAuth response has no access_token: %s", raw[:500])
            return token
        except Exception:
            logger.error("[gigachat] OAuth JSON parse failed: %s", raw[:500])
            return ""

    def _gigachat_chat(self, *, messages: list[dict]) -> str:
        if not self.base_url:
            base = "https://gigachat.devices.sberbank.ru/api/v1"
        else:
            base = self.base_url
        url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"

        token = self._gigachat_get_token()
        if not token or token.lstrip().startswith("{"):
            # token retrieval returned raw error json (or nothing)
            if token:
                logger.error("[gigachat] OAuth token error response: %s", token[:500])
            else:
                logger.error("[gigachat] OAuth token is empty (check TLS/network and gigachat_basic_auth_b64)")
            return token or ""

        def _chat_with_model(model_name: str) -> tuple[int | None, str]:
            payload = {"model": model_name or "GigaChat", "messages": messages, "temperature": 0}
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Accept", "application/json")
            req.add_header("Authorization", f"Bearer {token}")
            try:
                with self._urlopen(req) as resp:
                    return int(getattr(resp, "status", 200) or 200), resp.read().decode("utf-8")
            except urllib.error.HTTPError as e:
                try:
                    return int(getattr(e, "code", 0) or 0), e.read().decode("utf-8")
                except Exception:
                    return int(getattr(e, "code", 0) or 0), ""
            except Exception:
                return None, ""

        model1 = (self.model or "GigaChat").strip()
        code, raw = _chat_with_model(model1)

        # If Lite/unknown model quota is exhausted, retry once with Pro.
        if code == 402 and model1.lower() != "gigachat-pro":
            logger.warning("[gigachat] Chat got 402 for model=%s; retrying with GigaChat-Pro", model1)
            code, raw = _chat_with_model("GigaChat-Pro")

        if code not in (200, None) and code != 0:
            try:
                preview = [(m.get("role"), (m.get("content") or "")[:200]) for m in (messages or [])]
            except Exception:
                preview = []
            logger.error("[gigachat] Chat HTTP %s url=%s model=%s msgs=%s body=%s", code, url, model1, preview, (raw or "")[:2000])
            return ""
        if not raw:
            try:
                preview = [(m.get("role"), (m.get("content") or "")[:200]) for m in (messages or [])]
            except Exception:
                preview = []
            logger.error("[gigachat] Chat empty response url=%s model=%s msgs=%s", url, model1, preview)
            return ""

        try:
            data = json.loads(raw)
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
        except Exception:
            try:
                preview = [(m.get("role"), (m.get("content") or "")[:200]) for m in (messages or [])]
            except Exception:
                preview = []
            logger.error("[gigachat] Chat JSON parse failed url=%s model=%s msgs=%s raw=%s", url, model1, preview, raw[:2000])
            return ""

    @staticmethod
    def _parse_json_object(text: str) -> dict | None:
        if not text:
            return None
        try:
            obj = json.loads(text)
            return obj if isinstance(obj, dict) else None
        except Exception:
            pass
        # Fallback: extract first {...} block (handles ```json ... ```)
        l = text.find("{")
        r = text.rfind("}")
        if l == -1 or r == -1 or r <= l:
            return None
        try:
            obj = json.loads(text[l : r + 1])
            return obj if isinstance(obj, dict) else None
        except Exception:
            return None

    @staticmethod
    def _has_temporal_marker(text: str) -> bool:
        t = (text or "").lower()
        if not t:
            return False
        weekday_words = (
            "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
            "пн", "вт", "ср", "чт", "пт", "сб", "вс",
        )
        if any(w in t for w in ("сегодня", "завтра", "послезавтра", "утром", "днем", "днём", "вечером", "ночью")):
            return True
        if any(w in t for w in weekday_words):
            return True
        # "в 9", "в 21", "в 9:00"
        if re.search(r"\bв\s*\d{1,2}(:\d{2})?\b", t):
            return True
        # Explicit hh:mm anywhere in text
        if re.search(r"\b\d{1,2}:\d{2}\b", t):
            return True
        return False

    @staticmethod
    def _weekday_mentioned_without_explicit_time(text: str) -> bool:
        t = (text or "").lower()
        weekday_words = (
            "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
            "пн", "вт", "ср", "чт", "пт", "сб", "вс",
        )
        if not any(w in t for w in weekday_words):
            return False
        if re.search(r"\b\d{1,2}:\d{2}\b", t) or re.search(r"\bв\s*\d{1,2}(:\d{2})?\b", t):
            return False
        if any(x in t for x in ("утром", "днем", "днём", "вечером", "ночью", "в обед")):
            return False
        return True

    @staticmethod
    def _pick_daytime_slot(text: str) -> tuple[int, int]:
        # "Random-like" stable slot in 14:00..16:45, quarter minutes.
        key = sum(ord(ch) for ch in (text or ""))
        hours = (14, 15, 16)
        minutes = (0, 15, 30, 45)
        hour = hours[key % len(hours)]
        minute = minutes[(key // len(hours)) % len(minutes)]
        return hour, minute

    @staticmethod
    def _fallback_alarm_time(text: str, now: datetime) -> str:
        t = (text or "").lower()
        base = now if getattr(now, "tzinfo", None) else now.replace(tzinfo=timezone.utc)
        target = base

        if "послезавтра" in t:
            target = target + timedelta(days=2)
        elif "завтра" in t:
            target = target + timedelta(days=1)

        # hh:mm first, then "в 9"
        hour = None
        minute = None
        m_hm = re.search(r"\b(\d{1,2}):(\d{2})\b", t)
        if m_hm:
            hour = int(m_hm.group(1))
            minute = int(m_hm.group(2))
        else:
            m_h = re.search(r"\bв\s*(\d{1,2})\b", t)
            if m_h:
                hour = int(m_h.group(1))
                minute = 0

        if hour is None:
            if "утром" in t:
                hour, minute = 9, 0
            elif "вечером" in t:
                hour, minute = 20, 0
            elif "днем" in t or "днём" in t:
                hour, minute = 14, 0
            elif LLMClient._weekday_mentioned_without_explicit_time(t):
                hour, minute = LLMClient._pick_daytime_slot(t)
            else:
                dt = base + timedelta(hours=1)
                return dt.replace(second=0, microsecond=0).isoformat()

        hour = max(0, min(hour, 23))
        minute = max(0, min(minute or 0, 59))
        dt = target.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if dt <= base:
            dt = dt + timedelta(days=1)
        return dt.isoformat()

    def extract_nlu_json(
        self,
        text: str,
        *,
        lat: float | None = None,
        lon: float | None = None,
        now: datetime | None = None,
    ) -> dict:
        """
        Returns raw NLU JSON (dict) from LLM.

        This is intentionally separate from extract_intent(), which must preserve existing contract.
        """
        # IMPORTANT: LLM must know "current" datetime to resolve относительные слова
        # like "сегодня/завтра/послезавтра/позже".
        # If we don't inject it, examples in prompt dominate and time may end up in the past.
        if now is None:
            now = datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        provider = (self.provider or "").strip().lower()
        if provider not in ("deepseek", "gigachat"):
            # No fallback heuristics here: explicitly report that LLM is not available.
            return {"type": "unknown", "error": "no_ai_connection"}

        # Stage 1: classify type + extract base time/due_date (short prompt, reduces "unknown")
        stage1_prompt = self._load_prompt_from_file("stage1/prompt.txt") or self._load_prompt_from_file("nlu_stage1_prompt.txt") or (
            'Верни JSON: {"type":"timer|text-timer|approx-alarm|task|memory|memory-geo|geo-alarm|unknown","why":str,"time"?:str,"due_date"?:str,"text"?:str}. '
            'why — 1-3 слова, причина выбора type. '
            "Если несколько команд — выбери первую."
        )
        stage1_prompt = f"{stage1_prompt}\n\nNOW={now.isoformat()}"
        messages1 = [
            {"role": "system", "content": stage1_prompt},
            {"role": "user", "content": text or ""},
        ]
        content1 = self._deepseek_chat(messages=messages1) if provider == "deepseek" else self._gigachat_chat(messages=messages1)
        if not (content1 or "").strip():
            return {"type": "unknown", "error": "no_ai_connection"}
        obj1 = self._parse_json_object(content1) or {}
        typ = str(obj1.get("type") or "unknown").strip().lower()
        why1 = str(obj1.get("why") or "").strip() if isinstance(obj1, dict) else ""
        if typ == "unknown" and self._has_temporal_marker(text):
            # Guardrail: never keep unknown when the phrase contains time/date markers.
            typ = "approx-alarm"
            why1 = why1 or "есть время"
            obj1 = dict(obj1) if isinstance(obj1, dict) else {}
            obj1["type"] = "approx-alarm"
            if not isinstance(obj1.get("why"), str) or not obj1.get("why", "").strip():
                obj1["why"] = "есть время"

        if typ == "unknown":
            if why1:
                return {"type": "unknown", "why": why1}
            # Ask explicit unknown prompt to get a short reason (why).
            stage2_prompt = self._load_prompt_from_file("stage2/unknown.txt") or 'Верни {"type":"unknown","why":"нет команды"}'
            stage2_prompt = f"{stage2_prompt}\n\nNOW={now.isoformat()}"
            messages2 = [
                {"role": "system", "content": stage2_prompt},
                {"role": "user", "content": (text or "").strip()},
            ]
            content2 = self._deepseek_chat(messages=messages2) if provider == "deepseek" else self._gigachat_chat(messages=messages2)
            if not (content2 or "").strip():
                return {"type": "unknown", "error": "no_ai_connection"}
            obj2 = self._parse_json_object(content2) or {}
            why2 = str(obj2.get("why") or "").strip() if isinstance(obj2, dict) else ""
            return {"type": "unknown", "why": (why2 or "нет why")}

        # Stage 2: type-specific extractor (fills the rest)
        stage2_prompt = self._load_prompt_from_file(f"stage2/{typ}.txt") or self._load_prompt_from_file(f"nlu_stage2_{typ}.txt")
        if not stage2_prompt:
            # Backward-compatible fallback to old monolithic prompt (var/file)
            stage2_prompt = self.nlu_system_prompt or self._load_nlu_prompt_from_file() or 'Верни JSON {"type":"unknown"}'
        stage2_prompt = f"{stage2_prompt}\n\nNOW={now.isoformat()}"
        user_text = (text or "").strip()
        # Provide Stage1 output as extra context for Stage2 (helps avoid re-deriving type/time).
        try:
            stage1_json = json.dumps(obj1, ensure_ascii=False)
        except Exception:
            stage1_json = ""
        if stage1_json:
            user_text = f"{user_text}\n\nSTAGE1_JSON={stage1_json}"
        if lat is not None and lon is not None:
            user_text = f"{user_text}\n\nDEVICE_COORDS lat={lat} lon={lon}"
        messages2 = [
            {"role": "system", "content": stage2_prompt},
            {"role": "user", "content": user_text},
        ]
        content2 = self._deepseek_chat(messages=messages2) if provider == "deepseek" else self._gigachat_chat(messages=messages2)
        if not (content2 or "").strip():
            return {"type": "unknown", "error": "no_ai_connection"}
        obj2 = self._parse_json_object(content2) or {}

        # Merge: stage2 details + stage1 guaranteed fields
        out = dict(obj2) if isinstance(obj2, dict) else {}
        out["type"] = typ
        if isinstance(out.get("why"), str) and out["why"].strip():
            out["why"] = out["why"].strip()
        elif why1:
            out["why"] = why1
        else:
            out["why"] = "нет why"
        if isinstance(obj1.get("time"), str) and obj1["time"].strip():
            out["time"] = obj1["time"].strip()
        if isinstance(obj1.get("due_date"), str) and obj1["due_date"].strip() and "due_date" not in out:
            out["due_date"] = obj1["due_date"].strip()
        if isinstance(obj1.get("text"), str) and obj1["text"].strip() and "text" not in out:
            out["text"] = obj1["text"].strip()

        if typ in ("alarm", "approx-alarm") and not (isinstance(out.get("time"), str) and out["time"].strip()):
            out["time"] = self._fallback_alarm_time(text, now)

        # Deterministic normalization: weekday phrases like "в воскресенье" should map to ближайший день,
        # not "next week", unless user explicitly said "следующее/через неделю".
        if typ in ("alarm", "approx-alarm") and isinstance(out.get("time"), str) and out["time"].strip():
            try:
                base = now if getattr(now, "tzinfo", None) else now.replace(tzinfo=timezone.utc)
                dt = dt_parse(out["time"].strip())
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=base.tzinfo)
                t = (text or "").lower()
                if not any(x in t for x in ("следующ", "через неделю", "через 1 неделю")):
                    weekday_map = {
                        "понедельник": 0, "пн": 0,
                        "вторник": 1, "вт": 1,
                        "среда": 2, "ср": 2,
                        "четверг": 3, "чт": 3,
                        "пятница": 4, "пт": 4,
                        "суббота": 5, "сб": 5,
                        "воскресенье": 6, "вс": 6,
                    }
                    target_wd = next((wd for k, wd in weekday_map.items() if k in t), None)
                    if target_wd is not None:
                        delta = (target_wd - base.weekday()) % 7
                        nearest = (base + timedelta(days=delta)).date()
                        # If LLM jumped by +7 days (or more), snap to ближайший weekday.
                        if (dt.date() - nearest).days >= 7:
                            dt = dt.replace(year=nearest.year, month=nearest.month, day=nearest.day)
                # For weekday reminders without explicit time, avoid midnight default.
                if self._weekday_mentioned_without_explicit_time(t) and dt.hour == 0 and dt.minute == 0:
                    hh, mm = self._pick_daytime_slot(t)
                    dt = dt.replace(hour=hh, minute=mm, second=0, microsecond=0)
                out["time"] = dt.isoformat()
            except Exception:
                pass
        return out or {"type": "unknown"}

    def intent_from_nlu_json(
        self,
        obj: dict,
        *,
        lat: float | None,
        lon: float | None,
        now: datetime,
    ) -> Intent:
        """
        Deterministic mapping from *extended* raw NLU JSON to internal Intent.
        Keeps create_reminder() working even if we changed NLU schema.
        """
        typ = str((obj or {}).get("type") or "").strip().lower()
        if typ in ("timer", "text-timer"):
            seconds = self._iso_duration_to_seconds(str((obj or {}).get("time") or ""))
            if seconds is None:
                return UnknownIntent(type="unknown")
            return ReminderIntent(type="time", due_at=now + timedelta(seconds=seconds))

        if typ in ("alarm", "approx-alarm"):
            t = str((obj or {}).get("time") or "").strip()
            if not t:
                return UnknownIntent(type="unknown")
            try:
                dt = dt_parse(t)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=now.tzinfo or timezone.utc)
            except Exception:
                return UnknownIntent(type="unknown")
            if dt <= now:
                dt = now + timedelta(hours=1)
            return ReminderIntent(type="time", due_at=dt)

        if typ == "geo":
            try:
                geo_lat = float((obj or {}).get("lat")) if (obj or {}).get("lat") is not None else lat
                geo_lon = float((obj or {}).get("lon")) if (obj or {}).get("lon") is not None else lon
            except Exception:
                geo_lat, geo_lon = lat, lon
            if geo_lat is None or geo_lon is None:
                return UnknownIntent(type="unknown")
            try:
                radius_m = int((obj or {}).get("radius_m") or 150)
            except Exception:
                radius_m = 150
            return GeoIntent(type="geo", location=GeoPoint(lat=geo_lat, lon=geo_lon), radius_m=radius_m)

        return UnknownIntent(type="unknown")

    def _map_nlu_json_to_intent(
        self,
        obj: dict,
        *,
        lat: float | None,
        lon: float | None,
        now: datetime,
    ) -> Intent:
        # Accept both schemas:
        # - {"type":"time","duration_sec":15}
        # - {"intent":"timer","duration_sec":15}
        typ = (obj.get("type") or obj.get("intent") or "").strip().lower()

        if typ in ("timer", "time"):
            duration_sec = obj.get("duration_sec")
            if duration_sec is None:
                return UnknownIntent(type="unknown")
            try:
                seconds = int(duration_sec)
            except Exception:
                return UnknownIntent(type="unknown")
            if seconds <= 0:
                return UnknownIntent(type="unknown")
            return ReminderIntent(type="time", due_at=now + timedelta(seconds=seconds))

        if typ == "geo":
            # Prefer explicit coords from LLM; fallback to device coords
            try:
                geo_lat = float(obj.get("lat")) if obj.get("lat") is not None else lat
                geo_lon = float(obj.get("lon")) if obj.get("lon") is not None else lon
            except Exception:
                geo_lat, geo_lon = lat, lon
            if geo_lat is None or geo_lon is None:
                return UnknownIntent(type="unknown")
            try:
                radius_m = int(obj.get("radius_m") or 150)
            except Exception:
                radius_m = 150
            return GeoIntent(type="geo", location=GeoPoint(lat=geo_lat, lon=geo_lon), radius_m=radius_m)

        return UnknownIntent(type="unknown")
    
    def extract_intent(
        self,
        text: str,
        *,
        lat: float | None = None,
        lon: float | None = None,
        now: datetime | None = None,
    ) -> Intent:
        now = now or datetime.now(timezone.utc)

        provider = (self.provider or "").strip().lower()
        if provider not in ("deepseek", "gigachat"):
            return self._extract_intent_mvp(text, lat=lat, lon=lon, now=now)

        system_prompt = (
            self.nlu_system_prompt
            or self._load_nlu_prompt_from_file()
            or (
                'Ты NLU модуль голосового ассистента. Верни ТОЛЬКО валидный JSON-объект без markdown. '
                'Схема: {"type":"time|geo|unknown","duration_sec"?:int,"lat"?:float,"lon"?:float,"radius_m"?:int}. '
                'Для "поставь таймер на 15 секунд" верни {"type":"time","duration_sec":15}.'
            )
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text or ""},
        ]
        content = self._deepseek_chat(messages=messages) if provider == "deepseek" else self._gigachat_chat(messages=messages)
        obj = self._parse_json_object(content)
        if obj is None:
            return UnknownIntent(type="unknown")
        return self._map_nlu_json_to_intent(obj, lat=lat, lon=lon, now=now)
