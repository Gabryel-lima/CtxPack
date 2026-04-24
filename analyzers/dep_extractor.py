import re
from pathlib import Path
from dsl_schema import DSLContext

class DepExtractor:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        deps = set()
        req_file = self.project_dir / "requirements.txt"
        if req_file.exists():
            for line in req_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    # Strip versions
                    dep = re.split(r'[=<>~]', line)[0].strip()
                    if dep:
                        deps.add(dep)
        
        makefile = self.project_dir / "Makefile"
        if makefile.exists():
            content = makefile.read_text(encoding="utf-8")
            if "gcc" in content: deps.add("gcc")
            if "nasm" in content: deps.add("nasm")
            if "ld" in content: deps.add("ld")
            if "bochs" in content: deps.add("bochs")
            if "qemu" in content: deps.add("qemu")

        ctx.deps = sorted(list(deps))
