# Changelog

All notable changes to this extension will be documented in this file.

## 1.1.4

- **Blocked-tool recovery retry in agent mode**: When the Copilot host layer injects a meta-tool (`skill`, `task_complete`, `memory`, `vscode_askQuestions`) and the model attempts to call it, the participant now intercepts the resulting `ToolNotFound` error, injects a corrective instruction into the prompt, and retries once with the same curated tool list — instead of aborting the entire agent run and losing all progress.
- **Loop prevention guard**: A `hasAttemptedRecovery` flag ensures at most one recovery retry per agent call. If the retry also fails, the error surfaces to the user normally. Structurally impossible to loop.
- **Strengthened blocked-tool prompt constraint**: The model instruction for agent mode is now a `CRITICAL EXECUTION CONSTRAINT` that explicitly names the `ToolNotFound` consequence and calls out the "wrapping up" and "selecting a strategy" scenarios where models were most likely to mistakenly invoke `skill`.
- **Token budget cap raised (5 000 → 40 000 tokens)**: Context injection budget is now 30 % of the model's context window capped at 40 000 tokens. The previous cap of 5 000 caused constant "budget exceeded" slot omissions on large-context models (128 k+), where the budget should be ~38 400 tokens.
- **Badge token display formatted as `~Xk / ~Yk`**: The injection badge now shows token counts in compact kilobyte form (e.g. `~1.8k / ~38.4k`) instead of raw integers, keeping it scannable regardless of context window size.

## 1.1.3

- **Fixed `skill` / internal-tool errors in agent mode**: When the model runs inside a participant request it still sees Copilot-internal tools (`skill`, `task_complete`, `memory`, `vscode_askQuestions`) in its context. Forwarding them — or letting the model call them — fails with errors like `Skill "troubleshoot" not found`. These tools are now filtered out from the forwarded tool list **and** the model prompt explicitly tells the model not to invoke them, preventing the error entirely.

## 1.1.2

- **Fixed `@ctx /run` agent mode timeout causing suggestion-only responses**: The first-attempt timeout for `/run` was 90 s, which is too short for complex multi-step edits. It has been raised to 300 s so agent operations have sufficient time to complete before the retry path triggers.
- **Blocked the null-tool fallback in forced agent mode**: When a timeout occurred with explicit tools forwarded, the previous retry path called the model with provider-managed tools (`null`). This stripped the file-editing tools and caused the model to describe changes in text instead of applying them. In `/run` mode, a timeout now surfaces as an explicit error rather than silently degrading to Ask behaviour.
- **Strengthened agent mode instruction**: The `getModeBehaviorInstruction` text for agent mode now explicitly tells the model to apply changes with tools and not describe them, reducing suggestion-mode responses even on the first attempt.
- **Removed unnecessary `as any` cast**: The `forceAgent` path now assigns `modeResolution` with a properly typed literal instead of a cast.

## 1.1.1

- **Simplified participant command surface**: Removed the redundant `@ctx /ask` command path. `@ctx` now always injects buffered context and answers directly.
- **Added explicit action command**: Introduced `@ctx /run` to force agentic execution with tools while still using buffered context.
- **Advisor routing tightened**: Advisor guidance is now only used when the prompt is empty or the buffer is empty, preventing accidental detours from normal answer flows.
- Improved `@ctx` chat mode detection by checking request and chat context metadata before falling back.
- Fixed misleading mode fallback behavior: when mode metadata is unavailable, the report now shows `Auto (mode metadata unavailable)` and avoids forcing Ask-mode behavior.
- Added tool forwarding guardrails to avoid provider limits by capping forwarded tools to a safe ceiling.
- Added automatic retry when the provider rejects a request due to tool count limits, falling back to a model-managed tool set.
- Improved `CtxPack injection report` formatting and error message spacing to avoid concatenated lines in chat output.

## 0.1.18

