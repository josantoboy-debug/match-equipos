#!/usr/bin/env python3
"""Reject encoding damage before a commit or CI run.

The checker is deliberately strict for source/workflow text:
- valid UTF-8 only;
- LF line endings only;
- no BOM in YAML;
- no NUL/unexpected C0 controls;
- no common UTF-8/Windows-1252 mojibake markers.

Binary/unknown extensions are skipped.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

TEXT_SUFFIXES = {
    ".html", ".htm", ".css", ".js", ".cjs", ".mjs", ".json", ".md",
    ".py", ".sh", ".txt", ".csv", ".tsv", ".xml", ".yml", ".yaml",
}
TEXT_NAMES = {".gitattributes", ".gitignore", ".editorconfig"}
MOJIBAKE_MARKERS = (
    "\ufffd",                 # replacement character
    "\u00c3",                 # common UTF-8/Latin-1 damage prefix
    "\u00c2",
    "\u00e2\u20ac",
    "\u00e2\u20ac\u2122",
    "\u00e2\u20ac\u0153",
    "\u00e2\u20ac\u009d",
)
ALLOWED_CONTROLS = {0x09, 0x0A, 0x0D}


def is_text_candidate(path: Path) -> bool:
    return path.name in TEXT_NAMES or path.suffix.lower() in TEXT_SUFFIXES


def check_path(path: Path) -> list[str]:
    problems: list[str] = []
    if not path.exists() or not path.is_file() or not is_text_candidate(path):
        return problems

    raw = path.read_bytes()
    if b"\r\n" in raw:
        problems.append("CRLF detectado; los fuentes deben almacenarse con LF")
    if b"\x00" in raw:
        problems.append("byte NUL detectado")

    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        return [f"UTF-8 inválido en byte {exc.start}: {exc.reason}"]

    if path.suffix.lower() in {".yml", ".yaml"} and text.startswith("\ufeff"):
        problems.append("BOM UTF-8 no permitido en workflow YAML")

    for i, ch in enumerate(text):
        cp = ord(ch)
        if cp < 0x20 and cp not in ALLOWED_CONTROLS:
            problems.append(f"carácter de control U+{cp:04X} en posición {i}")
            break

    found = sorted({marker for marker in MOJIBAKE_MARKERS if marker in text})
    if found:
        problems.append("posible mojibake: " + ", ".join(repr(x) for x in found))

    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", help="Archivos a validar")
    parser.add_argument(
        "--root",
        default=".",
        help="Raíz usada únicamente cuando no se pasan paths (default: .)",
    )
    args = parser.parse_args()

    if args.paths:
        paths = [Path(p) for p in args.paths]
    else:
        root = Path(args.root)
        paths = [p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts]

    failures = 0
    checked = 0
    for path in paths:
        if not is_text_candidate(path):
            continue
        checked += 1
        issues = check_path(path)
        if issues:
            failures += 1
            for issue in issues:
                print(f"TEXT_INTEGRITY_FAIL {path}: {issue}", file=sys.stderr)

    if failures:
        print(f"TEXT_INTEGRITY_RESULT fail files={failures} checked={checked}", file=sys.stderr)
        return 1

    print(f"TEXT_INTEGRITY_OK checked={checked}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
