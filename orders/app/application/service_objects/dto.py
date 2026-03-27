from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CreateServiceObjectIn(BaseModel):
    service_category_id: UUID
    name: str = Field(min_length=1, max_length=120)


class UpdateServiceObjectIn(BaseModel):
    service_category_id: UUID
    name: str = Field(min_length=1, max_length=120)


class ServiceObjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    service_category_id: UUID
    service_category_name: str
    name: str
    created_at: datetime
