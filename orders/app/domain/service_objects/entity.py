from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class ServiceObject:
    id: UUID
    service_category_id: UUID
    service_category_name: str
    name: str
    created_at: datetime
