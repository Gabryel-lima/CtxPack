from abc import ABC, abstractmethod
from pathlib import Path
from typing import List


class LanguagePlugin(ABC):
    """Abstract interface that language plugins must implement.

    - `file_extensions()` -> list of extensions handled (without dot)
    - `detect(content, path)` -> heuristic score (0.0-1.0)
    - `extract_symbols(module, project_dir)` -> populate module.symbols
    """

    @abstractmethod
    def file_extensions(self) -> List[str]:
        raise NotImplementedError()

    def detect(self, content: str, path: Path) -> float:
        return 0.0

    @abstractmethod
    def extract_symbols(self, module, project_dir: Path) -> None:
        raise NotImplementedError()
