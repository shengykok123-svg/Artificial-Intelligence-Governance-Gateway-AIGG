from __future__ import annotations

import io
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddedPackage:
    part_name: str
    filename: str
    mime: str
    raw: bytes


def iter_embedded_ooxml_packages(raw: bytes, prefix: str) -> list[EmbeddedPackage]:
    packages: list[EmbeddedPackage] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for name in sorted(archive.namelist()):
            if not name.startswith(prefix):
                continue
            embedded = archive.read(name)
            if not embedded.startswith(b"PK"):
                continue
            mime = _embedded_mime_for(name)
            if mime is None:
                continue
            packages.append(EmbeddedPackage(name, name.rsplit("/", 1)[-1], mime, embedded))
    return packages


def replace_embedded_packages(raw: bytes, replacements: Mapping[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as dest:
        written = set()
        for info in source.infolist():
            content = replacements.get(info.filename, source.read(info.filename))
            dest.writestr(info, content)
            written.add(info.filename)
        for filename, content in replacements.items():
            if filename not in written:
                dest.writestr(filename, content)
    return output.getvalue()


def _embedded_mime_for(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if lower.endswith(".pptx"):
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if lower.endswith(".xlsx"):
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return None


__all__ = ["EmbeddedPackage", "iter_embedded_ooxml_packages", "replace_embedded_packages"]
