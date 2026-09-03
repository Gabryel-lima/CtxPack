"""Ranks an already-built DSLContext's modules by relevance to a query.

This is not a pipeline Analyzer (it doesn't populate a DSLContext) — it reads
a finished context and scores modules using a lightweight, dependency-free
heuristic: lexical/substring overlap against module names, paths, symbols and
tag-derived text, boosted by proximity in the import graph (ctx.relations).
No embeddings, no ML — purely reuses data the existing analyzers already
computed.
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

from dsl_schema import DSLContext, ModuleNode

_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")

NAME_WEIGHT = 1.0
SYMBOL_WEIGHT = 0.8
TAG_WEIGHT = 0.6
ROLE_WEIGHT = 0.4
HINT_SCORE = 1.0


@dataclass
class ModuleScore:
    module: ModuleNode
    score: float
    reasons: list[str] = field(default_factory=list)


def _tokenize(text: str) -> set[str]:
    if not text:
        return set()
    return {t.lower() for t in _TOKEN_RE.findall(text) if len(t) >= 2}


def _collect_tag_texts(ctx: DSLContext) -> dict[str, str]:
    """Maps module identifiers (filepath, filepath stem, or name) to text
    pulled from @ctx-inferred summaries, @bug descriptions and @dec entries
    that mention them — the same data TagParser already populated."""
    texts: dict[str, list[str]] = {}

    def _add(key: str, text: str) -> None:
        if key and text:
            texts.setdefault(key, []).append(text)

    for entry in ctx.extra:
        if ":" in entry:
            rel_path, _, summary = entry.partition(":")
            rel_path = rel_path.strip()
            _add(rel_path, summary.strip())
            _add(Path(rel_path).stem, summary.strip())

    for bug in ctx.bugs:
        _add(bug.module, bug.description)

    for module in ctx.modules:
        name_lower = module.name.lower()
        if len(name_lower) < 3:
            continue
        for decision in ctx.decisions:
            haystack = f"{decision.decision} {decision.why}".lower()
            if name_lower in haystack:
                _add(module.name, f"{decision.decision} {decision.why}")

    return {key: " ".join(values) for key, values in texts.items()}


def _lexical_score(
    module: ModuleNode, query_tokens: set[str], tag_texts: dict[str, str]
) -> tuple[float, list[str]]:
    if not query_tokens:
        return 0.0, []

    best = 0.0
    reasons: list[str] = []

    def _consider(source_text: str, weight: float, label: str) -> None:
        nonlocal best
        overlap = query_tokens & _tokenize(source_text)
        if not overlap:
            return
        score = weight * (len(overlap) / len(query_tokens))
        if score > best:
            best = score
        reasons.append(f"{label}({','.join(sorted(overlap))})")

    _consider(f"{module.name} {module.filepath}", NAME_WEIGHT, "name-match")

    symbol_names = " ".join(sym.name for sym in getattr(module, "symbols", []))
    _consider(symbol_names, SYMBOL_WEIGHT, "symbol-match")

    _consider(module.role, ROLE_WEIGHT, "role-match")

    stem = Path(module.filepath).stem
    tag_text = " ".join(
        tag_texts.get(key, "") for key in (module.filepath, module.name, stem)
    )
    _consider(tag_text, TAG_WEIGHT, "tag-match")

    return best, reasons


def _build_adjacency(ctx: DSLContext) -> dict[str, set[str]]:
    adjacency: dict[str, set[str]] = {}
    for rel in ctx.relations:
        adjacency.setdefault(rel.source, set()).add(rel.target)
        adjacency.setdefault(rel.target, set()).add(rel.source)
    return adjacency


def _propagate_graph_scores(
    seed_scores: dict[str, float],
    adjacency: dict[str, set[str]],
    max_hops: int,
    hop_decay: float,
) -> tuple[dict[str, float], dict[str, str]]:
    graph_scores: dict[str, float] = {}
    graph_reasons: dict[str, str] = {}
    visited = set(seed_scores.keys())
    frontier = list(seed_scores.items())
    hop = 0

    while frontier and hop < max_hops:
        hop += 1
        next_frontier: list[tuple[str, float]] = []
        for name, score in frontier:
            decayed = score * hop_decay
            if decayed <= 0:
                continue
            for neighbor in sorted(adjacency.get(name, ())):
                if neighbor in visited:
                    continue
                graph_scores[neighbor] = decayed
                graph_reasons[neighbor] = f"graph:{hop}-hop via {name}"
                next_frontier.append((neighbor, decayed))
        for name, _ in next_frontier:
            visited.add(name)
        frontier = next_frontier

    return graph_scores, graph_reasons


def rank_modules(
    ctx: DSLContext,
    query: str = "",
    file_hint: str | None = None,
    symbol_hint: str | None = None,
    max_hops: int = 2,
    hop_decay: float = 0.5,
    top: int | None = None,
    min_score: float = 0.0,
) -> list[ModuleScore]:
    query_tokens = _tokenize(query)
    tag_texts = _collect_tag_texts(ctx)

    lexical_scores: dict[str, float] = {}
    lexical_reasons: dict[str, list[str]] = {}

    for module in ctx.modules:
        score, reasons = _lexical_score(module, query_tokens, tag_texts)
        if score > 0:
            lexical_scores[module.name] = score
            lexical_reasons[module.name] = reasons

    if file_hint:
        needle = file_hint.strip().lower()
        if needle:
            for module in ctx.modules:
                if needle in module.filepath.lower() or needle in module.name.lower():
                    lexical_scores[module.name] = max(lexical_scores.get(module.name, 0.0), HINT_SCORE)
                    lexical_reasons.setdefault(module.name, []).append(f"file-hint({file_hint})")

    if symbol_hint:
        needle = symbol_hint.strip().lower()
        if needle:
            for module in ctx.modules:
                for sym in getattr(module, "symbols", []):
                    if needle in sym.name.lower():
                        lexical_scores[module.name] = max(lexical_scores.get(module.name, 0.0), HINT_SCORE)
                        lexical_reasons.setdefault(module.name, []).append(
                            f"symbol-hint({symbol_hint}:{sym.name})"
                        )
                        break

    adjacency = _build_adjacency(ctx)
    graph_scores, graph_reasons = _propagate_graph_scores(
        lexical_scores, adjacency, max_hops, hop_decay
    )

    module_by_name = {m.name: m for m in ctx.modules}
    results: list[ModuleScore] = []

    for name in set(lexical_scores) | set(graph_scores):
        module = module_by_name.get(name)
        if module is None:
            continue

        score = max(lexical_scores.get(name, 0.0), graph_scores.get(name, 0.0))
        if score < min_score:
            continue

        reasons = list(lexical_reasons.get(name, []))
        if name in graph_reasons:
            reasons.append(graph_reasons[name])

        results.append(ModuleScore(module=module, score=round(score, 4), reasons=reasons))

    results.sort(key=lambda ms: ms.score, reverse=True)
    if top is not None:
        results = results[:top]
    return results
