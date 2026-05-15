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

## VS Code Extension (Context Cache)

CtxPack includes a VS Code extension at [vscode-extension/README.md](vscode-extension/README.md) that keeps an in-memory FIFO context buffer and exposes a chat participant `@ctx`.

The intended split is explicit:

- The extension is optimized for local, task-scoped, chat-focused context.
- The Python script is optimized for whole-project export in semantic or readable formats.
- The extension can now call the local `ctxpack.py` directly, so both parts work together from the same repository when Python is already installed.

Visual flow reference: see the extension guide image in [vscode-extension/README.md](vscode-extension/README.md).

Important behavior:

- `@ctx` does not collect files by itself.
- `@ctx` injects only what is already in the buffer.
- The buffer changes only when you push content or remove/clear slots.
- You can keep `@ctx` fixed on a chosen subset of slots across multiple iterations.
- `@ctx` should be used deliberately, not as a prefix for every prompt.

### When to use `@ctx`

Use `@ctx` when the prompt depends on one of these:

- the selection or file you just pushed
- multiple snippets accumulated in the current buffer
- a semantic workspace digest generated by CtxPack
- repository-specific context that would otherwise need to be pasted manually

Avoid `@ctx` when:

- the question is generic
- the buffer still contains context from a different task
- you only need the active editor text and do not want extra assumptions

Rule of thumb: if injected context improves precision, use `@ctx`; if it only adds noise, skip it.

### Recommended usage flow

1. Decide whether you need a local snippet or a project-wide digest.
2. For local work, push a selection or the full file.
3. For workspace-level context, run `CtxPack: Generate semantic pack and push to buffer`.
4. If needed, run `CtxPack: Choose active slots for @ctx` so the same file, directory, or slot group is reused in every iteration.
5. Inspect or remove stale slots if needed.
6. Ask in Copilot Chat using `@ctx` only after the buffer and active scope match your current task.
7. Clear the buffer (`ctxpack.clear`) or remove the active filter when switching task/topic.

### Extension commands

### How to open the VS Code Command Palette

To run CtxPack extension commands inside VS Code:

1. Open the Command Palette with `Ctrl+Shift+P` on Linux/Windows or `Cmd+Shift+P` on macOS.
2. Type `CtxPack`.
3. Pick the command you want.

If you want a guided flow, run `CtxPack: Open context workflow wizard` from the same palette.

- `ctxpack.push`: push selection, or whole active file if the selection is empty.
- `ctxpack.pushFile`: push the entire active file.
- `ctxpack.pushPath`: push one file or directory as a reusable slot.
- `ctxpack.status`: inspect buffered slots and estimated token usage.
- `ctxpack.selectActiveSlots`: choose which slots remain active for `@ctx` across iterations.
- `ctxpack.clearActiveSelection`: return `@ctx` to full-buffer mode.
- `ctxpack.slotScopeStatus`: show the current `@ctx` scope.
- `ctxpack.inspectSlot`: preview one buffered slot before using `@ctx`.
- `ctxpack.removeSlot`: remove a stale slot without clearing the whole buffer.
- `ctxpack.clear`: clear the current session buffer.
- `ctxpack.exportSemantic`: generate `<workspace>.sem.ctx.md` by calling the local `ctxpack.py`.
- `ctxpack.exportReadable`: generate `<workspace>.ctx.md` by calling the local `ctxpack.py`.
- `ctxpack.pushWorkspaceSemantic`: generate a semantic project pack and send it to the extension buffer through IPC.
- `ctxpack.createPackignore`: generate a `.packignore` template through the local `ctxpack.py`.
- `ctxpack.wizard`: open one quick menu for push, scope selection, export, and cleanup actions.

### Explorer shortcuts

You can also right-click in the VS Code Explorer:

- on a file: `CtxPack: Push this file to buffer`
- on a folder: `CtxPack: Push this folder to buffer`

### Extension requirements for project commands

The project-level commands reuse the Python CLI from the same repository or workspace.

- Python must be installed.
- `ctxpack.py` should exist in the workspace root.
- If it lives elsewhere, configure `ctxpack.cliPath`.
- If `python3` is not the correct executable, configure `ctxpack.pythonPath`.

### IPC from CLI to extension

Use CLI push flags to feed the extension buffer directly:

```bash
python3 ctxpack.py . --semantic --push --push-tag current-state
```

Optional workspace override for socket hash resolution:

```bash
python3 ctxpack.py . --semantic --push --push-workspace /path/to/vscode/workspace
```

The new extension commands wrap this same flow so users can trigger semantic generation and push without leaving VS Code.

### Install extension (two ways)

#### 1) Install from VSIX package (recommended for daily use)

Build and install:

```bash
cd vscode-extension
npm install
npm run compile
npm test
npm run package
code --install-extension ctxpack-context-0.1.3.vsix
```

You can also install via VS Code UI: Extensions -> `...` -> Install from VSIX...

#### 2) Run from source (recommended for contributors)

Use VS Code extension development host:

1. Open [vscode-extension](vscode-extension).
2. Run `npm install` and `npm run compile`.
3. Press `F5` to launch an Extension Development Host.
4. Test commands/chat participant in the new host window.

### FAQ (common questions)

1. Do I need to start every prompt with `@ctx`?
  No. Use `@ctx` only for prompts that should receive buffered context.
2. Does the buffer update itself every prompt?
  No. You must push new content (command or CLI) when files change.
3. Is buffer data persisted forever?
  No. It is session memory and can be cleared with `ctxpack.clear`.
4. What happens when token limit is reached?
  FIFO eviction removes older entries first.
5. How do I send the whole workspace context to chat without pushing many files manually?
  Run `CtxPack: Generate semantic pack and push to buffer`, then use `@ctx`.
6. How do I export context for another LLM instead of Copilot Chat?
  Run `CtxPack: Generate semantic project pack` or `CtxPack: Generate readable project pack`.
7. How do I make the AI reuse only one file, one directory, or a specific group of slots on every iteration?
  Push that content and then run `CtxPack: Choose active slots for @ctx`.

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
