#!/usr/bin/env python3
"""
ctxpack.py — Context Packer for LLM/Agent consumption
Collapses an entire project into a single .ctx.md file.

Usage:
    python ctxpack.py [project_dir] [options]

Options:
    -o, --output FILE       Output file path (default: <project_name>.ctx.md)
    -e, --ext EXT [EXT...]  Whitelist of extensions (e.g. -e c h py asm)
    -x, --exclude DIR [..]  Extra dirs to exclude beyond .packignore
    --setup                 Generate a .packignore template in current dir
    --strip-comments        Strip single-line comments (// and #)
    --no-tree               Omit directory tree
    --max-lines N           Chunking/embedding options  Skip files longer than N lines (default: 2000)
    --summary               Print token estimate summary only (no file written)
    --chunk                 Enable line-based chunking of files
    --chunk-size N          Lines per chunk when --chunk is enabled (default: 200)
    --chunk-overlap N       Overlap lines between chunks (default: 20)
    --embed                 Compute deterministic embeddings for each chunk
    --embed-dim N           Embedding vector dimension when --embed is enabled (default: 512)
    --readable              Also generate a human-readable full context file (disabled by default)
    --readable-output FILE  Path for human-readable output (default: <project_name>.ctx.md)
    --semantic              Generate .sem.ctx.md with semantic DSL output (default: enabled)
    --no-semantic           Disable generation of .sem.ctx.md with semantic DSL output
    --semantic-only         Generate only the .sem.ctx.md, omit the standard .ctx.md
    --now TEXT              Manually set the NOW field (current project focus)
    --no-output FILE        Path for semantic output file (default: <project_name>.sem.ctx.md)

Examples:
    python ctxpack.py --setup  # Generate a .packignore template in current dir
    python ctxpack.py ./AlmaOS
    python ctxpack.py ./AlmaOS -e c h asm --strip-comments
    python ctxpack.py ./gfx -e c h --max-lines 500 -o gfx_context.ctx.md
"""

#import os
import sys
import argparse
import datetime
import hashlib
import math
import re
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
    "*.lock", ".git*", ".env",           # package-lock.json, Cargo.lock etc — optional, heavy
}


# ─────────────────────────────────────────────
# .PACKIGNORE PARSER
# ─────────────────────────────────────────────

def generate_packignore_template(project_dir: Path = Path.cwd()) -> None:
    """Generate a .packignore template in the current directory."""
    pack_template = project_dir / ".packignore.template"
    packignore = project_dir / ".packignore"

    # If .packignore already exists, do nothing
    if packignore.exists():
        print(f"[ctxpack] .packignore already exists at {packignore.resolve()}")
        return

    # Default template content to use when no template exists
    default_template = (
        "# .packignore — patterns to exclude from ctxpack\n"
        "# Lines starting with # are comments.\n"
        "# Examples:\n"
        "# node_modules\n"
        "# *.lock\n"
        "# build/\n"
    )

    try:
        # Ensure a template exists; create one from defaults if missing
        if not pack_template.exists():
            pack_template.write_text(default_template, encoding="utf-8")
            print(f"[ctxpack] Created template at {pack_template.resolve()}")

        # Copy template contents into .packignore
        content = pack_template.read_text(encoding="utf-8")
        packignore.write_text(content, encoding="utf-8")
        print(f"[ctxpack] Generated .packignore from template at {packignore.resolve()}")
    except Exception as e:
        print(f"[ctxpack] ERROR generating .packignore: {e}", file=sys.stderr)

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
    exclusion_filter=None,
) -> tuple[str, list[Path]]:
    """
    Returns:
        - ASCII tree string
        - Ordered list of file paths to include
    """
    if exclusion_filter is None:
        from filters.exclusion import ExclusionFilter
        exclusion_filter = ExclusionFilter()

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
            and not exclusion_filter.is_excluded(str(e.relative_to(project_dir)))
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
# CHUNKING & EMBEDDING (pure Python implementations)
# ─────────────────────────────────────────────


def chunk_text_lines(content: str, size: int, overlap: int):
    """Yield (start_line, end_line, chunk_text) for content split by lines.
    Lines are 1-based in reported ranges.
    """
    lines = content.splitlines()
    if size <= 0:
        yield (1, len(lines), "\n".join(lines))
        return
    i = 0
    total = len(lines)
    step = max(1, size - overlap)
    while i < total:
        start = i
        end = min(i + size, total)
        chunk = "\n".join(lines[start:end])
        yield (start + 1, end, chunk)
        i += step


