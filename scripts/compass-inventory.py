"""The course's Python inventory (docs/compass.md): which Python constructs the course's notebooks use, how often, and
where each first appears, read with lib/compass/detector.py.

Usage, from the platform's root, with a checkout of the course repository:

    python -I scripts/compass-inventory.py <course repo checkout> [--out lib/compass/course-inventory.json]

It reads every lesson and project notebook under modules/ (code cells, and the Python code blocks of Markdown cells,
which learners read too), in course order, and writes the inventory as JSON (the cards' starting order) and a Markdown
report beside it. Learners' struggle signals re-rank the cards later; this ranks them by what the course asks of them.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib" / "compass"))
from detector import CONCEPTS, detect, label  # noqa: E402

FENCE = re.compile(r"```(?:python|py)\s*\n(.*?)```", re.S)
LESSON_CODE = re.compile(r"^(\d{2})-(\d{2})-")
# The course's setup cells (CONVENTIONS.md: "# Setup 1:" … within a cell's first lines): learners run them, the lessons
# don't teach them, so they're counted apart and don't rank the cards.
SETUP = re.compile(r"^\s*#\s*Setup\s*\d", re.M)


def is_setup(source: str) -> bool:
    return bool(SETUP.search("\n".join(source.split("\n")[:3])))


def notebooks(root: Path) -> list[Path]:
    """Lesson and project notebooks in course order: modules by number, a module's lessons, then its project."""
    found = sorted((root / "modules").rglob("*.ipynb"))

    def order(path: Path) -> tuple:
        parts = path.relative_to(root / "modules").parts
        return (parts[0], "project" in parts, "solutions" in parts, parts[-1])

    return sorted(found, key=order)


def lesson_of(root: Path, path: Path) -> dict:
    relative = path.relative_to(root).as_posix()
    match = LESSON_CODE.match(path.name)
    module = path.relative_to(root / "modules").parts[0]
    kind = "solution" if "solutions" in path.parts else "project" if "project" in path.parts else "lesson"
    code = f"{match.group(1)}.{match.group(2)}" if match else f"Project {module[:2]}"
    return {"path": relative, "code": code, "kind": kind, "module": module}


