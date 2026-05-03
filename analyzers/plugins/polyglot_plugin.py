import bisect
import re
from dataclasses import dataclass, field
from pathlib import Path

from dsl_schema import SymbolNode
from analyzers.language_plugin import LanguagePlugin


CONTROL_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "return", "sizeof",
    "delete", "throw", "case", "elsif", "unless", "when",
}


@dataclass
class SyntaxNode:
    kind: str
    name: str
    signature: str = ""
    start_line: int = 0
    end_line: int = 0
    children: list["SyntaxNode"] = field(default_factory=list)


@dataclass(frozen=True)
class SymbolMatch:
    name: str
    signature: str
    start: int
    end: int
    owner: str = ""


class PolyglotPlugin(LanguagePlugin):
    EXTENSIONS = [
        "js", "jsx", "mjs", "ts", "tsx",
        "java", "kt", "cs", "swift", "dart",
        "rs", "go",
        "php", "rb", "lua",
        "c", "h", "cpp", "hpp", "cc", "cxx",
        "sh", "bash",
    ]

    BRACE_CLASS_PATTERNS = [
        re.compile(
            r'^\s*(?:export\s+)?(?:@\w+(?:\([^)]*\))?\s*)*'
            r'(?:(?:public|private|protected|internal|open|sealed|abstract|final|partial|static|unsafe)\s+)*'
            r'(?:class|interface|enum|trait|struct|protocol|actor|extension)\s+'
            r'(?P<name>[A-Za-z_][A-Za-z0-9_]*)',
            re.MULTILINE,
        ),
        re.compile(r'^\s*type\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)\b', re.MULTILINE),
        re.compile(r'^\s*impl\s+(?:<[^>]+>\s*)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)(?:\s+for\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\{', re.MULTILINE),
    ]

    BRACE_FUNCTION_PATTERNS = [
        re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\((?P<args>[^)]*)\)\s*=>', re.MULTILINE),
        re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?P<args>[A-Za-z_][A-Za-z0-9_]*)\s*=>', re.MULTILINE),
        re.compile(r'^\s*(?:pub\s+)?fn\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*func\s*\((?P<receiver>[^)]*)\)\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*func\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*(?:override\s+)?fun\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*(?:public|private|fileprivate|internal|open)?\s*func\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*(?:public|private|protected|internal|static|final|abstract|virtual|override|sealed|async|extern|partial|required|mutating|nonmutating|class|unsafe|constexpr|inline|friend)\s+function\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(r'^\s*(?:public|private|protected|internal|static|final|abstract|virtual|override|sealed|async|extern|partial|required|mutating|nonmutating|class|unsafe|constexpr|inline|friend)?\s*function\s+&?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>[^)]*)\)', re.MULTILINE),
        re.compile(
            r'^\s*(?:template\s*<[^>]+>\s*)?(?:@\w+(?:\([^)]*\))?\s*)*'
            r'(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|sealed|async|extern|partial|required|mutating|nonmutating|class|unsafe|constexpr|inline|friend|synchronized)\s+)*'
            r'(?:(?:[A-Za-z_][\w:<>,\[\]\.?&*]+)\s+)*'
            r'(?P<name>[~A-Za-z_][A-Za-z0-9_:]*)\s*\((?P<args>[^)]*)\)\s*'
            r'(?:const\s*)?(?:->\s*[^{=]+|:\s*[^{=]+)?\s*(?:async\s*)?\{',
            re.MULTILINE,
        ),
    ]

    SHELL_FUNC_PATTERN = re.compile(r'^\s*(?:function\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{', re.MULTILINE)
    RUBY_CLASS_PATTERN = re.compile(r'^\s*(?:class|module)\s+(?P<name>[A-Za-z_][A-Za-z0-9_:]*)')
    RUBY_DEF_PATTERN = re.compile(r'^\s*def\s+(?P<name>[A-Za-z_][A-Za-z0-9_\.:]*)\s*(?:\((?P<args>[^)]*)\))?')
    RUBY_BLOCK_PATTERN = re.compile(r'^\s*(?:if|unless|case|begin|for|while|until)\b|\bdo\b\s*(?:\|[^|]+\|)?\s*$')
    LUA_FUNC_PATTERN = re.compile(r'^\s*(?:local\s+)?function\s+(?P<name>[A-Za-z_][A-Za-z0-9_\.:]*)\s*\((?P<args>[^)]*)\)')
    LUA_BLOCK_PATTERN = re.compile(r'^\s*(?:if\b.*\bthen\s*$|for\b.*\bdo\s*$|while\b.*\bdo\s*$|do\s*$|repeat\s*$)')

    def file_extensions(self):
        return self.EXTENSIONS

    def detect(self, content: str, path: Path) -> float:
        ext = path.suffix.lstrip('.')
        if ext in self.EXTENSIONS:
            return 0.97

        signals = [
            "class ", "function ", "fn ", "func ", "impl ", "interface ",
            "def ", "module ", "<?php", "require_relative", "local function ",
        ]
        hits = sum(1 for signal in signals if signal in content)
        return min(0.7, hits * 0.12)

    def extract_symbols(self, module, project_dir: Path) -> None:
        file_path = project_dir / module.filepath
        if not file_path.exists():
            return

        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return

        ext = file_path.suffix.lstrip('.')
        tree = self._build_syntax_tree(content, ext)
        self._emit_symbols(module, tree)

    def _build_syntax_tree(self, content: str, ext: str) -> SyntaxNode:
        if ext in {"rb", "lua"}:
            return self._parse_end_block_language(content, ext)
        if ext in {"sh", "bash"}:
            return self._parse_shell_language(content)
        return self._parse_brace_language(content, ext)

    def _parse_brace_language(self, content: str, ext: str) -> SyntaxNode:
        line_lookup = self._make_line_lookup(content)
        root = SyntaxNode(kind="root", name="root", start_line=1, end_line=line_lookup(len(content)))
        class_entries: list[tuple[int, int, SyntaxNode]] = []
        seen_classes: set[tuple[str, int, int]] = set()

        for pattern in self.BRACE_CLASS_PATTERNS:
            for match in pattern.finditer(content):
                name = match.group("name")
                block = self._extract_brace_block(content, match.end() - 1)
                if not block:
                    continue
                _, block_end, _ = block
                key = (name, match.start(), block_end)
                if key in seen_classes:
                    continue
                seen_classes.add(key)
                class_entries.append((
                    match.start(),
                    block_end,
                    SyntaxNode(
                        kind="class",
                        name=name,
                        start_line=line_lookup(match.start()),
                        end_line=line_lookup(block_end),
                    ),
                ))

        self._attach_class_nodes(root, class_entries)
        named_classes = self._index_named_classes(class_entries)

        seen_functions: set[tuple[str, str, int]] = set()
        function_matches: list[SymbolMatch] = []
        for pattern in self.BRACE_FUNCTION_PATTERNS:
            for match in pattern.finditer(content):
                raw_name = match.group("name")
                owner = ""
                receiver = match.groupdict().get("receiver", "")
                if receiver:
                    owner = self._extract_receiver_owner(receiver)
                if "::" in raw_name:
                    parts = [part for part in raw_name.split("::") if part]
                    if len(parts) > 1:
                        owner = parts[-2]
                        raw_name = parts[-1]
                if raw_name.split("::")[-1] in CONTROL_KEYWORDS:
                    continue
                signature = self._format_signature(match.groupdict().get("args", ""))
                key = (owner + "::" + raw_name, signature, match.start())
                if key in seen_functions:
                    continue
                seen_functions.add(key)
                function_matches.append(SymbolMatch(
                    name=raw_name,
                    signature=signature,
                    start=match.start(),
                    end=match.end(),
                    owner=owner,
                ))

        for func in sorted(function_matches, key=lambda item: (item.start, item.name)):
            if func.owner:
                parent = self._find_or_create_named_class(root, named_classes, func.owner, line_lookup(func.start))
            else:
                parent = self._find_innermost_class(class_entries, func.start, func.end)

            node = SyntaxNode(
                kind="method" if parent else "func",
                name=func.name,
                signature=func.signature,
                start_line=line_lookup(func.start),
                end_line=line_lookup(func.end),
            )

            if parent:
                self._append_child(parent, node)
            else:
                self._append_child(root, node)

        self._sort_tree(root)
        return root

    def _parse_end_block_language(self, content: str, ext: str) -> SyntaxNode:
        lines = content.splitlines()
        root = SyntaxNode(kind="root", name="root", start_line=1, end_line=max(1, len(lines)))
        stack: list[tuple[str, SyntaxNode | None]] = [("root", root)]
        named_classes: dict[str, list[SyntaxNode]] = {}

        for line_number, raw_line in enumerate(lines, 1):
            stripped = self._strip_line_comment(raw_line, ext).strip()
            if not stripped:
                continue

            if ext == "rb":
                class_match = self.RUBY_CLASS_PATTERN.match(stripped)
                if class_match:
                    raw_name = class_match.group("name")
                    node = SyntaxNode(kind="class", name=raw_name.split("::")[-1], start_line=line_number, end_line=line_number)
                    self._append_child(self._nearest_attachable_node(stack), node)
                    named_classes.setdefault(node.name, []).append(node)
                    stack.append(("class", node))
                    continue

                def_match = self.RUBY_DEF_PATTERN.match(stripped)
                if def_match:
                    raw_name = def_match.group("name")
                    owner_name, func_name = self._split_owner_name(raw_name)
                    parent = None
                    if owner_name:
                        parent = self._find_or_create_named_class(root, named_classes, owner_name, line_number)
                    elif self._nearest_class_node(stack):
                        parent = self._nearest_class_node(stack)
                    node = SyntaxNode(
                        kind="method" if parent else "func",
                        name=func_name,
                        signature=self._format_signature(def_match.group("args") or ""),
                        start_line=line_number,
                        end_line=line_number,
                    )
                    self._append_child(parent or root, node)
                    stack.append(("def", node))
                    continue

                if self.RUBY_BLOCK_PATTERN.search(stripped):
                    stack.append(("block", None))
                    continue

                if stripped == "end":
                    self._close_block(stack, line_number)
                    continue

            if ext == "lua":
                func_match = self.LUA_FUNC_PATTERN.match(stripped)
                if func_match:
                    raw_name = func_match.group("name")
                    owner_name, func_name = self._split_owner_name(raw_name)
                    parent = self._find_or_create_named_class(root, named_classes, owner_name, line_number) if owner_name else None
                    node = SyntaxNode(
                        kind="method" if parent else "func",
                        name=func_name,
                        signature=self._format_signature(func_match.group("args") or ""),
                        start_line=line_number,
                        end_line=line_number,
                    )
                    self._append_child(parent or root, node)
                    stack.append(("function", node))
                    continue

                if self.LUA_BLOCK_PATTERN.search(stripped):
                    stack.append(("block", None))
                    continue

                if stripped == "end":
                    self._close_block(stack, line_number)
                    continue

                if stripped.startswith("until "):
                    self._close_repeat_block(stack)
                    continue

        for _, node in stack[1:]:
            if node:
                node.end_line = max(node.end_line, len(lines))

        self._sort_tree(root)
        return root

    def _parse_shell_language(self, content: str) -> SyntaxNode:
        root = SyntaxNode(kind="root", name="root", start_line=1, end_line=max(1, len(content.splitlines())))
        line_lookup = self._make_line_lookup(content)

        for match in self.SHELL_FUNC_PATTERN.finditer(content):
            node = SyntaxNode(
                kind="func",
                name=match.group("name"),
                signature="()",
                start_line=line_lookup(match.start()),
                end_line=line_lookup(match.end()),
            )
            self._append_child(root, node)

        self._sort_tree(root)
        return root

    def _emit_symbols(self, module, tree: SyntaxNode) -> None:
        for node in tree.children:
            self._emit_node(module, node)

    def _emit_node(self, module, node: SyntaxNode) -> None:
        if node.kind == "class":
            self._append_symbol(module, "class", node.name, "")
            for child in node.children:
                self._emit_node(module, child)
            return

        if node.kind in {"func", "method"}:
            self._append_symbol(module, node.kind, node.name, node.signature)
            return

        for child in node.children:
            self._emit_node(module, child)

    def _append_symbol(self, module, symbol_type: str, name: str, signature: str) -> None:
        normalized = (symbol_type, name, signature)
        for symbol in module.symbols:
            if (symbol.type, symbol.name, symbol.signature) == normalized:
                return
        module.symbols.append(SymbolNode(type=symbol_type, name=name, signature=signature))

    def _attach_class_nodes(self, root: SyntaxNode, class_entries: list[tuple[int, int, SyntaxNode]]) -> None:
        sorted_entries = sorted(class_entries, key=lambda item: (item[0], -(item[1] - item[0])))
        for start, end, node in sorted_entries:
            parent = None
            parent_span = None
            for other_start, other_end, other_node in sorted_entries:
                if other_node is node:
                    continue
                if other_start <= start and end <= other_end:
                    current_span = other_end - other_start
                    if parent_span is None or current_span < parent_span:
                        parent = other_node
                        parent_span = current_span
            self._append_child(parent or root, node)

    def _index_named_classes(self, class_entries: list[tuple[int, int, SyntaxNode]]) -> dict[str, list[SyntaxNode]]:
        named: dict[str, list[SyntaxNode]] = {}
        for _, _, node in class_entries:
            named.setdefault(node.name, []).append(node)
        return named

    def _find_innermost_class(self, class_entries: list[tuple[int, int, SyntaxNode]], start: int, end: int) -> SyntaxNode | None:
        parent = None
        parent_span = None
        for class_start, class_end, node in class_entries:
            if class_start <= start and end <= class_end:
                current_span = class_end - class_start
                if parent_span is None or current_span < parent_span:
                    parent = node
                    parent_span = current_span
        return parent

    def _find_or_create_named_class(
        self,
        root: SyntaxNode,
        named_classes: dict[str, list[SyntaxNode]],
        owner_name: str,
        line_number: int,
    ) -> SyntaxNode:
        short_name = owner_name.split("::")[-1].split(".")[-1]
        candidates = named_classes.get(short_name, [])
        if candidates:
            return min(candidates, key=lambda node: abs(node.start_line - line_number))

        node = SyntaxNode(kind="class", name=short_name, start_line=line_number, end_line=line_number)
        self._append_child(root, node)
        named_classes.setdefault(short_name, []).append(node)
        return node

    def _append_child(self, parent: SyntaxNode, child: SyntaxNode) -> None:
        for existing in parent.children:
            if (existing.kind, existing.name, existing.signature, existing.start_line) == (
                child.kind,
                child.name,
                child.signature,
                child.start_line,
            ):
                return
        parent.children.append(child)

    def _nearest_attachable_node(self, stack: list[tuple[str, SyntaxNode | None]]) -> SyntaxNode:
        for _, node in reversed(stack):
            if node is not None:
                return node
        return stack[0][1] or SyntaxNode(kind="root", name="root")

    def _nearest_class_node(self, stack: list[tuple[str, SyntaxNode | None]]) -> SyntaxNode | None:
        for kind, node in reversed(stack):
            if kind == "class" and node is not None:
                return node
        return None

    def _close_block(self, stack: list[tuple[str, SyntaxNode | None]], line_number: int) -> None:
        if len(stack) <= 1:
            return
        _, node = stack.pop()
        if node is not None:
            node.end_line = line_number

    def _close_repeat_block(self, stack: list[tuple[str, SyntaxNode | None]]) -> None:
        if len(stack) > 1 and stack[-1][0] == "block":
            stack.pop()

    def _split_owner_name(self, raw_name: str) -> tuple[str, str]:
        if ":" in raw_name:
            owner, name = raw_name.rsplit(":", 1)
            return owner, name
        if "." in raw_name:
            owner, name = raw_name.rsplit(".", 1)
            return owner, name
        if "::" in raw_name:
            owner, name = raw_name.rsplit("::", 1)
            return owner, name
        return "", raw_name

    def _extract_receiver_owner(self, receiver: str) -> str:
        cleaned = re.sub(r'\s+', ' ', receiver).strip()
        if not cleaned:
            return ""
        parts = [part for part in re.split(r'[\s\*\[\]]+', cleaned) if part]
        if not parts:
            return ""
        return parts[-1].split(".")[-1]

    def _make_line_lookup(self, content: str):
        offsets = [0]
        for index, char in enumerate(content):
            if char == "\n":
                offsets.append(index + 1)

        def line_for(position: int) -> int:
            return max(1, bisect.bisect_right(offsets, position))

        return line_for

    def _extract_brace_block(self, content: str, start_index: int):
        brace_start = content.find("{", start_index)
        if brace_start == -1:
            return None

        depth = 0
        for index in range(brace_start, len(content)):
            char = content[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return brace_start, index + 1, content[brace_start + 1:index]
        return None

    def _strip_line_comment(self, line: str, ext: str) -> str:
        if ext == "rb":
            return line.split("#", 1)[0]
        if ext == "lua":
            return line.split("--", 1)[0]
        return line

    def _sort_tree(self, node: SyntaxNode) -> None:
        node.children.sort(key=lambda child: (child.start_line, child.kind != "class", child.name.lower()))
        for child in node.children:
            self._sort_tree(child)

    def _format_signature(self, raw_signature: str) -> str:
        cleaned = re.sub(r'\s+', ' ', raw_signature or '').strip()
        return f"({cleaned})"


def get_plugin() -> LanguagePlugin:
    return PolyglotPlugin()