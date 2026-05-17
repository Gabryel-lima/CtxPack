# CtxPack Context Cache for VS Code

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Gabryel-lima.ctxpack"><img src="https://img.shields.io/visual-studio-marketplace/v/Gabryel-lima.ctxpack?style=for-the-badge&label=Marketplace" alt="Marketplace Version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Gabryel-lima.ctxpack"><img src="https://img.shields.io/visual-studio-marketplace/d/Gabryel-lima.ctxpack?style=for-the-badge&label=Installs" alt="Marketplace Installs" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Gabryel-lima.ctxpack&ssr=false#review-details"><img src="https://img.shields.io/visual-studio-marketplace/r/Gabryel-lima.ctxpack?style=for-the-badge&label=Rating" alt="Marketplace Rating" /></a>
  <a href="https://github.com/Gabryel-lima/CtxPack"><img src="https://img.shields.io/github/stars/Gabryel-lima/CtxPack?style=for-the-badge" alt="GitHub stars" /></a>
  <a href="https://github.com/Gabryel-lima/CtxPack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Gabryel-lima/CtxPack?style=for-the-badge" alt="License" /></a>
</p>

CtxPack adds a FIFO context buffer to VS Code so you can accumulate only the context that matters before prompting Copilot Chat.

The extension and the Python script are complementary:

- The extension is for fast, session-scoped context inside VS Code.
- The extension now generates `.sem.ctx.md`, `.ctx.md`, and `.packignore` internally, so these project commands work even when Python is not installed.
- The Python script remains available for CLI and automation flows outside the extension.

## Features

- Push the current selection into a rolling context buffer.
- Push the entire active file with one command.
- Push a file or a directory as one reusable context slot.
- Inspect or remove buffered slots before prompting.
- Keep dynamic context locked to selected slots across multiple iterations.
- Apply selected active slots as the effective context source across Ask, Plan, and Agent.
- Inject accumulated context into Copilot Chat dynamically through the CtxPack participant.
- Show an in-chat injection report and status bar telemetry so slot usage is visually verifiable.
- Show explicit context-read phases with visual indicators (⏳ reading, 🔗 correlating) while the model is reasoning.
- Show a slot-correlation table that highlights which slots most overlap with the current prompt.
- Display real-time status bar feedback with emoji indicators (✅ BUFFER INJECTED, ⏳ READING BUFFER, 🔗 CORRELATING SLOTS, ❌ BUFFER ERROR, 📦 BUFFER READY).
- Show explicit buffer-access confirmation in UI: chat report includes `Buffer access: confirmed` and status bar shows `buffer in use (N slot(s))` after successful injection.
- Generate a semantic project pack from the extension and push it straight into the buffer.
- Generate `.sem.ctx.md`, `.ctx.md`, and `.packignore` directly from the extension.
- Accept context pushes from the CtxPack CLI through IPC.
- Evict old entries automatically with FIFO token-based limits.

## What The Extension Is For

Use the extension when your question depends on a small, intentional working set:

- a selected function, class, or code block
- one or two files you are actively editing
- a semantic project digest that you want to reuse for a few chat turns
- a curated combination of snippets gathered over several minutes

Use the Python script when you need a durable artifact outside the current VS Code chat session:

- export the whole project for another LLM
- generate a readable project snapshot
- generate a semantic DSL document to archive, share, or diff
- rebuild project-wide context without manually pushing files one by one

## Dynamic Context Injection

CtxPack now injects buffered context dynamically when using the CtxPack chat participant.

You no longer need to prepend prompts with `@ctx` for repeated injections.

When you do want explicit participant commands:

- `@ctx [your prompt]`: default path, injects context and answers.
- `@ctx /run [your action]`: agentic path, injects context and executes with tools.

The scope has two modes:

- Full-buffer mode: injects every slot currently stored.
- Active-slot mode: injects only the slots you selected, and keeps using that same subset on every iteration until you change it.

When active slots are selected, that selected subset is treated as the effective scope across Ask, Plan, and Agent.

Use dynamic injection when:

- you already pushed the exact snippets the answer depends on
- you want the same buffered context reused across multiple turns
- you chose one or more active slots and want that exact scope preserved across iterations
- you pushed a semantic workspace digest and now want questions answered against it
- you want to combine several small snippets into one prompt without pasting them manually

Avoid dynamic injection when:

- the question is generic and does not depend on repository context
- the current buffer is stale and still reflects an older task
- you only need to discuss what is already visible in the current editor selection
- you want a clean answer without unrelated buffered assumptions

Practical rule:

