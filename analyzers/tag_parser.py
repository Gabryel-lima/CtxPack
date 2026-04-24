import re
from pathlib import Path
from dsl_schema import DSLContext

TAG_PATTERN = re.compile(r'(?://|#|--|;;)\s*@(\w+):\s*(.+)')

class TagParser:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        # We should parse all relevant files.
        for file in self.args.included_files:
            if file.is_file() and any(c.isalpha() for c in file.suffix):
                try:
                    content = file.read_text(encoding="utf-8", errors="ignore")
                    lines = content.splitlines()
                    for line in lines:
                        match = TAG_PATTERN.search(line)
                        if match:
                            tag, value = match.groups()
                            tag = tag.lower()
                            value = value.strip()
                            rel_path = file.relative_to(self.project_dir).as_posix()
                            
                            # Find the module node corresponding to this file
                            mod = next((m for m in ctx.modules if m.filepath == rel_path), None)

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
                except Exception:
                    pass