- **Fixed empty buffer check ordering**: Buffer emptiness is now verified before printing the injection report, preventing confusing "Used slots: none" messages followed by the empty-buffer guide.
- **Eliminated unnecessary tool invocations**: Added explicit instruction to avoid redundant tool calls when the CtxPack buffer already contains sufficient context to answer the request.
- **Corrected default mode inference**: Changed fallback intent default from `agent` to `ask` mode, reducing unintended tool invocations on unclassified prompts and preventing tool loops.
- **Improved tool parameter handling**: Fixed tools parameter passing to use explicit empty list `[]` instead of `undefined` to prevent implicit provider-side tool injection, with `null` sentinel for model-managed fallback.
- **Enhanced status bar visual feedback**: Added `vscode.window.setStatusBarMessage()` to ensure visual status updates are immediately visible during async participant execution, preventing missed state transitions (reading → correlating → sent).
- **Clarified mode-specific tool availability**: Documented tool forwarding rules per mode: Agent and Ask receive full tool access, Plan mode remains read-only, and fallback mode blocks explicit tools to reduce payload and timeout risk.
- **Fixed auto-mode behavior instruction**: Corrected contradictory mode metadata unavailable scenarios by explicitly instructing the model to prioritize CtxPack buffer content before invoking tools.

## 0.1.17

- **Compacted session status in the status bar**: replaced long status text with a shorter, stable format (`ctx {slots}s ~{tokens}k {badge}`) to reduce truncation and improve visibility.
- **Deterministic buffer-use confirmation**: UI confirmation now relies on an internal injection-pipeline signal (`bufferAttached`) instead of lexical overlap or tool/event side effects.
- **Clear sent-state differentiation**: tooltip now distinguishes between `buffer attached` and `request sent without attachment` (for empty scope or budget constraints).
- **Telemetry consistency update**: status badges now map directly to injection phases (`📦`, `⏳`, `🔗`, `✅`, `❌`, `➡️`) for faster visual parsing.

## 0.1.16

- **Reinforced visual feedback for buffer injection**: Status bar now shows persistent, high-contrast indicators: `⏳ READING BUFFER`, `🔗 CORRELATING SLOTS`, `✅ BUFFER INJECTED (N slot(s))`, and `❌ BUFFER ERROR`.
- **Maintained @ctx as auxiliary command**: `@ctx` remains available for asking questions or getting help about CtxPack (not required for normal prompts).
- **Improved tooltip clarity**: Tooltip now explicitly states `✅ BUFFER ACCESS CONFIRMED` or `❌ BUFFER ACCESS FAILED` with detailed status for each injection phase.
- **Enhanced status bar persistence**: Status bar remains visible and updates throughout all injection phases (reading → correlating → sent), ensuring users always see buffer access confirmation.
- **Updated empty buffer guidance**: Guide now clarifies that `@ctx` is for CtxPack-specific help and suggestions, while normal prompts do NOT require any prefix and automatically inject buffered context.

## 0.1.15

- Removed remaining UX ambiguity around `@ctx`: the participant guidance now explicitly states that no `@ctx` prefix is needed after the participant is sticky.
- Added explicit chat-side confirmation line in each injection report: `Buffer access: confirmed`.
- Improved status bar confirmation for successful injections to show `buffer in use (N slot(s))` when context is actually attached.
- Added tooltip confirmation field: `Buffer access confirmed: yes|pending`.

## 0.1.14

- **Enhanced prompt validation**: Empty prompts are now rejected at the participant level with a clear error message, preventing silent failures and improving UX clarity.
- **Improved visual feedback**: Status bar indicators now use emoji icons (✅, ⏳, 🔗, ❌) instead of plain text for better visibility and clearer state distinction.
- **Added progress indicators**: All context processing phases now emit progress messages with visual indicators (⏳ reading, 🔗 correlating, ✅ complete, ❌ error).
- **Guaranteed callback delivery**: Injection snapshot callbacks are now guaranteed to fire in all code paths, including error scenarios, ensuring status bar always reflects current state.
- **Better error telemetry**: All error paths now emit progress updates and update injection snapshots, improving debugging and user awareness of failures.

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
