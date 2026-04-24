from pathlib import Path
from typing import Dict, List, Set

def deduplicate_modules(filepaths: List[str]) -> List[str]:
    """
    Groups files by stem and complementary extensions.
    Priority to implementation files.
    """
    grouped: Dict[str, List[Path]] = {}
    for filepath in filepaths:
        path = Path(filepath)
        # Handle files with no suffix or multiple suffixes gracefully if needed, but standard suffix is fine
        parent = path.parent
        stem = path.stem
        # Special case for .d.ts or .test.ts, we can just use stem roughly
        key = str(parent / stem)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(path)
        
    deduplicated = []
    
    # Priority for extensions
    IMPL_EXTS = ['.c', '.cpp', '.py', '.rs', '.go', '.ts', '.js', '.java', '.kt']
    HDR_EXTS = ['.h', '.hpp', '.pyi']
    
    for key, paths in grouped.items():
        if len(paths) == 1:
            deduplicated.append(str(paths[0]))
            continue
            
        impl_files = [p for p in paths if p.suffix in IMPL_EXTS]
        if impl_files:
            # Pick first impl file
            deduplicated.append(str(impl_files[0]))
        else:
            hdr_files = [p for p in paths if p.suffix in HDR_EXTS]
            if hdr_files:
                deduplicated.append(str(hdr_files[0]))
            else:
                # Just pick any if we don't know
                deduplicated.append(str(paths[0]))
                
    return deduplicated
