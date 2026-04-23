# CtxPack: Project Context Packer

`ctxpack.py` is a Python script that collapses an entire project's source code and structure into a single, LLM-friendly text file. This allows you to easily paste the entire context of a project into a large context window of a language model or agent.

## Features

- **Single File Output**: Creates one `.ctx.md` file with your project's contents.
- **Directory Tree**: Includes an ASCII directory tree for easy navigation.
- **File Filtering**: Whitelist extensions and exclude specific directories/files.
- **Comment Stripping**: Option to remove single-line comments to save tokens.
- **File Size Limits**: Skip files that are too large.
- **Token Estimation**: Provides a rough estimate of the token count.

## Usage

```
usage: ctxpack.py [-h] [-o FILE] [-e EXT [EXT ...]] [-x NAME [NAME ...]]
                  [--strip-comments] [--no-tree] [--max-lines N] [--summary]
                  [project_dir]

ctxpack.py — Context Packer for LLM/Agent consumption
Collapses an entire project into a single .ctx.md file.

positional arguments:
  project_dir           Root directory of the project (default: current dir)

options:
  -h, --help            show this help message and exit
  -o, --output FILE     Output file path (default: <project_name>.ctx.md)
  -e, --ext EXT [EXT ...]
                        Whitelist of extensions (e.g. -e c h py asm)
  -x, --exclude DIR [..]
                        Extra dirs to exclude beyond .packignore
  --strip-comments      Strip single-line comments (// and #)
  --no-tree             Omit directory tree
  --max-lines N         Skip files longer than N lines (default: 2000)
  --summary             Print token estimate summary only (no file written)
  --setup               Generate a .packignore template in the current directory and exit.
```

## Examples

* First, generate a `.packignore` template in your project directory to specify which files/directories to exclude:
```bash
python ctxpack.py --setup
```

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

**Pack a graphics project, limiting file size and specifying an output file:**
```bash
python ctxpack.py ./gfx -e c h --max-lines 500 -o gfx_context.ctx.md
```

## How it Works

The script walks through the project directory, filters files based on your criteria, and concatenates them into a single Markdown file. Each file's content is enclosed in a fenced code block, making it easy for language models to parse.

## License

This project is licensed under the [MIT License](LICENSE). See the LICENSE file for details.
