#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
PYTHON = sys.executable


def run_step(title: str, command: list[str]) -> None:
    print(f"[smoke] {title}")
    result = subprocess.run(command, cwd=ROOT_DIR)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def assert_query_output(title: str, output_path: Path) -> None:
    print(f"[smoke] {title}")
    content = output_path.read_text(encoding="utf-8")
    if not content.strip():
        raise SystemExit(f"[smoke] FAILED: {output_path} is empty")
    if "MOD:" not in content:
        raise SystemExit(f"[smoke] FAILED: {output_path} has no MOD: line")
    if "WHY:" not in content:
        raise SystemExit(f"[smoke] FAILED: {output_path} has no WHY: line")


def main() -> int:
    python_files = [
        "ctxpack.py",
        "dsl_builder.py",
        "dsl_schema.py",
        *sorted(str(path.relative_to(ROOT_DIR)) for path in (ROOT_DIR / "analyzers").glob("*.py")),
        *sorted(str(path.relative_to(ROOT_DIR)) for path in (ROOT_DIR / "analyzers/plugins").glob("*.py")),
        *sorted(str(path.relative_to(ROOT_DIR)) for path in (ROOT_DIR / "filters").glob("*.py")),
        str((ROOT_DIR / "tests/run_smoke.py").relative_to(ROOT_DIR)),
    ]

    run_step("Compiling Python sources", [PYTHON, "-m", "py_compile", *python_files])
    run_step(
        "Running relevance_ranker unit tests",
        [PYTHON, "-m", "unittest", "tests.test_relevance_ranker", "-v"],
    )
    run_step(
        "Generating semantic pack for repository root",
        [PYTHON, "ctxpack.py", ".", "--semantic-only", "--no-output", "CtxPack.sem.ctx.md"],
    )
    run_step(
        "Generating semantic pack for polyglot fixtures",
        [
            PYTHON,
            "ctxpack.py",
            "tests/prototypes",
            "--semantic-only",
            "--no-output",
            "tests/prototypes/prototypes.sem.ctx.md",
        ],
    )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        free_text_output = tmp_dir / "prototypes.query.sem.ctx.md"
        file_hint_output = tmp_dir / "prototypes.file-hint.query.sem.ctx.md"

        run_step(
            "Running targeted query (free text) against polyglot fixtures",
            [
                PYTHON,
                "ctxpack.py",
                "tests/prototypes",
                "--query",
                "class definition",
                "--query-top",
                "5",
                "--query-output",
                str(free_text_output),
            ],
        )
        assert_query_output("Checking free-text query output", free_text_output)

        run_step(
            "Running targeted query (--file hint) against polyglot fixtures",
            [
                PYTHON,
                "ctxpack.py",
                "tests/prototypes",
                "--query",
                "sample",
                "--file",
                "python_sample",
                "--query-top",
                "5",
                "--query-output",
                str(file_hint_output),
            ],
        )
        assert_query_output("Checking --file hint query output", file_hint_output)

    print("[smoke] All checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())