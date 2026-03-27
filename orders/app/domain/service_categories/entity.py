from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class ServiceCategory:
    id: UUID
    name: str
    created_at: datetime
