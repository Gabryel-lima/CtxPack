import re
from pathlib import Path

from dsl_schema import DSLContext

TAG_PATTERN = re.compile(r'(?://|#|--|;;|\*)\s*@(\w+):\s*(.+)')
DOCSTRING_PATTERN = re.compile(r'^\s*(?:"""|\'\'\')\s*(.*?)\s*(?:"""|\'\'\')', re.DOTALL)
BLOCK_COMMENT_PATTERN = re.compile(r'^\s*/\*+(.*?)\*/', re.DOTALL)
COMMENT_PREFIX_PATTERN = re.compile(r'^(#|//|--|;;|\*)\s?')

class TagParser:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        modules_by_path = {module.filepath: module for module in ctx.modules}
        seen_extra = set(ctx.extra)

        # We should parse all relevant files.
        for file in self.args.included_files:
            if file.is_file() and any(c.isalpha() for c in file.suffix):
                try:
                    content = file.read_text(encoding="utf-8", errors="ignore")
                    lines = content.splitlines()
                    rel_path = file.relative_to(self.project_dir).as_posix()
                    mod = modules_by_path.get(rel_path)
                    parsed_tags: set[str] = set()

                    for line in lines:
                        match = TAG_PATTERN.search(line)
                        if match:
                            tag, value = match.groups()
                            tag = tag.lower()
                            value = value.strip()
                            parsed_tags.add(tag)

                            if tag == "role" and mod:
                                mod.role = value
                            elif tag == "state" and mod:
                                mod.state = value
                            elif tag == "dec":
                                parts = value.split("| why:")
                                dec = parts[0].strip()
                                why = parts[1].strip() if len(parts) > 1 else ""
                                from dsl_schema import DecisionNode
                                ctx.decisions.append(DecisionNode(decision=dec, why=why))
                            elif tag == "bug":
                                parts = value.split("| state:")
                                desc = parts[0].strip()
                                state = parts[1].strip() if len(parts) > 1 else "open"
                                from dsl_schema import BugNode
                                ctx.bugs.append(BugNode(description=desc, module=str(file.stem), state=state))
                            elif tag == "rel":
                                parts = value.split("| via:")
                                target = parts[0].strip()
                                via = parts[1].strip() if len(parts) > 1 else ""
                                from dsl_schema import RelationNode
                                ctx.relations.append(RelationNode(source=str(file.stem), target=target, via=via))
                            elif tag == "conv":
                                ctx.conventions.append(value)
                            elif tag == "ctx":
                                ctx.extra.append(value)
                            elif tag == "now":
                                ctx.now = value

                    self._apply_inferred_context(ctx, mod, rel_path, content, parsed_tags, seen_extra)
                except Exception:
                    pass

    def _apply_inferred_context(
        self,
        ctx: DSLContext,
        mod,
        rel_path: str,
        content: str,
        parsed_tags: set[str],
        seen_extra: set[str],
    ) -> None:
        if not mod or "ctx" in parsed_tags:
            return

        summary = self._extract_summary_from_comments(content)
        if not summary:
            summary = self._build_symbol_summary(mod)
        if not summary:
            return

        inferred = f"{rel_path}: {summary}"
        if inferred not in seen_extra:
            ctx.extra.append(inferred)
            seen_extra.add(inferred)

    def _extract_summary_from_comments(self, content: str) -> str:
        docstring_match = DOCSTRING_PATTERN.search(content)
        if docstring_match:
            return self._normalize_summary(docstring_match.group(1))

        block_match = BLOCK_COMMENT_PATTERN.search(content)
        if block_match:
            return self._normalize_summary(block_match.group(1))

        lines = content.splitlines()
        collected: list[str] = []
        for index, line in enumerate(lines):
            stripped = line.strip()
            if index == 0 and stripped.startswith("#!"):
                continue
            if not stripped:
                if collected:
                    break
                continue
            if TAG_PATTERN.search(stripped):
                continue
            if any(stripped.startswith(prefix) for prefix in ("#", "//", "--", ";;", "*")):
                collected.append(COMMENT_PREFIX_PATTERN.sub("", stripped).strip())
                continue
            break

        return self._normalize_summary(" ".join(collected))

    def _build_symbol_summary(self, mod) -> str:
        parts: list[str] = []
        if mod.role:
            parts.append(f"role {mod.role}")

        symbols = getattr(mod, "symbols", [])
        classes = [symbol.name for symbol in symbols if symbol.type == "class"]
        funcs = [symbol.name for symbol in symbols if symbol.type in {"func", "method"}]

        if classes:
            parts.append("classes " + ", ".join(classes[:3]))
        if funcs:
            parts.append("functions " + ", ".join(funcs[:5]))

        if not parts and mod.state:
            parts.append(f"state {mod.state}")

        return "; ".join(parts)

    def _normalize_summary(self, raw_summary: str) -> str:
        cleaned = re.sub(r'\s+', ' ', raw_summary).strip(' -#/*\t\n\r')
        if not cleaned:
            return ""
        if len(cleaned) > 180:
            cleaned = cleaned[:177].rstrip() + "..."
        return cleaned
