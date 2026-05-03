# CtxPack: Project Context Packer

`ctxpack.py` is a Python script that collapses an entire project's source code and structure into a single, LLM-friendly text file. This allows you to easily paste the entire context of a project into a large context window of a language model or agent.

- Português (pt-BR): [README.pt-BR.md](README.pt-BR.md)

## Features

- **Multiple Formats**: Creates different profiles (Semantic DSL by default `.sem.ctx.md`, Human Readable `.ctx.md` with `--readable`, and Token/Chunk files `.tokens.ctx.md`).
- **Semantic DSL Mode**: Structural semantic extraction with pure-Python analyzers, import/relation indexing, and smart inference for state, role, conventions, and missing metadata context.
- **Directory Tree**: Includes an ASCII directory tree for easy navigation.
- **Smart Filtering & Exclusion**: Automatic root detection and configurable category exclusions (build, vendor, test, doc, etc). Whitelist extensions and exclude specific directories/files.
- **Comment Stripping**: Option to remove single-line comments to save tokens.
- **File Size Limits**: Skip files that are too large.
- **Token Estimation**: Provides a rough estimate of the token count.
- **Polyglot Extraction**: Built-in semantic support for Python, JavaScript, TypeScript, Rust, Go, Java, Kotlin, C, C++, C#, PHP, Ruby, Lua, Swift, Dart, Shell, and more via plugins.
- **Metadata Fallbacks**: If `@role`, `@state`, `@ctx` and related tags are missing, CtxPack infers useful context from comments, symbols, filenames, and structure instead of requiring manual tagging.

## Usage

```text
usage: ctxpack.py [-h] [-o OUTPUT] [-e EXT [EXT ...]] [-x NAME [NAME ...]]
                  [--setup] [--strip-comments] [--no-tree]
                  [--max-lines MAX_LINES] [--summary] [--chunk]
                  [--chunk-size CHUNK_SIZE] [--chunk-overlap CHUNK_OVERLAP]
                  [--embed] [--embed-dim EMBED_DIM] [--readable]
                  [--readable-output READABLE_OUTPUT] [--update]
                  [--remote-url REMOTE_URL] [--semantic] [--no-semantic]
                  [--semantic-only] [--now TEXT] [--no-output FILE]
                  [project_dir]

ctxpack — Collapse a project into a single LLM-ready context file.

positional arguments:
  project_dir           Root directory of the project (e.g. ./path or
                        ../path). REQUIRED: pass a path

options:
  -h, --help            show this help message and exit
  -o OUTPUT, --output OUTPUT
                        Output file path for tokens output (default:
                        <project_name>.tokens.ctx.md if --chunk/--embed
                        enabled)
  -e EXT [EXT ...], --ext EXT [EXT ...]
                        Whitelist of file extensions (without dot). If
                        omitted, uses built-in defaults.
  -x NAME [NAME ...], --exclude NAME [NAME ...]
                        Additional directory or file names to exclude.
  --setup               Generate a .packignore template in the current
                        directory and exit.
  --strip-comments      Strip single-line comments (// and #) from source
                        files.
  --no-tree             Omit the directory tree section from the output.
  --max-lines MAX_LINES
                        Skip files with more than N lines (default: 2000).
  --summary             Print token/file summary only — do not write output
                        file.
  --chunk               Split files into line-based chunks for indexing.
  --chunk-size CHUNK_SIZE
                        Lines per chunk when --chunk is enabled (default:
                        200).
  --chunk-overlap CHUNK_OVERLAP
                        Overlap lines between consecutive chunks (default:
                        20).
  --embed               Compute deterministic embeddings for each chunk (pure
                        Python).
  --embed-dim EMBED_DIM
                        Embedding vector dimension when --embed is enabled
                        (default: 64).
  --readable            Also generate a human-readable full context file
                        (disabled by default).
  --readable-output READABLE_OUTPUT
                        Path for the human-readable output file (default:
                        <project_name>.ctx.md).
  --update              Fetch and apply updates from the canonical repository
                        (git@github.com:Gabryel-lima/CtxPack.git). Use to
                        update this installation.
  --remote-url REMOTE_URL
                        Optional: override remote repository URL used by
                        --update.

semantic DSL output:
  --semantic            Generate .sem.ctx.md with semantic DSL output
                        (default: enabled)
  --no-semantic         Disable generation of .sem.ctx.md with semantic DSL
                        output
  --semantic-only       Generate only the .sem.ctx.md file, omit the standard
                        .ctx.md
  --now TEXT            Manually define the NOW field (current focus of the
                        project)
  --no-output FILE      Path for the semantic output file (default:
                        <project_name>.sem.ctx.md)
```

## Examples

* First, generate a `.packignore` template in your project directory to specify which files/directories to exclude:
```bash
python ctxpack.py --setup
```

**Path formats**

CtxPack accepts both Unix and Windows path styles. Examples that work on either platform:

- Current directory: `.`
- Relative path: `../myproject`
- Unix absolute: `/home/user/projects/myproj`
- Windows absolute (forward slashes): `C:/Users/You/Projects/MyProj`
- Windows absolute (backslashes): `C:\\Users\\You\\Projects\\MyProj`

---

**Pack the current directory:**
```bash
python ctxpack.py .
```

