import re
from pathlib import Path

from dsl_schema import DSLContext, RelationNode


IMPORT_PATTERNS = [
    re.compile(r'^\s*from\s+([\.\w/]+)\s+import\b', re.MULTILINE),
    re.compile(r'^\s*import\s+([\.\w/]+)\b', re.MULTILINE),
    re.compile(r'^\s*import\s+.*?\s+from\s+["\']([^"\']+)["\']', re.MULTILINE),
    re.compile(r'^\s*using\s+([A-Za-z0-9_\.]+)\s*;', re.MULTILINE),
    re.compile(r'^\s*(?:const|let|var)\s+.+?=\s*require\(["\']([^"\']+)["\']\)', re.MULTILINE),
    re.compile(r'^\s*(?:require|require_once|include|include_once)\s*(?:\(?\s*__DIR__\s*\.\s*)?["\']([^"\']+)["\']\)?', re.MULTILINE),
    re.compile(r'^\s*require_relative\s+["\']([^"\']+)["\']', re.MULTILINE),
    re.compile(r'^\s*require\s+["\']([^"\']+)["\']', re.MULTILINE),
    re.compile(r'^\s*(?:local\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*require\s*\(?["\']([^"\']+)["\']\)?', re.MULTILINE),
    re.compile(r'^\s*use\s+([A-Za-z0-9_:]+)', re.MULTILINE),
    re.compile(r'^\s*mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;', re.MULTILINE),
    re.compile(r'^\s*import\s+(?:[A-Za-z0-9_]+\s+)?["\']([^"\']+)["\']', re.MULTILINE),
    re.compile(r'^\s*import\s+([A-Za-z0-9_\.]+)', re.MULTILINE),
    re.compile(r'^\s*#include\s+[<"]([^">]+)[">]', re.MULTILINE),
    re.compile(r'^\s*(?:source|\.)\s+([^\s]+)', re.MULTILINE),
]

class RelationFinder:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        module_lookup = self._build_module_lookup(ctx)
        seen_relations = {(rel.source, rel.target, rel.via) for rel in ctx.relations}

        for module in ctx.modules:
            file_path = self.project_dir / module.filepath
            if not file_path.exists():
                continue
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            for raw_target in self._find_import_targets(content):
                normalized_candidates = self._normalize_target(raw_target)
                if not normalized_candidates:
                    continue
                target_module = self._resolve_target(module, normalized_candidates, module_lookup)
                if not target_module or target_module == module.name:
                    continue

                relation_key = (module.name, target_module, raw_target)
                if relation_key in seen_relations:
                    continue
                ctx.relations.append(RelationNode(source=module.name, target=target_module, via=raw_target))
                seen_relations.add(relation_key)

    def _build_module_lookup(self, ctx: DSLContext) -> dict[str, list[tuple[str, str]]]:
        lookup: dict[str, list[tuple[str, str]]] = {}
        for module in ctx.modules:
            rel_path = Path(module.filepath)
            variants = {
                module.name.lower(),
                module.filepath.lower(),
                rel_path.stem.lower(),
                rel_path.with_suffix("").as_posix().lower(),
                "/".join(rel_path.with_suffix("").parts).lower(),
                ".".join(rel_path.with_suffix("").parts).lower(),
            }
            for variant in variants:
                if variant:
                    lookup.setdefault(variant, []).append((module.name, module.filepath))
        return lookup

    def _resolve_target(
        self,
        source_module,
        normalized_candidates: list[str],
        module_lookup: dict[str, list[tuple[str, str]]],
    ) -> str:
        for candidate_key in normalized_candidates:
            candidates = module_lookup.get(candidate_key, [])
            if not candidates:
                continue
            if len(candidates) == 1:
                return candidates[0][0]
            return self._pick_closest_module(source_module.filepath, candidates)
        return ""

    def _pick_closest_module(self, source_filepath: str, candidates: list[tuple[str, str]]) -> str:
        source_parent = Path(source_filepath).parent.parts

        def score(candidate: tuple[str, str]) -> tuple[int, int]:
            _, candidate_filepath = candidate
            candidate_parent = Path(candidate_filepath).parent.parts
            shared_prefix = 0
            for source_part, candidate_part in zip(source_parent, candidate_parent):
                if source_part != candidate_part:
                    break
                shared_prefix += 1
            same_parent = int(candidate_parent == source_parent)
            return same_parent, shared_prefix

        best_name, _ = max(candidates, key=score)
        return best_name

    def _find_import_targets(self, content: str) -> set[str]:
        matches: set[str] = set()
        for pattern in IMPORT_PATTERNS:
            for match in pattern.finditer(content):
                raw = next((group for group in match.groups() if group), "")
                raw = raw.strip()
                if raw:
                    matches.add(raw)
        return matches

    def _normalize_target(self, raw_target: str) -> list[str]:
        normalized = raw_target.strip().strip('"\'')
        if not normalized or normalized.startswith(("http://", "https://", "@")):
            return []

        normalized = normalized.replace("\\", "/")
        normalized = normalized.replace("::", "/")
        normalized = normalized.lstrip("./")
        normalized = re.sub(r'\.(py|js|jsx|mjs|ts|tsx|java|kt|cs|swift|dart|rs|go|php|rb|lua|c|cc|cpp|cxx|h|hpp|sh|bash)$', '', normalized)
        normalized = normalized.removesuffix("/index")
        normalized = normalized.removesuffix("/main")

        if not normalized:
            return []

        parts = [part for part in re.split(r'[/.]', normalized) if part and part not in {"crate", "self", "super"}]
        if not parts:
            return []

        candidates = [
            "/".join(parts).lower(),
            ".".join(parts).lower(),
            parts[-1].lower(),
        ]
        return [candidate for candidate in candidates if candidate]
