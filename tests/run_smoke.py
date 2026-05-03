#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
PYTHON = sys.executable


def run_step(title: str, command: list[str]) -> None:
    print(f"[smoke] {title}")
    result = subprocess.run(command, cwd=ROOT_DIR)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


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

    print("[smoke] All checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())