def compute_embedding(text: str, dim: int = 64):
    """Deterministic, dependency-free embedding.

    Strategy: tokenize into alphanumeric tokens, for each token hash with sha256,
    and add the byte-values into a fixed-dimension vector which is finally
    L2-normalized. This provides a consistent numeric fingerprint usable for
    simple similarity/indexing without external libs.
    """
    vec = [0.0] * dim
    # simple tokenization
    toks = re.findall(r"\w+", text.lower())
    if not toks:
        return [0.0] * dim

    for tok in toks:
        h = hashlib.sha256(tok.encode("utf-8")).digest()  # 32 bytes
        for i in range(dim):
            # reuse the hashed bytes cyclically to fill dim
            vec[i] += h[i % len(h)]

    # normalize
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    vec = [v / norm for v in vec]
    return vec


def embedding_to_str(vec: list[float], max_values: int = None) -> str:
    """Serialize embedding to a compact comma-separated string (rounded).
    Optionally limit the number of values output (for readability).
    """
    if max_values is None or max_values >= len(vec):
        return ",".join(f"{v:.6f}" for v in vec)
    else:
        head = ",".join(f"{v:.6f}" for v in vec[:max_values])
        return head + ",..."


# ─────────────────────────────────────────────
# PACK BUILDER
# ─────────────────────────────────────────────

