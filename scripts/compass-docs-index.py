"""Python Compass: the official Python documentation's index, as the only links cards and the AI may give (docs/compass.md).

Sphinx publishes every documented name with its page and anchor in `objects.inv`. This reads the index of the Python
version the course runs (3.12, the lab's) and writes lib/compass/python-docs-<version>.json: {name: url} for every
function, class, method, module, keyword and glossary term, plus the language reference's labelled sections. A link
that isn't in it is never shown to a learner.

    python -I scripts/compass-docs-index.py [--version 3.12]
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
import zlib
from pathlib import Path

# The roles worth linking to (std:label covers the reference's sections, e.g. "f-strings", "comprehensions").
ROLES = {
    "py:function", "py:class", "py:method", "py:module", "py:exception", "py:attribute", "py:data", "py:classmethod",
    "py:staticmethod", "std:term", "std:label", "std:keyword", "std:token", "std:2to3fixer",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="3.12")
    parser.add_argument("--out-dir", type=Path, default=Path("lib/compass"))
    args = parser.parse_args()
    base = f"https://docs.python.org/{args.version}/"
    request = urllib.request.Request(base + "objects.inv", headers={"User-Agent": "academia-compass-docs-index"})
    raw = urllib.request.urlopen(request, timeout=30).read()

    # Four header lines, then zlib-compressed "name domain:role priority uri display-name" lines.
    header_end = 0
    for _ in range(4):
        header_end = raw.index(b"\n", header_end) + 1
    project_version = raw[:header_end].decode("utf-8").splitlines()[2]
    body = zlib.decompress(raw[header_end:]).decode("utf-8")
    line = re.compile(r"(?x)(.+?)\s+(\S+:\S+)\s+(-?\d+)\s+(\S*)\s+(.*)")

    entries: dict[str, dict] = {}
    for text in body.splitlines():
        match = line.match(text.rstrip())
        if not match:
            continue
        name, role, _priority, uri, display = match.groups()
        if role not in ROLES:
            continue
        if uri.endswith("$"):
            uri = uri[:-1] + name
        key = f"{role}:{name}"
        entries[key] = {"url": base + uri, "title": name if display == "-" else display}

    out = args.out_dir / f"python-docs-{args.version}.json"
    out.write_text(json.dumps({"version": args.version, "source": base + "objects.inv", "project": project_version, "entries": entries}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts: dict[str, int] = {}
    for key in entries:
        role = ":".join(key.split(":")[:2])
        counts[role] = counts.get(role, 0) + 1
    print(f"{len(entries)} entries ({project_version}) -> {out}")
    print(", ".join(f"{role} {count}" for role, count in sorted(counts.items(), key=lambda item: -item[1])))


if __name__ == "__main__":
    main()
