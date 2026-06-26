from typing import Literal

from pydantic import BaseModel, Field, field_validator


FIELD_KEYS = ("fileType", "entityName", "entityType", "fileNumber", "fileDate", "securedParty")
FieldKey = Literal["fileType", "entityName", "entityType", "fileNumber", "fileDate", "securedParty"]


class BoundingBox(BaseModel):
    page: int = Field(ge=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)


class ExtractionField(BaseModel):
    value: str = Field(default="", max_length=500)
    confidence: float = Field(default=0, ge=0, le=1)
    boundingBox: BoundingBox | None = None
    confirmed: bool = False

    @field_validator("value")
    @classmethod
    def clean_value(cls, value: str) -> str:
        return value.strip()


class ListingEntry(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    fileType: ExtractionField
    entityName: ExtractionField
    entityType: ExtractionField
    fileNumber: ExtractionField
    fileDate: ExtractionField
    securedParty: ExtractionField


class ListingMeta(BaseModel):
    preparedFor: str = ""
    clientMatter: str = ""
    projectNumber: str = ""
    projectMgr: str = ""
    jurisdiction: str = ""
    summary: str = ""
    thruDate: str = ""
    yearsSearched: str = ""
    debtor: str = ""
    partyLabel: str = "Secured Party"
    status: str = ""


class SaveBody(BaseModel):
    entries: list[ListingEntry] = Field(min_length=1, max_length=200)
    meta: ListingMeta | None = None


class PdfBody(BaseModel):
    meta: ListingMeta
    records: list[dict] = Field(default_factory=list)


class LogBody(BaseModel):
    action: str = Field(min_length=1, max_length=80)
    detail: dict = Field(default_factory=dict)


class CreateProject(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    preparedFor: str = ""
    clientMatter: str = ""
    projectManager: str = ""
    projectNumber: str = ""


class UpdateProject(BaseModel):
    name: str | None = None
    preparedFor: str | None = None
    clientMatter: str | None = None
    projectManager: str | None = None
    projectNumber: str | None = None


class NoRecordsMeta(BaseModel):
    debtor: str = Field(min_length=1, max_length=500)
    searchType: str = Field(min_length=1, max_length=200)
    jurisdiction: str = ""
    thruDate: str = ""
    yearsSearched: str = ""


class ReorderBody(BaseModel):
    jobIds: list[str] = Field(min_length=1)


def all_fields_confirmed(entries: list[ListingEntry]) -> bool:
    return all(getattr(entry, key).confirmed for entry in entries for key in FIELD_KEYS)