def build_pack(
    project_dir: Path,
    tokens_output_path: Path | None,
    readable_output_path: Path | None,
    allowed_extensions: set[str],
    extra_ignore: set[str],
    strip_comments: bool,
    include_tree: bool,
    max_lines: int,
    summary_only: bool,
    use_chunking: bool = False,
    chunk_size: int = 200,
    chunk_overlap: int = 20,
    do_embed: bool = False,
    embed_dim: int = 64,
) -> None:
    """Build two outputs:
    - tokens_output_path: compact, tokens/index-only file (default)
    - readable_output_path: optional human-readable full context (when requested)
    """
    ignore_patterns = load_packignore(project_dir)

    print(f"[ctxpack] Project:      {project_dir.resolve()}")
    print(f"[ctxpack] Extensions:   {', '.join(sorted(allowed_extensions))}")
    print(f"[ctxpack] Packignore:   {len(ignore_patterns)} pattern(s) loaded")
    print(f"[ctxpack] Strip cmts:   {strip_comments}")
    print(f"[ctxpack] Chunking:     {use_chunking} (size={chunk_size}, overlap={chunk_overlap})")
    print(f"[ctxpack] Embeddings:   {do_embed} (dim={embed_dim})")

    tree_str, files = build_tree(
        project_dir, ignore_patterns, allowed_extensions, extra_ignore, max_lines
    )

    # Prepare two representations
    tokens_sections = []
    readable_sections = []

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    header_tokens = (
        f"# TOKEN PACK — {project_dir.name.upper()}\n"
        f"Generated: {now}\n"
        f"Files included: {len(files)}\n"
        f"Chunking: {use_chunking} (size={chunk_size}, overlap={chunk_overlap})\n"
        f"Embeddings: {do_embed} (dim={embed_dim})\n"
        "---\n"
    )
    tokens_sections.append(header_tokens)

    header_readable = f"# CONTEXT PACK — {project_dir.name.upper()}\nGenerated: {now}\nFiles included: {len(files)}\nStrip comments: {strip_comments}\n---\n"
    if readable_output_path is not None:
        readable_sections.append(header_readable)

    # Include tree only in readable output (keeps tokens file compact)
    if include_tree and readable_output_path is not None:
        readable_sections.append("## DIRECTORY TREE\n```\n" + tree_str + "\n```\n")

    total_lines = 0
    index_entries = []  # (chunk_id, rel, start, end, embedding_str)
    chunk_id = 0

    for fpath in files:
        rel = fpath.relative_to(project_dir)
        ext = fpath.suffix.lstrip(".")

        try:
            content = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            content = f"[ERROR reading file: {e}]"

        if strip_comments and content:
            content = strip_single_line_comments(content, ext)

        if use_chunking and content:
            for start, end, chunk in chunk_text_lines(content, chunk_size, chunk_overlap):
                chunk_id += 1
                line_count = chunk.count("\n") + 1
                total_lines += line_count
                # readable: include chunk content
                if readable_output_path is not None:
                    lang = ext if ext else "text"
                    readable_sections.append(
                        f">>> CHUNK: {rel}  (lines {start}-{end})\n"
                        f"```{lang}\n{chunk.rstrip()}\n```\n"
                        f"<<< END CHUNK: {rel}  (lines {start}-{end})\n"
                    )
                # tokens/index: add embedding entry (no full text)
                if do_embed:
                    vec = compute_embedding(chunk, dim=embed_dim)
                    emb_str = embedding_to_str(vec, max_values=embed_dim)
                    index_entries.append((chunk_id, str(rel), start, end, emb_str))
        else:
            line_count = content.count("\n") + 1
            total_lines += line_count
            if readable_output_path is not None:
                lang = ext if ext else "text"
                readable_sections.append(
                    f">>> FILE: {rel}  ({line_count} lines)\n"
                    f"```{lang}\n{content.rstrip()}\n```\n"
                    f"<<< END: {rel}\n"
                )
            if do_embed:
                # treat whole file as one chunk for index purposes
                chunk_id += 1
                vec = compute_embedding(content, dim=embed_dim)
                emb_str = embedding_to_str(vec, max_values=embed_dim)
                index_entries.append((chunk_id, str(rel), 1, line_count, emb_str))

    # Write tokens/index output
    if do_embed and index_entries:
        tokens_sections.append("## INDEX\n")
        tokens_sections.append("ChunkID | File | Start | End | Embedding (truncated)\n")
        tokens_sections.append("---\n")
        for cid, fname, start, end, emb in index_entries:
            tokens_sections.append(f"{cid} | {fname} | {start} | {end} | {emb}\n")

    # Evaluate output sections for accurate summaries
    tokens_content = "".join(tokens_sections)
    readable_content = "".join(readable_sections)

    def make_footer(content: str, label: str) -> str:
        return (
            f"\n---\n"
            f"## PACK SUMMARY\n"
            f"- Files: {len(files)}\n"
            f"- Total lines: {total_lines:,}\n"
            f"- Estimated tokens: ~{estimate_tokens(content):,}\n"
            f"- Output size ({label}): ~{len(content) // 1024} KB\n"
            f"- Generated by: ctxpack.py\n"
        )

    tokens_output = None
    if tokens_output_path is not None:
        tokens_output = tokens_content + make_footer(tokens_content, "tokens file")

    readable_output = None
    if readable_output_path is not None:
        readable_output = readable_content + make_footer(readable_content, "readable file")

    token_estimate = estimate_tokens(readable_content if readable_output_path else tokens_content)
    
    if summary_only:
        print(f"[ctxpack] Files:           {len(files)}")
        print(f"[ctxpack] Total lines:     {total_lines:,}")
        print(f"[ctxpack] Estimated tokens: ~{token_estimate:,}")
        output_size = len(readable_output or tokens_output or "") // 1024
        print(f"[ctxpack] Output size: ~{output_size} KB")
        return

    # write tokens file if requested
    if tokens_output_path is not None and tokens_output is not None:
        tokens_output_path.write_text(tokens_output, encoding="utf-8")
        print(f"[ctxpack] Tokens output written:  {tokens_output_path.resolve()}")


    # optionally write readable file
    if readable_output_path is not None and readable_output is not None:
        readable_output_path.write_text(readable_output, encoding="utf-8")
        print(f"[ctxpack] Readable output written: {readable_output_path.resolve()}")



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
        help="Root directory of the project (e.g. . for current dir or ../path)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output file path for tokens output (default: <project_name>.tokens.ctx.md if --chunk/--embed enabled)",
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
        "--setup",
        action="store_true",
        help="Generate a .packignore template in the current directory and exit.",
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
    parser.add_argument(
        "--chunk",
        action="store_true",
        help="Split files into line-based chunks for indexing.",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=200,
        help="Lines per chunk when --chunk is enabled (default: 200).",
    )
    parser.add_argument(
        "--chunk-overlap",
        type=int,
        default=20,
        help="Overlap lines between consecutive chunks (default: 20).",
    )
    parser.add_argument(
        "--embed",
        action="store_true",
        help="Compute deterministic embeddings for each chunk (pure Python).",
    )
    parser.add_argument(
        "--embed-dim",
        type=int,
        default=64,
        help="Embedding vector dimension when --embed is enabled (default: 64).",
    )
    parser.add_argument(
        "--readable",
        action="store_true",
        help="Also generate a human-readable full context file (disabled by default).",
    )
    parser.add_argument(
        "--readable-output",
        default=None,
        help="Path for the human-readable output file (default: <project_name>.ctx.md).",
    )

    no_group = parser.add_argument_group("semantic DSL output")
    no_group.add_argument(
        "--semantic",
        action="store_true",
        help="Generate .sem.ctx.md with semantic DSL output (default: enabled)"
    )
    no_group.add_argument(
        "--no-semantic",
        action="store_false",
        dest="semantic",
        help="Disable generation of .sem.ctx.md with semantic DSL output"
    )
    parser.set_defaults(semantic=True)

    no_group.add_argument(
        "--semantic-only",
        action="store_true",
        help="Generate only the .sem.ctx.md file, omit the standard .ctx.md"
    )
    no_group.add_argument(
        "--now",
        metavar="TEXT",
        default="",
        help="Manually define the NOW field (current focus of the project)"
    )
    no_group.add_argument(
        "--no-output",
        dest="no_output",
        metavar="FILE",
        default=None,
        help="Path for the semantic output file (default: <project_name>.sem.ctx.md)"
    )

    args = parser.parse_args()

    if args.setup:
        generate_packignore_template()
        sys.exit(0)
    
    from filters.root_detector import detect_project_root
    
    start_dir = Path(args.project_dir).resolve()
    detected_root = Path(detect_project_root(str(start_dir)))
    
    if detected_root != start_dir:
        print(f"[ctxpack] Info: Adjusted project root from '{start_dir}' to detected root '{detected_root}'")
        project_dir = detected_root
    else:
        project_dir = start_dir

    if not project_dir.is_dir():
        print(f"[ctxpack] ERROR: '{project_dir}' is not a valid directory.", file=sys.stderr)
        sys.exit(1)

    allowed_ext = set(args.ext) if args.ext else DEFAULT_EXTENSIONS
    extra_ignore = set(args.exclude)

    # Exclude ctxpack.py itself if it's inside the project directory (common when running from project root)
    ctxpack_dir = Path(__file__).resolve().parent
    if ctxpack_dir != project_dir and ctxpack_dir.is_relative_to(project_dir):
        # We need the relative path from project_dir to exclude it
        rel_ctxpack = ctxpack_dir.relative_to(project_dir)
        extra_ignore.add(str(rel_ctxpack.parts[0]))

    ignore_patterns = load_packignore(project_dir)
    _, included_files = build_tree(
        project_dir, ignore_patterns, allowed_ext, extra_ignore, args.max_lines
    )
    args.included_files = included_files

    if args.semantic or args.semantic_only:
        from dsl_schema import DSLContext
        from dsl_builder import build_dsl
        from analyzers.lang_detector import LangDetector
        from analyzers.dep_extractor import DepExtractor
        from analyzers.module_mapper import ModuleMapper
        from analyzers.relation_finder import RelationFinder
        from analyzers.tag_parser import TagParser
        from analyzers.symbol_extractor import LanguageSymbolExtractor, SymbolExtractor

        ctx = DSLContext()
        ctx.project.name = project_dir.name
        if args.now:
            ctx.now = args.now

        for Analyzer in [LangDetector, DepExtractor, ModuleMapper,
                         RelationFinder, TagParser, SymbolExtractor]:
            Analyzer(project_dir, args).populate(ctx)

        no_path = args.no_output or str(
            project_dir / f"{ctx.project.name}.sem.ctx.md"
        )
        
        no_content = build_dsl(ctx)
        
        # Append semantic tokens and file size
        no_tokens = estimate_tokens(no_content)
        no_size_kb = len(no_content.encode("utf-8")) // 1024
        
        footer = (
            f"\n\n---\n"
            f"## SEMANTIC PACK SUMMARY\n"
            f"- Estimated tokens: ~{no_tokens:,}\n"
            f"- Output size: ~{no_size_kb} KB\n"
        )
        no_content += footer

        Path(no_path).write_text(no_content, encoding="utf-8")
        print(f"[ctxpack] Semantic DSL written to: {no_path}")

    if args.semantic_only:
        sys.exit(0)

    # Note: allowed_ext and extra_ignore are already defined above

    # Determine tokens output path (default: only if chunk/embed is true or output explicitly given)
    tokens_output = None
    if args.output:
        out = Path(args.output)
        if out.suffix == "":
            out = out.with_suffix(".md")
        tokens_output = out.resolve()
    elif args.chunk or args.embed:
        tokens_output = Path.cwd() / f"{project_dir.name}.tokens.ctx.md"

    # Determine readable output path if requested
    generate_readable = bool(args.readable)
    if generate_readable:
        if args.readable_output:
            ro = Path(args.readable_output)
            if ro.suffix == "":
                ro = ro.with_suffix(".md")
            readable_output = ro.resolve()
        else:
            readable_output = Path.cwd() / f"{project_dir.name}.ctx.md"
    else:
        readable_output = None

    # If no non-semantic output format is explicitly specified, and we are not in semantic-only mode:
    # Since people usually want the readable output by default if no flags are passed (and semantic_only is false),
    # but the behavior was changed to tokens, let's at least not generate empty tokens if !chunk and !embed.

    build_pack(
        project_dir=project_dir,
        tokens_output_path=tokens_output,
        readable_output_path=readable_output,
        allowed_extensions=allowed_ext,
        extra_ignore=extra_ignore,
        strip_comments=args.strip_comments,
        include_tree=not args.no_tree,
        max_lines=args.max_lines,
        summary_only=args.summary,
        use_chunking=args.chunk,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        do_embed=args.embed,
        embed_dim=args.embed_dim,
    )


if __name__ == "__main__":
    main()
