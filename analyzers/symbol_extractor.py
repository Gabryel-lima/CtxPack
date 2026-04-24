import ast
from pathlib import Path
from typing import Optional

from dsl_schema import DSLContext, SymbolNode


class BaseLanguageSymbolExtractor:
    """Base class for language-specific symbol extractors.

    Subclasses should implement `extract_module(module, project_dir)` to
    populate `module.symbols` with `SymbolNode` entries.
    """

    def extract_module(self, module, project_dir: Path) -> None:
        raise NotImplementedError()


class PythonSymbolExtractor(BaseLanguageSymbolExtractor):
    def extract_module(self, module, project_dir: Path) -> None:
        file_path = project_dir / module.filepath
        if not file_path.exists():
            return
        try:
            content = file_path.read_text(encoding="utf-8")
            tree = ast.parse(content)
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    module.symbols.append(SymbolNode(
                        type="func",
                        name=node.name,
                        signature=self._format_args(node.args)
                    ))
                elif isinstance(node, ast.ClassDef):
                    module.symbols.append(SymbolNode(
                        type="class",
                        name=node.name,
                        signature=""
                    ))
                    for subnode in node.body:
                        if isinstance(subnode, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            module.symbols.append(SymbolNode(
                                type="method",
                                name=subnode.name,
                                signature=self._format_args(subnode.args)
                            ))
        except Exception:
            # Keep extractor robust: ignore parse/read errors
            return

    def _format_args(self, args_node) -> str:
        args = []
        for a in getattr(args_node, 'args', []):
            arg_str = a.arg
            if getattr(a, 'annotation', None):
                arg_str += f": {self._get_annotation_str(a.annotation)}"
            args.append(arg_str)
        if getattr(args_node, 'vararg', None):
            args.append(f"*{args_node.vararg.arg}")
        if getattr(args_node, 'kwarg', None):
            args.append(f"**{args_node.kwarg.arg}")

        for k in getattr(args_node, 'kwonlyargs', []):
            arg_str = k.arg
            if getattr(k, 'annotation', None):
                arg_str += f": {self._get_annotation_str(k.annotation)}"
            args.append(arg_str)

        return f"({', '.join(args)})"

    def _get_annotation_str(self, node) -> str:
        if isinstance(node, ast.Name):
            return node.id
        elif hasattr(ast, 'unparse'):
            return ast.unparse(node)
        return "Any"

class CppSymbolExtractor(BaseLanguageSymbolExtractor):
    #TODO: implement C++ symbol extraction using a simple regex-based approach or a C++ parser library.
    def extract_module(self, module, project_dir: Path) -> None:
        file_path = project_dir / module.filepath
        if not file_path.exists():
            return
        try:
            content = file_path.read_text(encoding="utf-8")
            tree = ast.parse(content)
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    module.symbols.append(SymbolNode(
                        type="func",
                        name=node.name,
                        signature=self._format_args(node.args)
                    ))
                elif isinstance(node, ast.ClassDef):
                    module.symbols.append(SymbolNode(
                        type="class",
                        name=node.name,
                        signature=""
                    ))
                    for subnode in node.body:
                        if isinstance(subnode, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            module.symbols.append(SymbolNode(
                                type="method",
                                name=subnode.name,
                                signature=self._format_args(subnode.args)
                            ))
        except Exception:
            # Keep extractor robust: ignore parse/read errors
            return

class SymbolExtractor:
    """Coordinator that chooses language extractors per module.

    Usage: instantiate with the project root path and call `populate(ctx)`.
    """

    def __init__(self, project_dir: str, args: Optional[object] = None):
        self.project_dir = Path(project_dir)
        self.args = args
        # simple registry mapping file extensions to extractor classes
        self._registry = {
            ".py": PythonSymbolExtractor(),
            ".cpp": CppSymbolExtractor(),
        }

    def populate(self, ctx: DSLContext) -> None:
        for module in ctx.modules:
            ext = Path(module.filepath).suffix
            extractor = self._registry.get(ext)
            if extractor:
                extractor.extract_module(module, self.project_dir)
            # unknown extensions are skipped; future extractors can be added to the registry