**Pack a specific project (`./AlmaOS`) and save to a custom file:**
```bash
python ctxpack.py ./AlmaOS -o AlmaOS_context.md
```

**Pack a project with specific file extensions and strip comments:**
```bash
python ctxpack.py ./MyProject -e c h asm --strip-comments
```

**Pack a Windows-style path (example):**
```bash
python ctxpack.py "C:\\Users\\You\\Projects\\MyProject" -o MyProject_context.md
```

**Pack a graphics project, limiting file size and specifying an output file:**
```bash
python ctxpack.py ./gfx -e c h --max-lines 500 -o gfx_context.ctx.md
```

**Run the built-in polyglot semantic fixtures:**
```bash
python3 ctxpack.py tests/prototypes --semantic-only --no-output tests/prototypes/prototypes.sem.ctx.md
```

**Run the full smoke test suite:**
```bash
python3 tests/run_smoke.py
```

## Self-updating the script

CtxPack can check the canonical repository for updates and apply them to the local installation.

- **Check for updates automatically:** When you run `ctxpack.py` it will perform a lightweight background check and print a short notice if a newer commit exists in the canonical repository.
- **Apply updates:** Run the updater to fetch and apply changes to your local copy:

```bash
python ctxpack.py --update
```

If your installation uses a different remote URL, you can override it with `--remote-url`:

```bash
python ctxpack.py --update --remote-url git@github.com:your/repo.git
```

## How it Works

The script walks through the project directory, filters files based on your criteria, and concatenates them into a single Markdown file. Each file's content is enclosed in a fenced code block, making it easy for language models to parse.

For semantic output, CtxPack combines multiple analyzers: language detection, dependency extraction, module mapping, relation inference, symbol extraction, and metadata/context enrichment. When explicit metadata tags are missing, it derives context from leading comments, symbol structure, file names, and surrounding heuristics so the final DSL stays informative without requiring manual annotation.

## Built-in Semantic Extraction

CtxPack ships with two bundled extraction strategies:

- `analyzers/plugins/python_plugin.py`: uses Python's built-in `ast` for precise extraction of Python functions, classes, and methods.
- `analyzers/plugins/polyglot_plugin.py`: uses a pure-Python structural parser for multiple brace-based and block-based languages, without external parser libraries.

The bundled polyglot extractor currently targets:

- JavaScript / JSX / MJS
- TypeScript / TSX
- Rust
- Go
- Java
- Kotlin
- C / C++
- C#
- PHP
- Ruby
- Lua
- Swift
- Dart
- Shell (`sh`, `bash`)

## Language Plugin System (Extensibility)

CtxPack now includes a language plugin system for symbol detection and extraction. This lets you add support for new programming languages without modifying core code.

- Where to add plugins: place a module in `analyzers/plugins/` that exposes a plugin factory `get_plugin()` (or `plugin`/`Plugin` symbol). The package is auto-discovered at runtime.
- Plugin interface: implement the `LanguagePlugin` abstract class in `analyzers/language_plugin.py`. Required parts:
  - `file_extensions() -> list[str]`: extensions handled by the plugin (no leading dot).
  - `detect(content: str, path: Path) -> float`: optional heuristic score (0.0-1.0) for disambiguation.
  - `extract_symbols(module, project_dir: Path) -> None`: populate `module.symbols` with `SymbolNode` entries.

Examples:

- `analyzers/plugins/python_plugin.py` uses Python's built-in `ast` for Python code.
- `analyzers/plugins/polyglot_plugin.py` uses a pure-Python structural parser to cover multiple non-Python languages without external dependencies.

How detection works:
- The `SymbolExtractor` first matches plugins by file extension. If multiple plugins register the same extension, it calls `detect()` on each to pick the highest-scoring plugin.
- If no plugin registers an extension, the extractor will call `detect()` on all available plugins as a fallback, allowing content-based detection for ambiguous files.

Does this extract semantics for other languages?
- Short answer: yes — insofar as a plugin implements extraction logic for the target language.

Details and limitations:
- The core system provides plugin orchestration plus bundled Python and polyglot extractors, but language-specific precision still depends on the plugin implementation.
- The built-in polyglot extractor is intentionally pure Python and dependency-free. It uses structural parsing and heuristics, not full compiler-grade parsers, so edge cases in highly dynamic or macro-heavy code may still be approximated.
- Performance: parsing should remain lightweight because ctxpack is intended to run on developer machines.
- Safety: plugin code runs inside the same process; avoid executing untrusted code during detection/extraction.

Adding a new language plugin (quick steps):
1. Create `analyzers/plugins/<lang>_plugin.py`.
2. Implement a class inheriting `LanguagePlugin` and implement `file_extensions`, `detect`, and `extract_symbols`.
3. Provide `get_plugin()` that returns an instance of your plugin.
4. Run `python ctxpack.py <project_dir>` — the plugin will be discovered automatically.

If you want, we can add templates for C/C++ and Java plugins, or document common patterns for building robust detectors and parsers.

## Validation Fixtures

The repository includes a multi-language semantic smoke test suite in `tests/prototypes/`. These are small fixture files used to validate extraction quality across supported languages and relation detection between modules.

Typical validation command:

```bash
python3 tests/run_smoke.py
```

## License

This project is licensed under the [MIT License](LICENSE). See the LICENSE file for details.
