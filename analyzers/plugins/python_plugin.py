import ast
from pathlib import Path
from typing import Optional

from dsl_schema import SymbolNode
from analyzers.language_plugin import LanguagePlugin


class PythonPlugin(LanguagePlugin):
    def file_extensions(self):
        return ["py"]

    def detect(self, content: str, path: Path) -> float:
        # strong signal from extension, fallback to simple heuristics
        if path.suffix == ".py":
            return 1.0
        if content and ("def " in content or "class " in content):
            return 0.5
        return 0.0

    def extract_symbols(self, module, project_dir: Path) -> None:
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
            return

    def _format_args(self, args_node) -> str:
        args = []
        for a in getattr(args_node, 'args', []):
            arg_str = a.arg
            if getattr(a, 'annotation', None):
                try:
                    # use ast.unparse when available
                    import ast as _ast
                    if hasattr(_ast, 'unparse'):
                        ann = _ast.unparse(a.annotation)
                    else:
                        ann = getattr(a.annotation, 'id', 'Any')
                except Exception:
                    ann = 'Any'
                arg_str += f": {ann}"
            args.append(arg_str)
        if getattr(args_node, 'vararg', None):
            args.append(f"*{args_node.vararg.arg}")
        if getattr(args_node, 'kwarg', None):
            args.append(f"**{args_node.kwarg.arg}")

        for k in getattr(args_node, 'kwonlyargs', []):
            arg_str = k.arg
            if getattr(k, 'annotation', None):
                try:
                    import ast as _ast
                    if hasattr(_ast, 'unparse'):
                        ann = _ast.unparse(k.annotation)
                    else:
                        ann = getattr(k.annotation, 'id', 'Any')
                except Exception:
                    ann = 'Any'
                arg_str += f": {ann}"
            args.append(arg_str)

        return f"({', '.join(args)})"


def get_plugin() -> LanguagePlugin:
    return PythonPlugin()
