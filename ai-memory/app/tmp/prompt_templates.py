"""LLM prompt templates."""


def get_intent_extraction_prompt(text: str) -> str:
    """Get prompt for intent extraction."""
    return f"""Extract intent from user command.

User command: "{text}"

Return JSON matching one of these schemas:
- {{"type": "time", "due_at": "ISO datetime"}}
- {{"type": "geo", "location": {{"lat": float, "lon": float}}, "radius_m": int}}
- {{"type": "unknown"}}

JSON only, no explanation."""
