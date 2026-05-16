# Changelog

All notable changes to this extension will be documented in this file.

## 0.1.13

- Removed the requirement to use `@ctx` as an explicit prompt signal in the extension UX language; context injection is now described and handled as dynamic chat context.
- Updated command labels, wizard actions, and scope/status messages to use dynamic context terminology instead of `@ctx` wording.
- Added visual context-read telemetry during response generation with explicit phases: reading buffered slots and correlating prompt intent.
- Added an in-chat slot-correlation table that shows which buffered slots most overlap with the current prompt and which terms were matched.
- Expanded status bar tooltip telemetry with correlated-slot summaries to make context grounding easier to verify.

## 0.1.12

- Reduced participant request stalls by increasing request timeout windows and retrying without explicit tools when a tool-heavy request times out.
- Updated fallback mode behavior to default to agentic intent when metadata is unavailable and no explicit ask-only signal is detected.
- Reduced explicit tool forwarding payloads (mode-aware limits) to lower latency and avoid provider-side overload in ambiguous mode scenarios.
- Expanded mode metadata extraction with additional candidate fields used by different chat provider payloads.

## 0.1.11

- Improved fallback mode behavior to infer effective intent dynamically (Ask/Plan/Agent) from request signals, including explicit differentiation between `Set Agent` and `Pick Model` flows.
- Updated `@ctx` reporting to show inferred effective behavior when mode metadata is unavailable.
- Added a command wrapper so every extension command now ensures `.packignore` exists in the active workspace.
- Expanded the default `.packignore` template with broader conventions for dependency folders, build outputs, caches, logs, lockfiles, secret artifacts, and OS/editor metadata.

## 0.1.10

- Improved `@ctx` chat mode detection by checking request and chat context metadata before falling back.
- Fixed misleading mode fallback behavior: when mode metadata is unavailable, the report now shows `Auto (mode metadata unavailable)` and avoids forcing Ask-mode behavior.
- Added tool forwarding guardrails to avoid provider limits by capping forwarded tools to a safe ceiling.
- Added automatic retry when the provider rejects a request due to tool count limits, falling back to a model-managed tool set.
- Improved `CtxPack injection report` formatting and error message spacing to avoid concatenated lines in chat output.

## 0.1.9

- Fixed chat mode tool forwarding logic to be dynamically responsive to user mode selection.
- Added `shouldForwardToolsForMode()` function to determine tool availability per mode: Agent and Ask modes now receive tools, while Plan mode remains read-only.
- Tools are now properly available in Ask mode for natural AI use (file operations, searches), fixing previous limitation where Ask mode had no tool access.
- Improved mode detection to respect VS Code's current chat mode setting in real-time.

## 0.1.8

- Added an explicit `@ctx` empty-buffer onboarding response so users are guided instead of getting a silent no-context flow.
- The participant now teaches the required steps to make CtxPack work: push slots, optionally scope slots, then run `@ctx` again.
- Added a quick-start reminder for `CtxPack: Open context workflow wizard` directly in chat when no slots are available.

## 0.1.7

- Added a defensive timeout for participant model calls to avoid indefinite `Evaluating` states.
- Restricted forwarded tools to Agent mode to reduce non-agent request stalls.
- Added global active-slot routing so any selected slots are consistently injected across Ask, Plan, and Agent modes.

## 0.1.6

- Fixed a participant crash path where missing `request.model` metadata could still surface as `Failed to query the language model` when using `@ctx`.
- Added an explicit in-chat `CtxPack injection report` showing mode, scope, used slots, omitted slots, and estimated context tokens per `@ctx` request.
- Added status bar and tooltip telemetry for the last `@ctx` injection so slot usage is visually verifiable outside the chat response.

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
