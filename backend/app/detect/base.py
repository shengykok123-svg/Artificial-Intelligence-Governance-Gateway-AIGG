# SHARED, FROZEN. Span, Document, Classification, Detector, DocumentClassifier.

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

DataClass = Literal["PERSON", "MYKAD", "EMAIL", "PHONE", "BANK_ACCT",
                    "SALARY", "SECRET", "DEPT_CONFIDENTIAL"]


@dataclass(frozen=True)
class Span:
    start: int              # character offset into Document.text
    end: int
    data_class: DataClass
    detector: str            # "rules" | "embed"
    confidence: float        # 0.0 - 1.0


@dataclass(frozen=True)
class Document:
    text: str
    source_filename: str | None   # None for the raw prompt
    mime: str                     # "text/plain" for the raw prompt


@dataclass(frozen=True)
class Classification:
    data_classes: list[DataClass]
    confidence: float
    spans: list[Span]
    content_department: str | None    # finance | hr | legal | engineering
    department_confidence: float      # 0.0 when content_department is None


class Detector(Protocol):
    def detect(self, doc: Document) -> list[Span]: ...


class DocumentClassifier(Protocol):
    def classify(self, doc: Document) -> tuple[str | None, float]: ...
    # Document-level label, NOT a span. Detector answers "where in this text";
    # DocumentClassifier answers "what is this text about". A future behaviour
    # classifier implements this same protocol with no contract change.


__all__ = [
    "DataClass", "Span", "Document", "Classification",
    "Detector", "DocumentClassifier",
]
