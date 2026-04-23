#!/usr/bin/env python3
"""
ctxpack.py — Context Packer for LLM/Agent consumption
Collapses an entire project into a single .ctx.md file.

Usage:
    python ctxpack.py [project_dir] [options]

Options:
    -o, --output FILE       Output file path (default: <project_name>.ctx.md)
    -e, --ext EXT [EXT...]  Whitelist of extensions (e.g. -e c h py asm)
    -x, --exclude DIR [..] Extra dirs to exclude beyond .packignore
    --strip-comments        Strip single-line comments (// and #)
    --no-tree               Omit directory tree
    --max-lines N           Skip files longer than N lines (default: 2000)
    --summary               Print token estimate summary only (no file written)

Examples:
    python ctxpack.py ./AlmaOS
    python ctxpack.py ./AlmaOS -e c h asm --strip-comments
    python ctxpack.py ./gfx -e c h --max-lines 500 -o gfx_context.ctx.md
"""

import os
import sys
import argparse
import datetime
from pathlib import Path

# ─────────────────────────────────────────────
# DEFAULT CONFIGURATION
# ─────────────────────────────────────────────

# Extensions included by default when no -e flag is given
DEFAULT_EXTENSIONS = {
    # C / Systems
    "c", "h", "cpp", "hpp", "cc", "cxx",
    # Assembly
    "asm", "s", "S",
    # Python
    "py",
    # Rust
    "rs",
    # JavaScript / TypeScript
    "js", "ts", "jsx", "tsx",
    # Web
    "html", "css", "scss",
    # Config / Build
    "toml", "yaml", "yml", "json", "cmake", "mk",
    # Makefile (no extension)
    "Makefile",
    # Docs
    "md", "txt",
    # Java / Kotlin
    "java", "kt",
    # Shell
    "sh", "bash",
}

# Always ignored directories regardless of .packignore
HARDCODED_IGNORE_DIRS = {
    ".git", ".svn", ".hg",
    "node_modules", "__pycache__", ".mypy_cache",
    "target",           # Rust build
    "build", "dist", "out", "bin", "obj",
    ".venv", "venv", "env",
    ".idea", ".vscode",
    "*.egg-info",
}

# Always ignored file patterns
HARDCODED_IGNORE_FILES = {
    ".DS_Store", "Thumbs.db",
    "*.pyc", "*.pyo",
    "*.o", "*.a", "*.so", "*.lib", "*.dll", "*.exe",
    "*.bin", "*.img", "*.iso",
    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.ico", "*.svg",
    "*.mp3", "*.mp4", "*.wav", "*.flac",
    "*.zip", "*.tar", "*.gz", "*.xz", "*.7z",
    "*.pdf", "*.docx", "*.xlsx",
    "*.lock",           # package-lock.json, Cargo.lock etc — optional, heavy
}


# ─────────────────────────────────────────────
# .PACKIGNORE PARSER
# ─────────────────────────────────────────────

