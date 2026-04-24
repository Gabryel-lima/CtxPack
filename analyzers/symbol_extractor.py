import ast
from pathlib import Path
from dsl_schema import DSLContext, SymbolNode

class SymbolExtractor:
    def __init__(self, project_dir: str, args):
        self.project_dir = Path(project_dir)
        self.args = args

    def populate(self, ctx: DSLContext):
        for module in ctx.modules:
            if module.filepath.endswith(".py"):
                self._extract_python_symbols(module)

    def _extract_python_symbols(self, module):
        file_path = self.project_dir / module.filepath
        try:
            content = file_path.read_text(encoding="utf-8")
            tree = ast.parse(content)
            for node in tree.body:
                if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
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
                        if isinstance(subnode, ast.FunctionDef) or isinstance(subnode, ast.AsyncFunctionDef):
                            module.symbols.append(SymbolNode(
                                type="method",
                                name=subnode.name,
                                signature=self._format_args(subnode.args)
                            ))
        except Exception:
            pass

    def _format_args(self, args_node) -> str:
        args = []
        for a in args_node.args:
            arg_str = a.arg
            if hasattr(a, 'annotation') and a.annotation:
                arg_str += f": {self._get_annotation_str(a.annotation)}"
            args.append(arg_str)
        if args_node.vararg:
            args.append(f"*{args_node.vararg.arg}")
        if args_node.kwarg:
            args.append(f"**{args_node.kwarg.arg}")
        
        for k in getattr(args_node, 'kwonlyargs', []):
            arg_str = k.arg
            if hasattr(k, 'annotation') and k.annotation:
                arg_str += f": {self._get_annotation_str(k.annotation)}"
            args.append(arg_str)
            
        return f"({', '.join(args)})"

    def _get_annotation_str(self, node) -> str:
        if isinstance(node, ast.Name):
            return node.id
        elif hasattr(ast, 'unparse'):
            return ast.unparse(node)
        return "Any"
