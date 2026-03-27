from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CreateStatusIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class UpdateStatusIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class ReorderStatusesIn(BaseModel):
    ids: list[UUID]


class StatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    color: str
    sort_order: int
    created_at: datetime
