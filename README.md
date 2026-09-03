# CtxPack: Project Context Packer

`ctxpack.py` is a Python script that collapses an entire project's source code and structure into a single, LLM-friendly text file. This allows you to easily paste the entire context of a project into a large context window of a language model or agent.

- Português (pt-BR): [README.pt-BR.md](README.pt-BR.md)

## Features

- **Targeted Query**: Ask for context about one file, symbol, or free-text question instead of the whole repo — `--query` ranks modules by lexical match + import-graph proximity and emits a trimmed `.sem.ctx.md` subset with a `WHY:` reason per module. See [Query Command](#query-command) below.
- **Multiple Output Profiles**: Generated on demand, not all at once — Semantic DSL (`.sem.ctx.md`, written by default unless `--no-semantic`), Human Readable (`.ctx.md`, opt-in via `--readable`), and a lexical Token/Chunk index (`.tokens.ctx.md`, opt-in via `--chunk`/`--embed`).
- **Semantic DSL Mode**: Structural semantic extraction with pure-Python analyzers, import/relation indexing, and smart inference for state, role, conventions, and missing metadata context.
- **Directory Tree**: Includes an ASCII directory tree for easy navigation.
- **Smart Filtering & Exclusion**: Automatic root detection and configurable category exclusions (build, vendor, test, doc, etc, tunable via `--exclude-category`/`--include-category`). Whitelist extensions and exclude specific directories/files.
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
                  [--semantic-only] [--now TEXT] [--no-output FILE] [--push]
                  [--push-tag TAG] [--push-workspace PATH]
                  [--exclude-category NAME [NAME ...]]
                  [--include-category NAME [NAME ...]] [--query TEXT]
                  [--file PATH] [--symbol NAME] [--query-top QUERY_TOP]
                  [--query-min-score QUERY_MIN_SCORE]
                  [--query-hops QUERY_HOPS] [--query-output FILE]
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
  --embed               Compute a deterministic hashed token fingerprint per
                        chunk (pure Python, not a real semantic embedding
                        model).
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
  --push                Send generated output to the VS Code ContextRingBuffer
                        via IPC. Requires extension running in VS Code.
  --push-tag TAG        Tag for the target buffer slot (default: project
                        directory name).
  --push-workspace PATH
                        VS Code workspace root used to compute IPC socket
                        path. Default: resolved project_dir.
  --exclude-category NAME [NAME ...]
                        Exclude these path categories (default: vendor, build,
                        vcs, env).
  --include-category NAME [NAME ...]
                        Force-include these path categories, overriding
                        --exclude-category (default: test, docs).

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

targeted query:
  --query TEXT          Ask for context relevant to TEXT instead of dumping
                        the whole repo. Writes a trimmed semantic DSL subset
                        ranked by lexical + import-graph relevance.
  --file PATH           Optional file-path hint for --query (boosts modules
                        matching this path).
  --symbol NAME         Optional symbol-name hint for --query (boosts modules
                        defining this symbol).
  --query-top QUERY_TOP
                        Max number of modules to include in the query result
                        (default: 15).
  --query-min-score QUERY_MIN_SCORE
                        Minimum relevance score for a module to be included
                        (default: 0.05).
  --query-hops QUERY_HOPS
                        Max import-graph hops to propagate relevance across
                        (default: 2).
  --query-output FILE   Path for the query result file (default:
                        <project_name>.query.sem.ctx.md).
```

### Query Command

Instead of always dumping the whole repository, `--query` ranks modules by a
lightweight, dependency-free heuristic — lexical/substring overlap against
module names, paths, symbols, and tags, boosted by proximity in the import
graph — and writes only the top matches to `<project_name>.query.sem.ctx.md`.
Each selected module gets a `WHY:` line explaining which signal matched it
(name/symbol/role/tag match, or graph hop distance).

```bash
# Free-text question
python ctxpack.py . --query "how does authentication work" --query-top 10

# Narrow the ranking with a file hint
python ctxpack.py . --query "auth flow" --file src/auth/login.py --query-top 5

# Narrow with a symbol hint, and push the result to the VS Code buffer
python ctxpack.py . --query "session handling" --symbol login --push
```

`--file`/`--symbol` are hints that boost matching modules — they only take
effect together with `--query`; used alone (without `--query`) they are
ignored and CtxPack falls back to its normal full-pack behavior.

Query results are never written to `.sem.ctx.md` — they always go to a
separate `*.query.sem.ctx.md` file (or the path given via `--query-output`),
so a targeted query never overwrites a full project pack.

### Excluding or forcing categories

`--exclude-category` / `--include-category` tune the same category filter
used internally for tree building (`vendor`, `build`, `vcs`, `test`, `docs`,
`env` — see `filters/exclusion.py`). By default `vendor`, `build`, `vcs`, and
`env` are excluded, while `test` and `docs` are force-included; pass either
flag to override that default. `--include-category` always wins over
`--exclude-category` for a category named in both.

```bash
# Exclude test files as well as the defaults
python ctxpack.py . --exclude-category test --query "parser" --query-top 10
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

CtxPack includes a VS Code extension at [vscode-extension/README.md](vscode-extension/README.md) that keeps an in-memory FIFO context buffer and injects it dynamically through the CtxPack chat participant.

The intended split is explicit:

- The extension is optimized for local, task-scoped, chat-focused context.
- The Python script is optimized for whole-project export in semantic or readable formats.
- The extension now generates project packs internally, so these commands work without Python or a local `ctxpack.py` copy.

Visual flow reference: see the extension guide image in [vscode-extension/README.md](vscode-extension/README.md).

Important behavior:

- You no longer need to prepend prompts with `@ctx` for repeated injections.
- `@ctx [prompt]` is the default participant path: inject context and answer.
- `@ctx /run [action]` forces agentic execution with tools using the same buffered context.
- Dynamic context injection does not collect files by itself.
- Dynamic injection uses only what is already in the buffer.
- The buffer changes only when you push content or remove/clear slots.
- If you select active slots, that selected subset becomes the effective context source for Ask, Plan, and Agent.
- Every request emits a visual injection report (used slots, omitted slots, token estimate), plus read/correlation phases and status bar telemetry.

### When to use dynamic context injection

Use dynamic context injection when the prompt depends on one of these:

- the selection or file you just pushed
- multiple snippets accumulated in the current buffer
- a semantic workspace digest generated by CtxPack
- repository-specific context that would otherwise need to be pasted manually

Avoid dynamic injection when:

- the question is generic
- the buffer still contains context from a different task
- you only need the active editor text and do not want extra assumptions

Rule of thumb: if injected context improves precision, keep it enabled; if it adds noise, reduce active slots.

### Recommended usage flow

1. Decide whether you need a local snippet, a project-wide digest, or context for a specific question.
2. For local work, push a selection or the full file.
3. For workspace-level context, run `CtxPack: Generate semantic pack and push to buffer`. For a specific question or task, run `CtxPack: Query workspace and push targeted context` instead — it pushes only the ranked, relevant modules rather than the whole workspace.
4. If needed, run `CtxPack: Choose active slots for dynamic context` so the same file, directory, or slot group is reused in every iteration.
5. Inspect or remove stale slots if needed.
6. Ask in Copilot Chat with the CtxPack participant after the buffer and active scope match your current task.
7. Clear the buffer (`ctxpack.clear`) or remove the active filter when switching task/topic.

When you want to explicitly trigger an execution workflow, use `@ctx /run` instead of the default answer flow.

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
- `ctxpack.selectActiveSlots`: choose which slots remain active for dynamic context across iterations.
- `ctxpack.clearActiveSelection`: return dynamic context to full-buffer mode.
- `ctxpack.slotScopeStatus`: show the current dynamic context scope.
- `ctxpack.inspectSlot`: preview one buffered slot before prompting.
- `ctxpack.removeSlot`: remove a stale slot without clearing the whole buffer.
- `ctxpack.clear`: clear the current session buffer.
- `ctxpack.exportSemantic`: generate `<workspace>.sem.ctx.md` inside the extension.
- `ctxpack.exportReadable`: generate `<workspace>.ctx.md` inside the extension.
- `ctxpack.pushWorkspaceSemantic`: generate a semantic project pack and send it to the extension buffer through IPC.
- `ctxpack.queryWorkspace`: ask a question and push only the ranked, relevant modules as a pre-scoped slot — instead of the whole workspace.
- `ctxpack.createPackignore`: generate a `.packignore` template inside the extension.
- `ctxpack.wizard`: open one quick menu for push, scope selection, export, and cleanup actions.

### Explorer shortcuts

You can also right-click in the VS Code Explorer:

- on a file: `CtxPack: Push this file to buffer`
- on a folder: `CtxPack: Push this folder to buffer`

### Extension requirements for project commands

The project-level commands run inside the extension itself.

- Open the target workspace folder in VS Code.
- Ensure the extension can read the relevant files in that workspace.

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
code --install-extension ctxpack-context-0.1.16.vsix
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
  No. Context injection is dynamic when you are using the CtxPack participant.
2. Does the buffer update itself every prompt?
  No. You must push new content (command or CLI) when files change.
3. Is buffer data persisted forever?
  No. It is session memory and can be cleared with `ctxpack.clear`.
4. What happens when token limit is reached?
  FIFO eviction removes older entries first.
5. How do I send the whole workspace context to chat without pushing many files manually?
  Run `CtxPack: Generate semantic pack and push to buffer`, then prompt normally in the CtxPack participant.
6. How do I export context for another LLM instead of Copilot Chat?
  Run `CtxPack: Generate semantic project pack` or `CtxPack: Generate readable project pack`.
7. How do I make the AI reuse only one file, one directory, or a specific group of slots on every iteration?
  Push that content and then run `CtxPack: Choose active slots for dynamic context`. Active slots are applied as the effective scope across Ask, Plan, and Agent.

8. What if chat stays in `Evaluating` for too long?
  The participant now has a defensive timeout and should return an explicit error instead of waiting indefinitely.

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

`--query` runs on top of that same analyzed context: it's a lexical/substring + import-graph-proximity heuristic (`analyzers/relevance_ranker.py`), not a machine-learning or embedding-based ranker. It's explainable (each match records *why* it was selected) and dependency-free, but it won't catch synonyms or purely semantic relationships that share no vocabulary with the query.

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
