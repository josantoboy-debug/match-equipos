#!/usr/bin/env python3
"""Print the exact Git blob SHA-1 for local files."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path


def git_blob_sha(path: Path) -> str:
    raw = path.read_bytes()
    header = f"blob {len(raw)}\0".encode("ascii")
    return hashlib.sha1(header + raw).hexdigest()


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: git_blob_sha.py ARCHIVO [ARCHIVO...]", file=sys.stderr)
        return 2
    for value in sys.argv[1:]:
        path = Path(value)
        if not path.is_file():
            print(f"BLOB_SHA_FAIL {path}: no existe", file=sys.stderr)
            return 1
        print(f"{git_blob_sha(path)}  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
