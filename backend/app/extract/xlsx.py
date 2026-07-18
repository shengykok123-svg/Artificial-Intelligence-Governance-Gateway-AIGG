from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import dataclass

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS = f"{{{SPREADSHEET_NS}}}"
ET.register_namespace("", SPREADSHEET_NS)


@dataclass(frozen=True)
class XlsxTextTarget:
    part_name: str
    kind: str
    index: int
    text: str


def extract_xlsx_text(raw: bytes) -> str:
    return "\n".join(target.text for target in iter_xlsx_text_targets(raw) if target.text)


def iter_xlsx_text_targets(raw: bytes) -> list[XlsxTextTarget]:
    targets: list[XlsxTextTarget] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for idx, si in enumerate(root.findall(f"{NS}si")):
                text = _joined_text(si)
                if text:
                    targets.append(XlsxTextTarget("xl/sharedStrings.xml", "shared", idx, text))

        for part_name in sorted(name for name in archive.namelist() if name.startswith("xl/worksheets/") and name.endswith(".xml")):
            root = ET.fromstring(archive.read(part_name))
            inline_idx = 0
            for cell in root.iter(f"{NS}c"):
                if cell.attrib.get("t") != "inlineStr":
                    continue
                inline = cell.find(f"{NS}is")
                if inline is None:
                    continue
                text = _joined_text(inline)
                if text:
                    targets.append(XlsxTextTarget(part_name, "inline", inline_idx, text))
                inline_idx += 1
    return targets


def redact_xlsx_bytes(raw: bytes, replacements: Mapping[XlsxTextTarget, str]) -> bytes:
    replacement_map = {
        (target.part_name, target.kind, target.index): redacted_text
        for target, redacted_text in replacements.items()
    }

    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as dest:
        for info in source.infolist():
            content = source.read(info.filename)
            if info.filename == "xl/sharedStrings.xml":
                content = _redact_shared_strings(info.filename, content, replacement_map)
            elif info.filename.startswith("xl/worksheets/") and info.filename.endswith(".xml"):
                content = _redact_inline_strings(info.filename, content, replacement_map)
            dest.writestr(info, content)
    return output.getvalue()


def _redact_shared_strings(part_name: str, content: bytes, replacement_map: Mapping[tuple[str, str, int], str]) -> bytes:
    root = ET.fromstring(content)
    changed = False
    for idx, si in enumerate(root.findall(f"{NS}si")):
        replacement = replacement_map.get((part_name, "shared", idx))
        if replacement is None:
            continue
        _replace_text(si, replacement)
        changed = True
    return _xml_bytes(root) if changed else content


def _redact_inline_strings(part_name: str, content: bytes, replacement_map: Mapping[tuple[str, str, int], str]) -> bytes:
    root = ET.fromstring(content)
    changed = False
    inline_idx = 0
    for cell in root.iter(f"{NS}c"):
        if cell.attrib.get("t") != "inlineStr":
            continue
        inline = cell.find(f"{NS}is")
        if inline is None:
            continue
        replacement = replacement_map.get((part_name, "inline", inline_idx))
        if replacement is not None:
            _replace_text(inline, replacement)
            changed = True
        inline_idx += 1
    return _xml_bytes(root) if changed else content


def _joined_text(parent: ET.Element) -> str:
    return "".join(text_node.text or "" for text_node in parent.iter(f"{NS}t"))


def _replace_text(parent: ET.Element, text: str) -> None:
    text_nodes = list(parent.iter(f"{NS}t"))
    if not text_nodes:
        text_node = ET.SubElement(parent, f"{NS}t")
        text_node.text = text
        return
    text_nodes[0].text = text
    for text_node in text_nodes[1:]:
        text_node.text = ""


def _xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


__all__ = ["XlsxTextTarget", "extract_xlsx_text", "iter_xlsx_text_targets", "redact_xlsx_bytes"]
