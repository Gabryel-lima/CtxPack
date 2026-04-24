from pathlib import Path

ROOT_MARKERS = {
    "git":    [".git/"],
    "cmake":  ["CMakeLists.txt"],
    "make":   ["Makefile", "GNUmakefile"],
    "python": ["pyproject.toml", "setup.py", "setup.cfg"],
    "node":   ["package.json"],
    "rust":   ["Cargo.toml"],
    "go":     ["go.mod"],
    "java":   ["pom.xml", "build.gradle"],
    "dotnet": ["*.csproj", "*.sln"],
    "ruby":   ["Gemfile"],
}

def detect_project_root(start_path: str) -> str:
    current = Path(start_path).resolve()
    
    while current.parent != current:
        for markers in ROOT_MARKERS.values():
            for marker in markers:
                marker = marker.rstrip('/')
                if (current / marker).exists():
                    return str(current)
        current = current.parent
        
    return start_path # fallback
