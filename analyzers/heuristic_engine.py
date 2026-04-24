import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Step 2.2 Infer state
EMPTY_BODY_PATTERNS = [
    r'\)\s*\{\s*\}',           # C/C++/Java/JS
    r'def \w+[^:]+:\s*pass',   # Python
    r'fn \w+[^{]+\{\s*\}',     # Rust
    r'func \w+[^{]+\{\s*\}',   # Go
    r'unimplemented!\(\)',      # Rust macro
    r'raise NotImplementedError',
    r'TODO\(".*"\)',            # Kotlin
]

def infer_state(filepath: str, content: str) -> Optional[str]:
    lines = content.split('\n')
    lines_of_code = [line.strip() for line in lines if line.strip() and not line.strip().startswith(('//', '#', '--', ';;', '*', '<!--'))]
    
    if len(lines_of_code) < 10:
        return "planned"

    if any(m in content for m in ("TODO", "FIXME", "HACK", "XXX")):
        return "wip"

    if any(re.search(p, content) for p in EMPTY_BODY_PATTERNS):
        return "wip"

    if "not implemented" in content or "stub" in content:
        return "wip"

    return "done"


# Step 2.3 Infer role
UNIVERSAL_ROLE_PATTERNS = [
    # Project structure
    (r'[Mm]ain\.',       "entry point, initialization"),
    (r'[Ii]ndex\.',      "entry point, routing"),
    (r'[Aa]pp\.',        "application root"),
    (r'[Cc]onfig',       "configuration, parameters"),
    (r'[Cc]onstants?',   "global constants"),

    # Architectural patterns
    (r'[Mm]anager',      "orchestration, lifecycle"),
    (r'[Cc]ontroller',   "control logic, flow"),
    (r'[Ss]ervice',      "business logic"),
    (r'[Rr]epository',   "data access, persistence"),
    (r'[Ff]actory',      "object creation"),
    (r'[Hh]andler',      "event or error handling"),
    (r'[Mm]iddleware',   "intermediate processing"),
    (r'[Rr]outer',       "routing, dispatch"),
    (r'[Pp]ool',         "resource reuse"),
    (r'[Qq]ueue',        "task or message queue"),
    (r'[Cc]ache',        "cache, memoization"),
    (r'[Ss]cheduler',    "scheduling, timing"),

    # I/O and network
    (r'[Ll]oader',       "resource loading"),
    (r'[Pp]arser',       "parsing, format interpretation"),
    (r'[Ss]erializer',   "serialization, data conversion"),
    (r'[Cc]lient',       "external service client"),
    (r'[Ss]erver',       "server, listener"),
    (r'[Aa]uth',         "authentication, authorization"),
    (r'[Ss]ession',      "session management"),

    # Data and model
    (r'[Mm]odel',        "data model, entity"),
    (r'[Ss]chema',       "schema, structure validation"),
    (r'[Mm]igration',    "database migration"),
    (r'[Vv]alidator',    "input validation"),

    # UI / Render
    (r'[Rr]enderer',     "rendering pipeline"),
    (r'[Ss]hader',       "GLSL/HLSL shader"),
    (r'[Cc]amera',       "camera, view/projection"),
    (r'[Ww]indow',       "window, surface"),
    (r'[Ww]idget',       "interface component"),
    (r'[Oo]verlay',      "HUD, interface layer"),
    (r'[Pp]ost[Pp]rocess', "image post-processing"),

    # System and utilities
    (r'[Tt]hread[Pp]ool', "thread management"),
    (r'[Ll]ogger?',      "logging, diagnostics"),
    (r'[Uu]tils?',       "utility functions"),
    (r'[Tt]ypes?',       "type definitions"),
    (r'[Ii]nterface',    "interface contract"),
    (r'[Ee]rror',        "types and error handling"),

    # Tests
    (r'[Tt]est',         "automated tests"),
    (r'[Mm]ock',         "dependency mocks"),
    (r'[Bb]ench',        "performance benchmarks"),
]

def infer_role(filepath: str, content: str) -> Optional[str]:
    name = Path(filepath).name
    for pattern, role in UNIVERSAL_ROLE_PATTERNS:
        if re.search(pattern, name):
            return role

    parent = Path(filepath).parent.name
    if parent not in ("src", "lib", ".", ""):
        return f"{parent} module"

    return None

# Step 2.4 Infer CONV
IDENTIFIER_PATTERNS = {
    "snake_case":  r'\b[a-z][a-z0-9]*(_[a-z0-9]+)+\b',
    "camelCase":   r'\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b',
    "PascalCase":  r'\b[A-Z][a-zA-Z0-9]{2,}\b',
    "UPPER_CASE":  r'\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\b',
    "hungarian":   r'\b(m_|g_|s_|p_)[a-z]',
    "prefix_I":    r'\bI[A-Z][a-zA-Z]+\b',
}

def infer_conventions(files: List[Tuple[str, str]]) -> List[str]:
    # Very simplified version of convention scanning
    conventions = []
    
    counts = {name: 0 for name in IDENTIFIER_PATTERNS}
    total_identifiers = 0
    
    for filepath, content in files:
        # Avoid scanning massive files
        content = content[:10000]
        for name, pattern in IDENTIFIER_PATTERNS.items():
            matches = len(re.findall(pattern, content))
            counts[name] += matches
            total_identifiers += matches

    if total_identifiers == 0:
        return []

    for name, count in counts.items():
        if count / total_identifiers > 0.2:
            conventions.append(name)
            
    return conventions
