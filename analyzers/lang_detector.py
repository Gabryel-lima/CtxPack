from pathlib import Path
from dsl_schema import DSLContext

EXT_TO_LANG = {
    ".py": "Python", ".c": "C", ".h": "C",
    ".cpp": "C++", ".hpp": "C++",
    ".asm": "NASM", ".s": "ASM",
    ".rs": "Rust", ".go": "Go",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".java": "Java", ".kt": "Kotlin",
    ".cs": "C#", ".swift": "Swift", ".dart": "Dart",
    ".php": "PHP", ".rb": "Ruby", ".lua": "Lua",
    ".sh": "Shell", ".bash": "Shell",
}

class LangDetector:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        langs = set()
        # Simplified walk over files
        for f in self.args.included_files:
            if f.is_file():
                # Note: this should respect packignore in a real scenario,
                # but we'll do a simple extension check here
                if f.suffix in EXT_TO_LANG:
                    langs.add(EXT_TO_LANG[f.suffix])
                elif f.name == "Makefile":
                    langs.add("Make")
        ctx.project.languages = sorted(list(langs))