def code_blocks(path: Path) -> list[tuple[str, str]]:
    """(source, where) for each code cell and each Python block in a Markdown cell."""
    cells = json.loads(path.read_text(encoding="utf-8")).get("cells", [])
    blocks: list[tuple[str, str]] = []
    for index, cell in enumerate(cells, start=1):
        source = "".join(cell.get("source", [])) if isinstance(cell.get("source"), list) else cell.get("source", "")
        if cell.get("cell_type") == "code":
            blocks.append((source, f"cell {index}"))
        elif cell.get("cell_type") == "markdown":
            for fence in FENCE.findall(source):
                blocks.append((fence, f"cell {index} (Markdown)"))
    return blocks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo", type=Path)
    parser.add_argument("--out", type=Path, default=Path("lib/compass/course-inventory.json"))
    args = parser.parse_args()
    root: Path = args.repo.resolve()
    commit = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()

    concepts: dict[str, dict] = {}
    lessons: list[dict] = []
    unparsed: list[str] = []
    for order, path in enumerate(notebooks(root)):
        lesson = lesson_of(root, path)
        used: dict[str, int] = {}
        setup_used: set[str] = set()
        for source, where in code_blocks(path):
            if not source.strip():
                continue
            if is_setup(source):
                try:
                    setup_used.update(detect(source))
                except SyntaxError:
                    pass
                continue
            try:
                found = detect(source)
            except SyntaxError:
                unparsed.append(f"{lesson['path']} {where}")
                continue
            source_lines = source.split("\n")
            for key, lines in found.items():
                used[key] = used.get(key, 0) + len(lines)
                entry = concepts.setdefault(key, {"key": key, "lessons": [], "solutions": 0, "occurrences": 0, "first": None, "example": None})
                entry["occurrences"] += len(lines)
                if entry["example"] is None and lesson["kind"] != "solution":
                    line = source_lines[lines[0] - 1].strip() if 0 < lines[0] <= len(source_lines) else ""
                    entry["example"] = {"lesson": lesson["code"], "path": lesson["path"], "where": where, "line": line[:160]}
        for key in setup_used:
            entry = concepts.setdefault(key, {"key": key, "lessons": [], "solutions": 0, "occurrences": 0, "first": None, "example": None})
            entry["setup"] = entry.get("setup", 0) + 1
        for key in used:
            entry = concepts[key]
            if lesson["kind"] == "solution":
                entry["solutions"] += 1
            else:
                entry["lessons"].append(lesson["code"])
                if entry["first"] is None:
                    entry["first"] = {"lesson": lesson["code"], "order": order}
        lessons.append({**lesson, "concepts": sorted(used)})

    taught = [lesson for lesson in lessons if lesson["kind"] != "solution"]
    rows = []
    for key, entry in concepts.items():
        group, name, name_es = label(key)
        rows.append({
            "key": key,
            "group": group,
            "label": name,
            "labelEs": name_es,
            "lessonCount": len(entry["lessons"]),
            "share": round(len(entry["lessons"]) / max(1, len(taught)), 3),
            "solutions": entry["solutions"],
            "setupNotebooks": entry.get("setup", 0),
            "occurrences": entry["occurrences"],
            "firstLesson": entry["first"]["lesson"] if entry["first"] else None,
            "firstOrder": entry["first"]["order"] if entry["first"] else None,
            "lessons": entry["lessons"],
            "example": entry["example"],
        })
    # The cards' starting order: the more lessons need it, the sooner; on a tie, the one met first.
    rows.sort(key=lambda row: (-row["lessonCount"], row["firstOrder"] if row["firstOrder"] is not None else 10**6))
    # Only in setup cells (or solutions): last, whatever their counts.
    rows = [row for row in rows if row["lessonCount"]] + [row for row in rows if not row["lessonCount"]]
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    unused = sorted(key for key in CONCEPTS if key not in concepts)

    inventory = {
        "course": "langchain-langgraph-mastery",
        "commit": commit,
        "notebooks": len(lessons),
        "taughtNotebooks": len(taught),
        "unparsedBlocks": unparsed,
        "concepts": rows,
        "unusedConcepts": [dict(zip(("key", "group", "label", "labelEs"), (key, *label(key)))) for key in unused],
        "lessons": lessons,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(inventory, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    report = [
        "# The course's Python, by use",
        "",
        f"Generated by `scripts/compass-inventory.py` from the course repository at commit `{commit[:12]}`: "
        f"{len(taught)} lesson and project notebooks (and {len(lessons) - len(taught)} solutions), code cells and the "
        "Python blocks of Markdown cells, setup cells apart (`# Setup N:`, which learners run but don't study). "
        "**Lessons** is how many notebooks teach with it; the order is the cards' starting order (learners' signals "
        "re-rank it later). A concept only in setup cells or solutions ranks last.",
        "",
        "| # | Concept | Group | Lessons | First in | Lines | In setup | Example |",
        "|---:|---|---|---:|---|---:|---:|---|",
    ]
    for row in rows:
        example = (row["example"] or {}).get("line", "").replace("|", "\\|")
        report.append(f"| {row['rank']} | {row['label']} (`{row['key']}`) | {row['group']} | {row['lessonCount']} | {row['firstLesson'] or '-'} | {row['occurrences']} | {row['setupNotebooks']} | `{example}` |")
    report += ["", f"Detected but never used: {', '.join(f'`{key}`' for key in unused) or 'none'}.", ""]
    if unparsed:
        report += [f"Blocks that aren't valid Python (skipped): {len(unparsed)}.", ""]
    args.out.with_suffix(".md").write_text("\n".join(report), encoding="utf-8")
    print(f"{len(rows)} concepts from {len(taught)} notebooks ({len(unparsed)} blocks skipped) -> {args.out}")


if __name__ == "__main__":
    main()
