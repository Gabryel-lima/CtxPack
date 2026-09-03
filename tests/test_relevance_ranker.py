#!/usr/bin/env python3
"""Unit tests for analyzers.relevance_ranker — run via `python -m unittest`."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analyzers.relevance_ranker import rank_modules
from dsl_schema import DSLContext, ModuleNode, RelationNode, SymbolNode


def _make_ctx() -> DSLContext:
    ctx = DSLContext()
    ctx.modules = [
        ModuleNode(
            name="auth/login",
            filepath="auth/login.py",
            role="business logic",
            symbols=[SymbolNode(type="func", name="login", signature="(user, password)")],
        ),
        ModuleNode(
            name="auth/session",
            filepath="auth/session.py",
            role="business logic",
        ),
        ModuleNode(
            name="reports/export",
            filepath="reports/export.py",
            role="io",
        ),
        ModuleNode(
            name="unrelated/util",
            filepath="unrelated/util.py",
            role="misc",
        ),
    ]
    ctx.relations = [
        RelationNode(source="auth/login", target="auth/session", via="auth.session"),
    ]
    return ctx


class RankModulesTest(unittest.TestCase):
    def test_exact_name_match_scores_highest(self) -> None:
        ctx = _make_ctx()
        results = rank_modules(ctx, "login")
        self.assertTrue(results)
        self.assertEqual(results[0].module.name, "auth/login")
        self.assertGreater(results[0].score, 0)

    def test_related_module_scores_above_unrelated(self) -> None:
        ctx = _make_ctx()
        results = rank_modules(ctx, "login")
        scores_by_name = {item.module.name: item.score for item in results}
        self.assertIn("auth/session", scores_by_name)
        self.assertNotIn("unrelated/util", scores_by_name)
        self.assertGreater(scores_by_name["auth/session"], 0)

    def test_min_score_filters_zero_signal_modules(self) -> None:
        ctx = _make_ctx()
        # "login" seeds auth/login at 1.0; auth/session only gets the
        # 1-hop graph-propagated score (1.0 * hop_decay=0.5 = 0.5), so a
        # 0.6 floor should drop it while keeping the direct match.
        results = rank_modules(ctx, "login", min_score=0.6)
        names = {item.module.name for item in results}
        self.assertNotIn("auth/session", names)
        self.assertNotIn("reports/export", names)
        self.assertNotIn("unrelated/util", names)
        self.assertIn("auth/login", names)

    def test_file_hint_seeds_score(self) -> None:
        ctx = _make_ctx()
        results = rank_modules(ctx, "", file_hint="reports/export.py")
        self.assertTrue(results)
        self.assertEqual(results[0].module.name, "reports/export")
        self.assertIn("file-hint", results[0].reasons[0])

    def test_symbol_hint_seeds_score(self) -> None:
        ctx = _make_ctx()
        results = rank_modules(ctx, "", symbol_hint="login")
        names = [item.module.name for item in results]
        self.assertIn("auth/login", names)

    def test_top_limits_result_count(self) -> None:
        ctx = _make_ctx()
        results = rank_modules(ctx, "auth business logic", top=1)
        self.assertLessEqual(len(results), 1)


if __name__ == "__main__":
    unittest.main()