- If missing context would change the answer, keep context injection enabled.
- If context would only add noise, clear or narrow the active slots first.

## Copilot Chat Modes

CtxPack respects the current Copilot Chat mode and adapts tool availability accordingly:

- If VS Code does not expose mode metadata for a request, CtxPack marks it as `Auto (mode metadata unavailable)` and avoids forcing Ask-specific behavior.
- In `Auto`, CtxPack infers effective intent from request signals (for example, distinguishing `Set Agent` from `Pick Model`) so behavior remains dynamic.
- Tool forwarding is capped to a safe maximum to avoid provider-side tool-count rejections.
- If a provider still rejects a request because of tool count, CtxPack retries automatically with a model-managed tool set.
- Every extension command now ensures a workspace `.packignore` exists before execution.

### Agent Mode
- **Purpose**: Autonomous task execution (coding, refactoring, debugging)
- **Context**: CtxPack context is injected and used for tool-driven workflows
- **Tools**: ✅ Full tool access (file operations, searches, code generation)
- **Use case**: When you want the model to autonomously work with your buffered context

### Ask Mode
- **Purpose**: Direct answers and questions about code
- **Context**: CtxPack context is injected as grounded workspace evidence
- **Tools**: ✅ Tools available for natural use (e.g., file lookups, searches when helpful)
- **Use case**: When you want answers about code in your buffer, or quick clarifications

### Plan Mode
- **Purpose**: Strategic planning and architecture discussion
- **Context**: CtxPack context is injected for reference
- **Tools**: ❌ No tools (read-only mode for planning without side effects)
- **Use case**: When planning changes and want context without triggering tool execution

The active-slot selection (chosen via `CtxPack: Choose active slots for dynamic context`) applies consistently across all modes.

## Recommended Decision Flow

1. Ask yourself whether the prompt needs repository-specific context.
2. If yes, decide whether you need a small local slice or a project-wide digest.
3. For a small local slice, push a selection or file.
4. For a project-wide digest, run `Generate semantic pack and push to buffer`.
5. If needed, run `Choose active slots for dynamic context` so only the desired slots remain visible to the model across iterations.
6. Confirm scope before asking.
7. Use `Show current dynamic context scope` when you want to confirm what the next turn will inject.
8. Clear or prune the buffer when the topic changes.

## Commands

### How To Open The Command Palette

To run CtxPack commands inside VS Code:

1. Open the Command Palette with `Ctrl+Shift+P` on Linux/Windows or `Cmd+Shift+P` on macOS.
2. Type `CtxPack`.
3. Choose the action you want to run.

If you prefer a guided entry point, run `CtxPack: Open context workflow wizard` from that same palette.

- `CtxPack: Push selection to buffer`
  Pushes the current selection. If nothing is selected, it falls back to the full active file.
- `CtxPack: Push entire file to buffer`
  Pushes the whole active editor content as one slot.
- `CtxPack: Push file or directory to buffer`
  Pushes a selected file or directory as a reusable slot. This is also available from the Explorer context menu.
- `CtxPack: Choose active slots for dynamic context`
  Selects the exact slots that dynamic injection should use as the effective scope across Ask, Plan, and Agent.
- `CtxPack: Clear active slot filter`
  Returns injection to full-buffer mode.
- `CtxPack: View buffer status`
  Shows current slots, rough token estimates, and timestamps.
- `CtxPack: Show current dynamic context scope`
  Shows the current scope that the participant will inject.
- `CtxPack: Inspect buffered slot`
  Opens one buffered slot in a temporary preview editor so you can verify exactly what will be injected.
- `CtxPack: Remove buffered slot`
  Removes one stale or noisy slot without clearing the whole session.
- `CtxPack: Clear context buffer`
  Resets the whole session buffer.
- `CtxPack: Generate semantic project pack`
  Generates `<workspace>.sem.ctx.md` inside the extension and opens it.
- `CtxPack: Generate readable project pack`
  Generates `<workspace>.ctx.md` inside the extension and opens it.
- `CtxPack: Generate semantic pack and push to buffer`
  Generates a semantic pack inside the extension and feeds it directly into the session buffer for immediate context use.
- `CtxPack: Create .packignore template`
  Creates a `.packignore` template inside the extension and opens it.
- `CtxPack: Open context workflow wizard`
  Opens one quick menu with the main push, scope, export, and cleanup flows.

### Explorer Shortcuts

You can also right-click directly in the VS Code Explorer:

- right-click a file and run `CtxPack: Push this file to buffer`
- right-click a folder and run `CtxPack: Push this folder to buffer`

