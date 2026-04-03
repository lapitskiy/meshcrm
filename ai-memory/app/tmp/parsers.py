"""LLM response parsers (structured output parsing)."""

import json
from datetime import datetime

from ...contracts.intents import GeoIntent, Intent, ReminderIntent, UnknownIntent


def parse_intent_response(response: str) -> Intent:
    """Parse LLM response into Intent contract."""
    try:
        data = json.loads(response)
        intent_type = data.get("type")
        
        if intent_type == "time":
            # Parse ISO datetime string
            due_at = datetime.fromisoformat(data["due_at"].replace("Z", "+00:00"))
            return ReminderIntent(
                type="time",
                due_at=due_at,
            )
        elif intent_type == "geo":
            return GeoIntent(
                type="geo",
                location=data["location"],
                radius_m=data.get("radius_m", 150),
            )
        else:
            return UnknownIntent(type="unknown")
    except (json.JSONDecodeError, KeyError):
        return UnknownIntent(type="unknown")
