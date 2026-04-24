from pathlib import Path
from dsl_schema import DSLContext, ModuleNode

class ModuleMapper:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        # We should only include relevant text files
        for file in self.args.included_files:
            if file.is_file() and any(c.isalpha() for c in file.suffix):
                rel_path = file.relative_to(self.project_dir)
                name = file.stem
                if len(rel_path.parts) > 1:
                    name = f"{rel_path.parts[-2]}/{name}"
                
                ctx.modules.append(ModuleNode(
                    name=name,
                    filepath=rel_path.as_posix(),
                    role="",
                    state="wip"
                ))
