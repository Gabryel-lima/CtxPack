from dsl_schema import DSLContext

HEADER_INSTRUCTION = (
    "<!-- DSL SEMÂNTICA: PRJ=projeto, DEP=dependências, MOD=módulo, "
    "REL=relação entre módulos, CONV=convenções, DEC=decisão de design, "
    "BUG=problema conhecido, NOW=foco atual, CTX=contexto extra -->\n"
)

def build_dsl(ctx: DSLContext) -> str:
    lines = [HEADER_INSTRUCTION]
    p = ctx.project

    # PRJ
    prj = f"PRJ:{p.name}"
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
        line = f"MOD:{m.name}|file:{m.filepath}"
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
