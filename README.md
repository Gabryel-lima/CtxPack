# CtxPack: Project Context Packer

- Português (pt-BR): [README.pt-BR.md](README.pt-BR.md)

`ctxpack.py` is a Python script that collapses an entire project's source code and structure into a single, LLM-friendly text file. This allows you to easily paste the entire context of a project into a large context window of a language model or agent.

## Features

- **Multiple Formats**: Creates different profiles (Semantic DSL by default `.sem.ctx.md`, Human Readable `.ctx.md` with `--readable`, and Token/Chunk files `.tokens.ctx.md`).
- **Semantic DSL Mode**: Advanced semantic AST and import indexing of your project out of the box, with smart heuristic inference (state, role, conventions).
- **Directory Tree**: Includes an ASCII directory tree for easy navigation.
- **Smart Filtering & Exclusion**: Automatic root detection and configurable category exclusions (build, vendor, test, doc, etc). Whitelist extensions and exclude specific directories/files.
- **Comment Stripping**: Option to remove single-line comments to save tokens.
- **File Size Limits**: Skip files that are too large.
- **Token Estimation**: Provides a rough estimate of the token count.

## Usage

```text
usage: ctxpack.py [-h] [-o OUTPUT] [-e EXT [EXT ...]] [-x NAME [NAME ...]]
                  [--setup] [--strip-comments] [--no-tree]
                  [--max-lines N] [--summary] [--chunk]
                  [--chunk-size N] [--chunk-overlap N]
                  [--embed] [--embed-dim N] [--readable]
                  [--readable-output FILE] [--no-semantic]
                  [--no-semantic] [--no-semantic-only] [--now TEXT]
                  [--no-output FILE]
                  project_dir

ctxpack.py — Context Packer for LLM/Agent consumption
Collapses an entire project into single or multiple .ctx.md files.

positional arguments:
  project_dir           Root directory of the project (e.g. . for current dir)

options:
  -h, --help            show this help message and exit
  -o, --output OUTPUT   Output file path for tokens output (default: 
                        <project_name>.tokens.ctx.md if chunk/embed enabled)
  -e, --ext EXT [EXT ...]
                        Whitelist of file extensions (without dot)
  -x, --exclude NAME [NAME ...]
                        Additional directory or file names to exclude
  --setup               Generate a .packignore template in the current directory and exit
  --strip-comments      Strip single-line comments (// and #) from source files
  --no-tree             Omit the directory tree section from the output
  --max-lines N         Skip files with more than N lines (default: 2000)
  --summary             Print token/file summary only — do not write output file
  --chunk               Split files into line-based chunks for indexing
  --chunk-size N        Lines per chunk when --chunk is enabled (default: 200)
  --chunk-overlap N     Overlap lines between consecutive chunks (default: 20)
  --embed               Compute deterministic embeddings for each chunk
  --embed-dim N         Embedding vector dimension when --embed is enabled (default: 64)
  --readable            Generate a human-readable full context file (disabled by default)
  --readable-output FILE
                        Path for the human-readable output file (default: <project_name>.ctx.md)

semantic DSL output:
  --semantic         Generate .sem.ctx.md with semantic DSL output (enabled by default)
  --no-semantic         Disable generation of .sem.ctx.md with semantic DSL output
  --semantic-only    Generate only the .sem.ctx.md file and exit
  --now TEXT            Manually set the NOW field (current project focus)
  --no-output FILE      Path for the semantic DSL file (default: <project_name>.sem.ctx.md)
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

## How it Works

The script walks through the project directory, filters files based on your criteria, and concatenates them into a single Markdown file. Each file's content is enclosed in a fenced code block, making it easy for language models to parse.

## Language Plugin System (Extensibility)

CtxPack now includes a language plugin system for symbol detection and extraction. This lets you add support for new programming languages without modifying core code.

- Where to add plugins: place a module in `analyzers/plugins/` that exposes a plugin factory `get_plugin()` (or `plugin`/`Plugin` symbol). The package is auto-discovered at runtime.
- Plugin interface: implement the `LanguagePlugin` abstract class in `analyzers/language_plugin.py`. Required parts:
  - `file_extensions() -> list[str]`: extensions handled by the plugin (no leading dot).
  - `detect(content: str, path: Path) -> float`: optional heuristic score (0.0-1.0) for disambiguation.
  - `extract_symbols(module, project_dir: Path) -> None`: populate `module.symbols` with `SymbolNode` entries.

Example: `analyzers/plugins/python_plugin.py` is included as a reference implementation that uses Python's `ast` to extract functions, classes and methods.

How detection works:
- The `SymbolExtractor` first matches plugins by file extension. If multiple plugins register the same extension, it calls `detect()` on each to pick the highest-scoring plugin.
- If no plugin registers an extension, the extractor will call `detect()` on all available plugins as a fallback, allowing content-based detection for ambiguous files.

Does this extract semantics for other languages?
- Short answer: yes — insofar as a plugin implements extraction logic for the target language.

Details and limitations:
- The core system only provides the plugin framework and orchestration (discovery, registration, and selection). Actual parsing and semantic extraction must be implemented by each plugin.
- For some languages (Python, Java, JavaScript, Rust, etc.) you can write robust plugins using their AST/parser libraries. For others without a handy parser, a heuristic or regex-based approach can still extract useful symbols but will be less accurate.
- Performance: expensive parsing should be implemented carefully (streaming, early exits) because ctxpack is intended to run on developer machines.
- Safety: plugin code runs inside the same process; avoid executing untrusted code during detection/extraction.

Adding a new language plugin (quick steps):
1. Create `analyzers/plugins/<lang>_plugin.py`.
2. Implement a class inheriting `LanguagePlugin` and implement `file_extensions`, `detect`, and `extract_symbols`.
3. Provide `get_plugin()` that returns an instance of your plugin.
4. Run `python ctxpack.py <project_dir>` — the plugin will be discovered automatically.

If you want, we can add templates for C/C++ and Java plugins, or document common patterns for building robust detectors and parsers.

## License

This project is licensed under the [MIT License](LICENSE). See the LICENSE file for details.
