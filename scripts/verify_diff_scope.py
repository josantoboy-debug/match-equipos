#!/usr/bin/env python3
"""Fail if a candidate commit changes unexpected files or too many lines.

Example:
  python3 scripts/verify_diff_scope.py \
    --base <parent> --head <candidate> \
    --allow '.github/workflows/foo.yml:3' \
    --allow 'scripts/check.py:120'
"""
from __future__ import annotations

import argparse
import subprocess
import sys


def git(*args: str) -> str:
    cp = subprocess.run(
        ["git", *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return cp.stdout


def parse_allow(values: list[str]) -> dict[str, int]:
    allowed: dict[str, int] = {}
    for item in values:
        if ":" not in item:
            raise SystemExit(f"--allow inválido: {item!r}; use RUTA:MAX_CAMBIOS")
        path, max_changes = item.rsplit(":", 1)
        allowed[path] = int(max_changes)
    return allowed


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True)
    p.add_argument("--head", required=True)
    p.add_argument("--allow", action="append", default=[])
    p.add_argument("--max-total", type=int, default=500)
    args = p.parse_args()
    allowed = parse_allow(args.allow)

    out = git("diff", "--numstat", args.base, args.head, "--")
    total = 0
    seen: set[str] = set()
    failures: list[str] = []

    for line in out.splitlines():
        add_s, del_s, path = line.split("\t", 2)
        if add_s == "-" or del_s == "-":
            failures.append(f"{path}: archivo binario inesperado")
            continue
        changes = int(add_s) + int(del_s)
        total += changes
        seen.add(path)
        if path not in allowed:
            failures.append(f"{path}: archivo fuera del scope permitido")
            continue
        if changes > allowed[path]:
            failures.append(
                f"{path}: {changes} cambios > máximo permitido {allowed[path]}"
            )

    if total > args.max_total:
        failures.append(f"total: {total} cambios > máximo permitido {args.max_total}")

    if failures:
        for failure in failures:
            print(f"DIFF_SCOPE_FAIL {failure}", file=sys.stderr)
        return 1

    print(
        "DIFF_SCOPE_OK "
        f"files={len(seen)} total_changes={total} allowed={len(allowed)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
