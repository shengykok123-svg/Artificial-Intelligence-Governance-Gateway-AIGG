from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import dataclass

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
ET.register_namespace("w", W_NS)


@dataclass(frozen=True)
class DocxXmlTextTarget:
    part_name: str
    index: int
    text: str


def extract_docx_ooxml_text(raw: bytes) -> str:
    return "\n".join(target.text for target in iter_docx_ooxml_text_targets(raw) if target.text)


def iter_docx_ooxml_text_targets(raw: bytes) -> list[DocxXmlTextTarget]:
    targets: list[DocxXmlTextTarget] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for part_name in sorted(_candidate_part_names(archive.namelist())):
            root = ET.fromstring(archive.read(part_name))
            for idx, text_node in enumerate(_iter_comment_or_revision_text(root, is_comment=part_name == "word/comments.xml")):
                if text_node.text:
                    targets.append(DocxXmlTextTarget(part_name, idx, text_node.text))
    return targets


def redact_docx_ooxml_bytes(raw: bytes, replacements: Mapping[DocxXmlTextTarget, str]) -> bytes:
    replacement_map = {
        (target.part_name, target.index): redacted_text
        for target, redacted_text in replacements.items()
    }

    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as dest:
        for info in source.infolist():
            content = source.read(info.filename)
            if info.filename in _candidate_part_names(source.namelist()):
                content = _redact_part(info.filename, content, replacement_map)
            dest.writestr(info, content)
    return output.getvalue()


def _candidate_part_names(names: list[str]) -> set[str]:
    candidates = {"word/comments.xml"} if "word/comments.xml" in names else set()
    for name in names:
        if name == "word/document.xml" or name.startswith(("word/header", "word/footer")):
            candidates.add(name)
    return candidates


def _redact_part(part_name: str, content: bytes, replacement_map: Mapping[tuple[str, int], str]) -> bytes:
    root = ET.fromstring(content)
    changed = False
    is_comment = part_name == "word/comments.xml"
    for idx, text_node in enumerate(_iter_comment_or_revision_text(root, is_comment=is_comment)):
        replacement = replacement_map.get((part_name, idx))
        if replacement is None:
            continue
        text_node.text = replacement
        changed = True
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) if changed else content


def _iter_comment_or_revision_text(root: ET.Element, *, is_comment: bool) -> list[ET.Element]:
    nodes: list[ET.Element] = []

    def visit(node: ET.Element, in_revision: bool) -> None:
        now_in_revision = in_revision or node.tag in {f"{W}ins", f"{W}del"}
        if node.tag in {f"{W}t", f"{W}delText"} and (is_comment or now_in_revision):
            nodes.append(node)
        for child in list(node):
            visit(child, now_in_revision)

    visit(root, False)
    return nodes


__all__ = [
    "DocxXmlTextTarget",
    "extract_docx_ooxml_text",
    "iter_docx_ooxml_text_targets",
    "redact_docx_ooxml_bytes",
]
