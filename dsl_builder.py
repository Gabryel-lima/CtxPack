from dsl_schema import DSLContext, ProjectNode

HEADER_INSTRUCTION = (
    "<!-- DSL SEMANTIC: PRJ=project, DEP=dependencies, MOD=module, "
    "REL=module relations, CONV=conventions, DEC=design decisions, "
    "BUG=known issues, NOW=current focus, CTX=extra context -->\n"
)

QUERY_HEADER_INSTRUCTION = (
    "<!-- DSL SEMANTIC (QUERY SUBSET): PRJ=project, DEP=dependencies, MOD=module, "
    "REL=module relations, CONV=conventions, DEC=design decisions, "
    "BUG=known issues, NOW=current focus, CTX=extra context, "
    "WHY=why this module was selected for the query -->\n"
)

def build_dsl(ctx: DSLContext) -> str:
    lines: list[str] = [HEADER_INSTRUCTION]
    p: ProjectNode = ctx.project

    # PRJ
    prj: str = f"PRJ:{p.name}"
    if p.languages:
        prj += f"|lang:{','.join(p.languages)}"
    if p.arch:
        prj += f"|arch:{p.arch}"
    if p.target:
        prj += f"|target:{p.target}"
    if p.filesystem:
        prj += f"|fs:{p.filesystem}"
    lines.append(prj)

    # DEP
    if ctx.deps:
        lines.append(f"DEP:{','.join(ctx.deps)}")

    # MOD
    for m in ctx.modules:
        line: str = f"MOD:{m.name}|file:{m.filepath}"
        if m.role:
            line += f"|role:{m.role}"
        line += f"|state:{m.state}"
        lines.append(line)
        for sym in getattr(m, 'symbols', []):
            if sym.type == 'class':
                lines.append(f"  CLASS:{sym.name}")
            elif sym.type == 'method':
                lines.append(f"    FUNC:{sym.name}{sym.signature}")
            elif sym.type == 'func':
                lines.append(f"  FUNC:{sym.name}{sym.signature}")

    # REL
    for r in ctx.relations:
        lines.append(f"REL:{r.source}->{r.target}|via:{r.via}")

    # CONV
    if ctx.conventions:
        lines.append("CONV:" + "|".join(ctx.conventions))

    # DEC
    for d in ctx.decisions:
        lines.append(f"DEC:{d.decision}|why:{d.why}")

    # BUG
    for b in ctx.bugs:
        lines.append(f"BUG:{b.description}|mod:{b.module}|state:{b.state}")

    # NOW
    if ctx.now:
        lines.append(f"NOW:{ctx.now}")

    # CTX
    for e in ctx.extra:
        lines.append(f"CTX:{e}")

    return "\n".join(lines)


def build_dsl_subset(ctx: DSLContext, selected) -> str:
    """Renders a trimmed DSL containing only the given module scores (as
    returned by analyzers.relevance_ranker.rank_modules), preserving only the
    REL edges, decisions, bugs and extra context that reference a selected
    module. Adds a WHY: line per module explaining why it was selected."""
    selected_names = {item.module.name for item in selected}
    selected_filepaths = {item.module.filepath for item in selected}
    selected_stems = {item.module.filepath.rsplit("/", 1)[-1].rsplit(".", 1)[0] for item in selected}

    lines: list[str] = [QUERY_HEADER_INSTRUCTION]
    p: ProjectNode = ctx.project

    prj: str = f"PRJ:{p.name}"
    if p.languages:
        prj += f"|lang:{','.join(p.languages)}"
    if p.arch:
        prj += f"|arch:{p.arch}"
    if p.target:
        prj += f"|target:{p.target}"
    if p.filesystem:
        prj += f"|fs:{p.filesystem}"
    lines.append(prj)

    if ctx.deps:
        lines.append(f"DEP:{','.join(ctx.deps)}")

    for item in selected:
        m = item.module
        line: str = f"MOD:{m.name}|file:{m.filepath}"
        if m.role:
            line += f"|role:{m.role}"
        line += f"|state:{m.state}"
        lines.append(line)
        for sym in getattr(m, "symbols", []):
            if sym.type == "class":
                lines.append(f"  CLASS:{sym.name}")
            elif sym.type == "method":
                lines.append(f"    FUNC:{sym.name}{sym.signature}")
            elif sym.type == "func":
                lines.append(f"  FUNC:{sym.name}{sym.signature}")
        lines.append(f"WHY:{m.name}|{','.join(item.reasons) or 'seed match'}")

    for r in ctx.relations:
        if r.source in selected_names and r.target in selected_names:
            lines.append(f"REL:{r.source}->{r.target}|via:{r.via}")

    if ctx.conventions:
        lines.append("CONV:" + "|".join(ctx.conventions))

    def _mentions_selected(text: str) -> bool:
        haystack = text.lower()
        return any(
            token.lower() in haystack
            for token in selected_names | selected_filepaths | selected_stems
            if len(token) >= 3
        )

    for d in ctx.decisions:
        if _mentions_selected(f"{d.decision} {d.why}"):
            lines.append(f"DEC:{d.decision}|why:{d.why}")

    for b in ctx.bugs:
        if b.module in selected_names or b.module in selected_stems:
            lines.append(f"BUG:{b.description}|mod:{b.module}|state:{b.state}")

    if ctx.now:
        lines.append(f"NOW:{ctx.now}")

    for e in ctx.extra:
        # CTX entries carry an explicit "relpath: summary" association from
        # TagParser — trust that exact prefix rather than a fuzzy substring
        # match, which would false-positive whenever a module's name happens
        # to collide with a common word mentioned elsewhere (e.g. a module
        # named after the project itself).
        rel_path = e.split(":", 1)[0].strip()
        if rel_path in selected_filepaths:
            lines.append(f"CTX:{e}")

    return "\n".join(lines)
