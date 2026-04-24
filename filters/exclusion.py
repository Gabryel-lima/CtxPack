import re
from pathlib import Path

EXCLUSION_CATEGORIES = {
    "vendor": [
        "libs/", "vendor/", "third_party/", "external/",
        "submodules/", "dependencies/"
    ],
    "build": [
        "build/", "dist/", "out/", "target/", "bin/", "obj/",
        ".gradle/", "cmake-build-*/", "__pycache__/", "*.egg-info/"
    ],
    "vcs": [
        ".git/", ".svn/", ".hg/"
    ],
    "test": [
        "tests/", "test/", "spec/", "__tests__/", "e2e/"
    ],
    "docs": [
        "docs/", "doc/", "documentation/", "examples/", "samples/"
    ],
    "env": [
        ".venv/", "venv/", "env/", "node_modules/", ".tox/"
    ],
}

DEFAULT_EXCLUDE = {"vendor", "build", "vcs", "env"}
DEFAULT_INCLUDE = {"test", "docs"}

class ExclusionFilter:
    def __init__(self, excluded_categories=None, included_categories=None):
        self.excluded = excluded_categories if excluded_categories is not None else DEFAULT_EXCLUDE.copy()
        self.included = included_categories if included_categories is not None else DEFAULT_INCLUDE.copy()
        
        # Remove from excluded if explicitly included
        self.excluded = self.excluded - self.included

    def is_excluded(self, path: str) -> bool:
        # Simple glob/string match for now
        path_obj = Path(path)
        parts = path_obj.parts
        
        for category in self.excluded:
            patterns = EXCLUSION_CATEGORIES.get(category, [])
            for pattern in patterns:
                pattern = pattern.rstrip('/')
                # Check if any part matches the pattern (simplified)
                if any(p == pattern or (pattern.startswith('*') and p.endswith(pattern[1:])) for p in parts):
                    return True
        return False