def load_packignore(project_dir: Path) -> list[str]:
    """Load .packignore patterns from project root."""
    packignore_path = project_dir / ".packignore"
    if not packignore_path.exists():
        return []
    patterns = []
    with open(packignore_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns


def matches_pattern(name: str, patterns: list[str]) -> bool:
    """Simple glob-style pattern matching against a filename or dirname."""
    from fnmatch import fnmatch
    return any(fnmatch(name, pat) for pat in patterns)


def should_ignore_path(path: Path, project_dir: Path, ignore_patterns: list[str]) -> bool:
    """Check if a path should be excluded."""
    from fnmatch import fnmatch

    rel = path.relative_to(project_dir)
    parts = rel.parts

    # Check each path component against hardcoded ignored dirs
    for part in parts:
        if part in HARDCODED_IGNORE_DIRS:
            return True
        for pat in HARDCODED_IGNORE_FILES:
            if fnmatch(part, pat):
                return True

    # Check against .packignore patterns
    for pat in ignore_patterns:
        # Match against full relative path OR just the name
        if fnmatch(str(rel), pat) or fnmatch(path.name, pat):
            return True

    return False


# ─────────────────────────────────────────────
# COMMENT STRIPPING
# ─────────────────────────────────────────────

def strip_single_line_comments(content: str, ext: str) -> str:
    """
    Strip single-line comments from source files.
    Supported: // (C, JS, Java, Rust) and # (Python, bash, CMake)
    Does NOT strip block comments (too risky for API docs and macros).
    """
    if ext in {"c", "h", "cpp", "hpp", "cc", "cxx", "js", "ts", "jsx", "tsx",
               "java", "kt", "rs", "asm", "s", "S"}:
        comment_char = "//"
    elif ext in {"py", "sh", "bash", "yaml", "yml", "toml", "cmake", "mk"}:
        comment_char = "#"
    else:
        return content

    stripped_lines = []
    for line in content.splitlines():
        stripped = line.rstrip()
        # Find comment position, but skip if it's inside a string (basic heuristic)
        idx = stripped.find(comment_char)
        if idx >= 0:
            # Keep the line up to the comment (preserve indentation + code)
            before = stripped[:idx].rstrip()
            if before:  # keep the code before the comment
                stripped_lines.append(before)
            # else: entire line was a comment — drop it
        else:
            stripped_lines.append(stripped)

    # Remove consecutive blank lines left after stripping
    result = []
    prev_blank = False
    for line in stripped_lines:
        is_blank = line.strip() == ""
        if is_blank and prev_blank:
            continue
        result.append(line)
        prev_blank = is_blank

    return "\n".join(result)


# ─────────────────────────────────────────────
# DIRECTORY TREE BUILDER
# ─────────────────────────────────────────────

def build_tree(
    project_dir: Path,
    ignore_patterns: list[str],
    allowed_extensions: set[str],
    extra_ignore: set[str],
    max_lines: int,
) -> tuple[str, list[Path]]:
    """
    Returns:
        - ASCII tree string
        - Ordered list of file paths to include
    """
    tree_lines = []
    included_files = []

    def _walk(current_dir: Path, prefix: str):
        try:
            entries = sorted(current_dir.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return

        entries = [
            e for e in entries
            if not should_ignore_path(e, project_dir, ignore_patterns)
            and e.name not in extra_ignore
        ]

        for i, entry in enumerate(entries):
            connector = "└── " if i == len(entries) - 1 else "├── "
            extension = entry.suffix.lstrip(".") if entry.suffix else entry.name

            if entry.is_dir():
                tree_lines.append(f"{prefix}{connector}{entry.name}/")
                extension_prefix = "│   " if i < len(entries) - 1 else "    "
                _walk(entry, prefix + extension_prefix)
            elif entry.is_file():
                # Check extension
                if extension not in allowed_extensions and entry.name not in allowed_extensions:
                    continue
                try:
                    line_count = sum(1 for _ in open(entry, "r", encoding="utf-8", errors="replace"))
                except Exception:
                    continue
                if line_count > max_lines:
                    tree_lines.append(f"{prefix}{connector}{entry.name}  [SKIPPED: {line_count} lines > {max_lines}]")
                    continue
                tree_lines.append(f"{prefix}{connector}{entry.name}  ({line_count}L)")
                included_files.append(entry)

    tree_lines.append(f"{project_dir.name}/")
    _walk(project_dir, "")

    return "\n".join(tree_lines), included_files


# ─────────────────────────────────────────────
# TOKEN ESTIMATOR (rough: 1 token ≈ 4 chars)
# ─────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    return len(text) // 4


# ─────────────────────────────────────────────
# PACK BUILDER
# ─────────────────────────────────────────────

def build_pack(
    project_dir: Path,
    output_path: Path,
    allowed_extensions: set[str],
    extra_ignore: set[str],
    strip_comments: bool,
    include_tree: bool,
    max_lines: int,
    summary_only: bool,
) -> None:
    ignore_patterns = load_packignore(project_dir)

    print(f"[ctxpack] Project:      {project_dir.resolve()}")
    print(f"[ctxpack] Extensions:   {', '.join(sorted(allowed_extensions))}")
    print(f"[ctxpack] Packignore:   {len(ignore_patterns)} pattern(s) loaded")
    print(f"[ctxpack] Strip cmts:   {strip_comments}")
    print()

    tree_str, files = build_tree(
        project_dir, ignore_patterns, allowed_extensions, extra_ignore, max_lines
    )

    sections = []

    # ── Header ──────────────────────────────
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    header = f"""# CONTEXT PACK — {project_dir.name.upper()}
    Generated: {now}
    Files included: {len(files)}
    Strip comments: {strip_comments}

    ---
    ## HOW TO USE THIS FILE
    Paste this file into any LLM or agent context.
    Ask: "I will give you the full context of my project. Analyze it." and proceed.
    Each file is delimited by `>>>` and `<<<` markers.
    ---
    """
    sections.append(header)

    # ── Tree ────────────────────────────────
    if include_tree:
        sections.append("## DIRECTORY TREE\n```\n" + tree_str + "\n```\n")

    # ── Files ───────────────────────────────
    sections.append("## FILES\n")

    total_lines = 0
    for fpath in files:
        rel = fpath.relative_to(project_dir)
        ext = fpath.suffix.lstrip(".")

        try:
            content = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            content = f"[ERROR reading file: {e}]"

        if strip_comments and content:
            content = strip_single_line_comments(content, ext)

        line_count = content.count("\n") + 1
        total_lines += line_count

        lang = ext if ext else "text"
        sections.append(
            f">>> FILE: {rel}  ({line_count} lines)\n"
            f"```{lang}\n{content.rstrip()}\n```\n"
            f"<<< END: {rel}\n"
        )

    full_output = "\n".join(sections)
    token_estimate = estimate_tokens(full_output)

    # ── Footer ──────────────────────────────
    footer = (
        f"\n---\n"
        f"## PACK SUMMARY\n"
        f"- Files: {len(files)}\n"
        f"- Total lines: {total_lines:,}\n"
        f"- Estimated tokens: ~{token_estimate:,}\n"
        f"- Generated by: ctxpack.py\n"
    )
    full_output += footer

    if summary_only:
        print(f"[ctxpack] Files:           {len(files)}")
        print(f"[ctxpack] Total lines:     {total_lines:,}")
        print(f"[ctxpack] Estimated tokens: ~{token_estimate:,}")
        print(f"[ctxpack] Output size:     ~{len(full_output) // 1024} KB")
        return

    output_path.write_text(full_output, encoding="utf-8")

    print(f"[ctxpack] Files included:  {len(files)}")
    print(f"[ctxpack] Total lines:     {total_lines:,}")
    print(f"[ctxpack] Estimated tokens: ~{token_estimate:,}")
    print(f"[ctxpack] Output size:     ~{len(full_output) // 1024} KB")
    print(f"[ctxpack] Output written:  {output_path.resolve()}")


# ─────────────────────────────────────────────
# CLI ENTRYPOINT
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="ctxpack — Collapse a project into a single LLM-ready context file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "project_dir",
        nargs="?",
        default=".",
        help="Root directory of the project (default: current dir)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output file path (default: <project_name>.ctx.md)",
    )
    parser.add_argument(
        "-e", "--ext",
        nargs="+",
        default=None,
        metavar="EXT",
        help="Whitelist of file extensions (without dot). If omitted, uses built-in defaults.",
    )
    parser.add_argument(
        "-x", "--exclude",
        nargs="+",
        default=[],
        metavar="NAME",
        help="Additional directory or file names to exclude.",
    )
    parser.add_argument(
        "--strip-comments",
        action="store_true",
        help="Strip single-line comments (// and #) from source files.",
    )
    parser.add_argument(
        "--no-tree",
        action="store_true",
        help="Omit the directory tree section from the output.",
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=2000,
        help="Skip files with more than N lines (default: 2000).",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print token/file summary only — do not write output file.",
    )

    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    if not project_dir.is_dir():
        print(f"[ctxpack] ERROR: '{project_dir}' is not a valid directory.", file=sys.stderr)
        sys.exit(1)

    allowed_ext = set(args.ext) if args.ext else DEFAULT_EXTENSIONS
    extra_ignore = set(args.exclude)

    if args.output:
        out = Path(args.output)
        if out.suffix == "":
            out = out.with_suffix(".md")
        output_path = out.resolve()
    else:
        output_path = Path.cwd() / f"{project_dir.name}.ctx.md"

    build_pack(
        project_dir=project_dir,
        output_path=output_path,
        allowed_extensions=allowed_ext,
        extra_ignore=extra_ignore,
        strip_comments=args.strip_comments,
        include_tree=not args.no_tree,
        max_lines=args.max_lines,
        summary_only=args.summary,
    )


if __name__ == "__main__":
    main()