This is useful when you want dynamic context to stay tied to a specific path without opening the file first.

## Configuration

- `ctxpack.maxTokens`: Buffer token limit with FIFO eviction when exceeded.
- `ctxpack.maxFilesPerPathPush`: Maximum number of files collected when pushing a directory as one slot.
- `ctxpack.maxFileBytesPerPathPush`: Maximum size in bytes per file when pushing a file or directory path.
- `ctxpack.autoInjectOnPack`: Reserved for future automation. IPC pushes already update the buffer immediately.

## Zero-Friction Setup

The extension project commands no longer depend on Python or on a local `ctxpack.py` copy.

Requirements:

- VS Code with the CtxPack extension installed
- A workspace folder open when generating project-level packs

That means the practical split is:

- local chat context stays in the extension
- project-level exports also stay in the extension
- the Python CLI remains optional for external automation and IPC workflows

## How It Works

1. Push code from the active editor or from the CLI.
2. Build up a short-lived working set in the context buffer.
3. Optionally push a file or directory as one path-scoped slot.
4. Optionally generate a semantic project digest through the extension when you need workspace-level context.
5. Choose active slots when you want injection to reuse only a specific subset on every iteration.
6. Open Copilot Chat with the CtxPack participant and prompt normally.
7. Inspect, prune, or clear the buffer when the task changes.

If you need to force an autonomous execution flow instead of a direct answer, use:

```text
@ctx /run refactor this module and apply the patch
```

## Typical Workflow

```text
Select code -> CtxPack: Push selection to buffer -> Copilot Chat (CtxPack participant) -> your prompt
```

You can also move up one level to project context:

```text
CtxPack: Generate semantic pack and push to buffer -> Copilot Chat (CtxPack participant) -> summarize the architecture
```

You can also lock dynamic context to one file, one directory, or a chosen group of slots:

```text
Push selection -> Push file or directory -> Choose active slots for dynamic context -> continue this task
```

Or start from the Explorer without opening files first:

```text
Right-click file/folder -> Push to buffer -> Choose active slots for dynamic context -> continue this task
```

Or export a project artifact for other models and tools:

```text
CtxPack: Generate semantic project pack -> open .sem.ctx.md -> share/use outside VS Code
```

You can push the current file directly:

```text
CtxPack: Push entire file to buffer
```

And you can clean the buffer surgically before asking:

```text
CtxPack: Inspect buffered slot -> CtxPack: Remove buffered slot -> continue
```

If you want to confirm exactly what the next iteration will inject:

```text
CtxPack: Show current dynamic context scope
```

The visual above is intentionally simple: open the Command Palette, choose the CtxPack action, and then prompt normally.

## CLI Integration

CtxPack can still feed the extension buffer from the command line when you want to stay in a shell workflow:

```bash
python3 ctxpack.py . --semantic --push --push-tag current-state
```

Optional workspace override for socket resolution:

```bash
python3 ctxpack.py . --semantic --push --push-workspace /path/to/vscode/workspace
```

The new extension commands are thin wrappers around this same CLI capability. They do not replace the script; they expose it faster inside the editor.

## Why Use It

- Keep prompts focused instead of pasting giant files repeatedly.
- Reuse a curated context set across multiple Copilot turns.
- Persist a chosen subset of slots across multiple chat iterations.
- Decide explicitly when context should or should not be injected.
- Combine editor-driven and CLI-driven context collection.
- Export portable semantic or readable project docs without leaving VS Code.
- Stay within token budgets with predictable FIFO eviction.

## Troubleshooting

- `Generate semantic project pack` failed:
  Confirm that a workspace folder is open and the extension can read the project files.
- Dynamic context answered with stale assumptions:
  Inspect old slots, change the active slot selection, or clear the active filter before retrying.
- The buffer feels too noisy:
  Prefer one precise selection push over multiple full-file pushes, or lock dynamic context to selected slots only.
- The buffer is empty:
  Push a selection, push a file, or generate and push the semantic workspace pack before prompting.
- You see `Cannot have more than ... tools per request`:
  CtxPack now retries automatically with model-managed tool selection. If this persists, reduce loaded integrations/tools and retry.
- Chat stays in `Evaluating` for too long:
  The participant now uses a defensive timeout and should return an explicit failure message instead of waiting indefinitely.

## Links

- Marketplace: https://marketplace.visualstudio.com/items?itemName=Gabryel-lima.ctxpack
- Repository: https://github.com/Gabryel-lima/CtxPack
- Issues: https://github.com/Gabryel-lima/CtxPack/issues

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for version history.
