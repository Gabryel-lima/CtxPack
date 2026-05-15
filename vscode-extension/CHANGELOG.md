# Changelog

All notable changes to this extension will be documented in this file.

## 0.1.5

- Made `@ctx` context injection budget-aware so large semantic buffers are trimmed to the active model capacity instead of increasing the chance of interrupted requests.
- Strengthened the participant prompt so buffered semantic context is treated as primary workspace evidence and not silently ignored.
- Returned the underlying `ChatResult` metadata from the chat utility flow so tool-calling and request lifecycle handling remain intact.

## 0.1.4

- Replaced Python-dependent extension project commands with embedded generation for `.sem.ctx.md`, `.ctx.md`, and `.packignore`.
- Added mode-aware `@ctx` scoping so Ask, Plan, and Agent can keep different active slot selections.
- Updated extension documentation and tests to match the embedded project-pack workflow.

## 0.1.3

- Added a visual quick-flow asset showing the Command Palette to `@ctx` workflow.
- Updated documentation to reference the guided command flow and current VSIX version.

## 0.1.2

- Added persistent active-slot scoping so `@ctx` can reuse only selected slots across multiple iterations.
- Added commands to choose, clear, and inspect the current `@ctx` scope.
- Added `CtxPack: Push file or directory to buffer` with Explorer context menu support.
- Added explicit Explorer actions for files and folders plus documentation for Command Palette usage.
- Added a command palette wizard for the main context workflows.
- Added extension commands that wrap `ctxpack.py` project generation flows and documented the extension/script complement.

## 0.1.1

- Added Marketplace presentation metadata: icon, homepage, issue tracker, keywords, categories, and banner styling.
- Added a dedicated extension README with badges, usage guidance, and screenshots.
- Updated packaging assets for a richer Marketplace listing.

## 0.1.0

- Initial extension release for CtxPack Context Cache.
- Added ContextRingBuffer with FIFO token-based eviction.
- Added VS Code commands for push, pushFile, clear, and status.
- Added IPC server for socket/pipe pushes from ctxpack.py.
- Added chat participant `@ctx` for context injection in Copilot Chat.
- Added Windows fallback support via temporary file watcher.
