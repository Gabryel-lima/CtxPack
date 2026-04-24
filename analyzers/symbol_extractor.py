from pathlib import Path
from typing import Optional, List, Dict
import importlib
import pkgutil

from dsl_schema import DSLContext
from analyzers.language_plugin import LanguagePlugin


class SymbolExtractor:
    """Coordinator that chooses language plugins per module.

    Plugins must implement the `LanguagePlugin` interface and can be placed
    under `analyzers.plugins`. The extractor will auto-discover and register
    found plugins, allowing easy addition of new language support.
    """

    def __init__(self, project_dir: str, args: Optional[object] = None):
        self.project_dir = Path(project_dir)
        self.args = args
        # extension -> list[LanguagePlugin]
        self._registry: Dict[str, List[LanguagePlugin]] = {}
        self._plugins: List[LanguagePlugin] = []
        self._load_plugins()

    def _load_plugins(self) -> None:
        try:
            import analyzers.plugins as plugins_pkg
        except Exception:
            return

        for finder, name, ispkg in pkgutil.iter_modules(plugins_pkg.__path__):
            modname = f"{plugins_pkg.__name__}.{name}"
            try:
                mod = importlib.import_module(modname)
                plugin = None
                if hasattr(mod, "get_plugin"):
                    plugin = mod.get_plugin()
                elif hasattr(mod, "plugin"):
                    plugin = getattr(mod, "plugin")
                elif hasattr(mod, "Plugin"):
                    plugin = getattr(mod, "Plugin")()
                if plugin and isinstance(plugin, LanguagePlugin):
                    self.register_plugin(plugin)
            except Exception:
                # keep discovery robust
                continue

    def register_plugin(self, plugin: LanguagePlugin) -> None:
        self._plugins.append(plugin)
        for ext in plugin.file_extensions():
            ext = ext.lstrip('.')
            self._registry.setdefault(ext, []).append(plugin)

    def populate(self, ctx: DSLContext) -> None:
        for module in ctx.modules:
            fpath = self.project_dir / module.filepath
            if not fpath.exists():
                continue
            try:
                content = fpath.read_text(encoding="utf-8", errors="replace")
            except Exception:
                content = ""

            ext = Path(module.filepath).suffix.lstrip('.')

            candidates = list(self._registry.get(ext, []))
            chosen: Optional[LanguagePlugin] = None

            if candidates:
                best_score = -1.0
                for p in candidates:
                    try:
                        score = p.detect(content, fpath)
                    except Exception:
                        score = 0.0
                    if score > best_score:
                        best_score = score
                        chosen = p
            else:
                # Fallback: ask all plugins for a detection score
                best_score = 0.0
                for p in self._plugins:
                    try:
                        score = p.detect(content, fpath)
                    except Exception:
                        score = 0.0
                    if score > best_score:
                        best_score = score
                        chosen = p

            if chosen:
                try:
                    chosen.extract_symbols(module, self.project_dir)
                except Exception:
                    # keep extraction robust
                    continue
