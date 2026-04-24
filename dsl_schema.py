from dataclasses import dataclass, field

@dataclass
class ProjectNode:
    name: str = ""
    version: str = ""
    languages: list[str] = field(default_factory=list)
    arch: str = ""
    target: str = ""
    filesystem: str | None = None

@dataclass
class SymbolNode:
    type: str = "" # "class" | "func" | "method"
    name: str = ""
    signature: str = ""

@dataclass
class ModuleNode:
    name: str = ""
    filepath: str = ""
    role: str = ""
    state: str = "wip"  # done | wip | planned
    symbols: list[SymbolNode] = field(default_factory=list)

@dataclass
class RelationNode:
    source: str = ""
    target: str = ""
    via: str = ""

@dataclass
class DecisionNode:
    decision: str = ""
    why: str = ""

@dataclass
class BugNode:
    description: str = ""
    module: str = ""
    state: str = "open"  # open | fixed

@dataclass
class DSLContext:
    project: ProjectNode = field(default_factory=ProjectNode)
    deps: list[str] = field(default_factory=list)
    modules: list[ModuleNode] = field(default_factory=list)
    relations: list[RelationNode] = field(default_factory=list)
    conventions: list[str] = field(default_factory=list)
    decisions: list[DecisionNode] = field(default_factory=list)
    bugs: list[BugNode] = field(default_factory=list)
    now: str = ""
    extra: list[str] = field(default_factory=list)
