from pathlib import Path
from dsl_schema import DSLContext, ModuleNode
from analyzers.heuristic_engine import infer_state, infer_role, infer_conventions
from filters.deduplicator import deduplicate_modules

class ModuleMapper:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        # Apply deduplication
        filepaths = [str(f.resolve()) for f in self.args.included_files if f.is_file() and any(c.isalpha() for c in f.suffix)]
        deduplicated_paths = deduplicate_modules(filepaths)
        
        files_for_conv = []
        
        for file_str in deduplicated_paths:
            file = Path(file_str)
            rel_path = file.relative_to(self.project_dir.resolve())
            name = file.stem
            if len(rel_path.parts) > 1:
                name = f"{rel_path.parts[-2]}/{name}"
            
            try:
                content = file.read_text(encoding='utf-8')
            except Exception:
                content = ""
            
            state = infer_state(file_str, content) or "wip"
            role = infer_role(file_str, content) or ""
            
            files_for_conv.append((file_str, content))

            ctx.modules.append(ModuleNode(
                name=name,
                filepath=rel_path.as_posix(),
                role=role,
                state=state
            ))
            
        conventions = infer_conventions(files_for_conv)
        if conventions:
            for conv in conventions:
                if conv not in ctx.conventions:
                    ctx.conventions.append(conv)
