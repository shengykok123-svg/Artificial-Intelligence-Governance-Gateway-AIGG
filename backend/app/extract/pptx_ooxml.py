from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class PptxXmlTextTarget:
    part_name: str
    index: int
    text: str


def extract_pptx_ooxml_text(raw: bytes) -> str:
    return "\n".join(target.text for target in iter_pptx_ooxml_text_targets(raw) if target.text)


def iter_pptx_ooxml_text_targets(raw: bytes) -> list[PptxXmlTextTarget]:
    targets: list[PptxXmlTextTarget] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for part_name in sorted(_candidate_part_names(archive.namelist())):
            root = ET.fromstring(archive.read(part_name))
            for idx, text_node in enumerate(_iter_text_nodes(root)):
                if text_node.text:
                    targets.append(PptxXmlTextTarget(part_name, idx, text_node.text))
    return targets


def redact_pptx_ooxml_bytes(raw: bytes, replacements: Mapping[PptxXmlTextTarget, str]) -> bytes:
    replacement_map = {
        (target.part_name, target.index): redacted_text
        for target, redacted_text in replacements.items()
    }

    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as dest:
        candidates = _candidate_part_names(source.namelist())
        for info in source.infolist():
            content = source.read(info.filename)
            if info.filename in candidates:
                content = _redact_part(info.filename, content, replacement_map)
            dest.writestr(info, content)
    return output.getvalue()


def _candidate_part_names(names: list[str]) -> set[str]:
    return {name for name in names if name.startswith("ppt/comments/") and name.endswith(".xml")}


def _redact_part(part_name: str, content: bytes, replacement_map: Mapping[tuple[str, int], str]) -> bytes:
    root = ET.fromstring(content)
    changed = False
    for idx, text_node in enumerate(_iter_text_nodes(root)):
        replacement = replacement_map.get((part_name, idx))
        if replacement is None:
            continue
        text_node.text = replacement
        changed = True
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) if changed else content


def _iter_text_nodes(root: ET.Element) -> list[ET.Element]:
    nodes: list[ET.Element] = []
    for node in root.iter():
        local_name = node.tag.rsplit("}", 1)[-1]
        if local_name in {"t", "text"} and node.text:
            nodes.append(node)
    return nodes


__all__ = [
    "PptxXmlTextTarget",
    "extract_pptx_ooxml_text",
    "iter_pptx_ooxml_text_targets",
    "redact_pptx_ooxml_bytes",
]
