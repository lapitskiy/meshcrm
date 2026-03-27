from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class Status:
    id: UUID
    name: str
    color: str
    sort_order: int
    created_at: datetime
