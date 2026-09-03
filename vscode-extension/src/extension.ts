import * as vscode from "vscode";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { CtxInjectionSnapshot, registerChatParticipant } from "./ChatParticipant";
import {
  getWorkspaceDefaultTag,
  getWorkspaceRootOrWarn,
  promptForOptionalNow,
} from "./CliBridge";
import { ContextRingBuffer } from "./ContextRingBuffer";
import { createIpcServer, getSocketPath } from "./IpcServer";
import { buildPathContext, pickPath } from "./PathContextBuilder";
import {
  createPackignoreTemplate,
  createQueryPack,
  createReadablePack,
  createSemanticPack,
  CtxChatMode,
  getCtxChatModeLabel,
  listCtxChatModes,
} from "./WorkspacePackBuilder";

let statusBar: vscode.StatusBarItem | undefined;
let ipcServer: net.Server | undefined;
let socketPath: string | undefined;

function resolveWorkspaceRoot(context: vscode.ExtensionContext): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    return workspaceFolder.uri.fsPath;
  }
  return context.globalStorageUri.fsPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const config    = vscode.workspace.getConfiguration("ctxpack");
  const maxTokens = config.get<number>("maxTokens", 8000);
  const buffer    = new ContextRingBuffer(maxTokens);
  const workspaceRoot = resolveWorkspaceRoot(context);
  socketPath = getSocketPath(workspaceRoot);
  let lastInjectionSnapshot: CtxInjectionSnapshot | undefined;

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "ctxpack.status";
  context.subscriptions.push(statusBar);

  const updateStatusBar = (overrideText?: string): void => {
    if (!statusBar) { return; }
    statusBar.text    = overrideText ?? buildCompactStatusText(buffer, lastInjectionSnapshot);
    statusBar.tooltip = buildStatusTooltip(buffer, lastInjectionSnapshot);
    statusBar.show();
  };

  registerChatParticipant(context, buffer, (snapshot) => {
    lastInjectionSnapshot = snapshot;
    updateStatusBar();

    // Ensure the user always gets visual feedback for every buffer access state,
    // regardless of how quickly the internal state transitions happen.
    // setStatusBarMessage() has rendering priority over the permanent item and
    // auto-dismisses, making transient states (reading, correlating) visible even
    // when the permanent status bar hasn't re-rendered yet.
    switch (snapshot.status) {
      case "reading":
        vscode.window.setStatusBarMessage(
          "$(loading~spin) CtxPack: reading buffer...",
          4000
        );
        break;

      case "correlating":
        vscode.window.setStatusBarMessage(
          "$(loading~spin) CtxPack: correlating context...",
          4000
        );
        break;

      case "sent":
        if (snapshot.modeLabel === "Advisor") {
          // Advisor mode: show how many slots were analysed.
          const slotCount = buffer.listSlots().length;
          vscode.window.setStatusBarMessage(
            `$(database) CtxPack: ${slotCount} slot(s) analysed`,
            4000
          );
        } else if (snapshot.bufferAttached) {
          // Injection mode: show slots and tokens that were forwarded.
          vscode.window.setStatusBarMessage(
            `$(check) CtxPack: ${snapshot.usedTags.length} slot(s) · ~${snapshot.estimatedTokens} tokens injected`,
            5000
          );
        } else {
          vscode.window.setStatusBarMessage(
            "$(info) CtxPack: no slots attached to this request",
            4000
          );
        }
        break;

      case "error":
        vscode.window.setStatusBarMessage(
          `$(error) CtxPack: ${snapshot.errorMessage ?? "injection error"}`,
          6000
        );
        break;

      default:
        break;
    }
  });

  const ensurePackignoreForAnyCommand = (): void => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return; }
    try {
      createPackignoreTemplate(workspaceFolder.uri.fsPath);
    } catch {
      // Keep command execution flowing even if .packignore cannot be created.
    }
  };

  const registerCtxCommand = <T extends unknown[]>(
    commandId: string,
    handler: (...args: T) => Promise<void> | void
  ): vscode.Disposable =>
    vscode.commands.registerCommand(commandId, async (...args: T) => {
      ensurePackignoreForAnyCommand();
      await handler(...args);
    });

  const askToActivateTag = async (tag: string): Promise<void> => {
    const answer = await vscode.window.showQuickPick(
      [
        { label: "Yes", value: "yes" },
        { label: "No",  value: "no"  },
      ],
      {
        title: "CtxPack: use this slot in chat context?",
        placeHolder: `Choose whether '${tag}' should become active in dynamic context injection`,
      }
    );
    if (answer?.value !== "yes") { return; }
    buffer.setActiveTags([tag], "all");
    updateStatusBar();
    vscode.window.showInformationMessage(
      `CtxPack: dynamic chat context is now scoped to '${tag}' for ask, plan, and agent.`
    );
  };

  const pickTargetModes = async (): Promise<CtxChatMode[] | undefined> => {
    const picked = await vscode.window.showQuickPick(
      [
        { label: "All modes", value: "all" },
        ...listCtxChatModes().map((mode) => ({ label: getCtxChatModeLabel(mode), value: mode })),
      ],
      {
        title: "CtxPack: choose which chat modes should use this scope",
        placeHolder: "Apply the current slot scope to Ask, Plan, Agent, or all modes",
        canPickMany: true,
      }
    );
    if (!picked) { return undefined; }
    if (picked.some((item) => item.value === "all")) { return listCtxChatModes(); }
    return picked.map((item) => item.value as CtxChatMode);
  };

  const pickSlots = async (
    title: string,
    placeHolder: string
  ): Promise<string[] | undefined> => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return undefined;
    }
    const activeTags = new Set(buffer.listActiveTags("ask"));
    const picks = await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label:       slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail:      new Date(slot.timestamp).toLocaleString(),
        picked:      activeTags.has(slot.tag),
      })),
      { title, placeHolder, canPickMany: true }
    );
    return picks?.map((item) => item.label);
  };

  const handlePathPush = async (resource?: vscode.Uri): Promise<void> => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) { return; }

    const target = await pickPath(resource);
    if (!target) { return; }

    const maxFiles     = vscode.workspace.getConfiguration("ctxpack").get<number>("maxFilesPerPathPush", 25);
    const maxFileBytes = vscode.workspace.getConfiguration("ctxpack").get<number>("maxFileBytesPerPathPush", 200000);

    try {
      const built = buildPathContext(target.fsPath, workspaceRoot, { maxFiles, maxFileBytes });
      buffer.push(built.tag, built.content);
      updateStatusBar();
      vscode.window.showInformationMessage(`CtxPack: path '${built.tag}' sent to the buffer.`);
      await askToActivateTag(built.tag);
    } catch (error) {
      vscode.window.showErrorMessage(`CtxPack: failed to read path. ${String(error)}`);
    }
  };

  ipcServer = createIpcServer(socketPath, (tag, content) => {
    buffer.push(tag, content);
    updateStatusBar();
  });

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (ipcServer) {
        ipcServer.close();
        ipcServer = undefined;
      }
      if (process.platform !== "win32" && socketPath) {
        try {
          if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
          }
        } catch {
          // Ignore socket cleanup errors during shutdown.
        }
      }
    })
  );

  // ── Commands ──────────────────────────────────────────────────────────────

  const pushDisposable = registerCtxCommand("ctxpack.push", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("CtxPack: no active editor available for push.");
      return;
    }

    const selected = editor.document.getText(editor.selection);
    const content  = selected.trim().length > 0 ? selected : editor.document.getText();

    if (!content.trim()) {
      vscode.window.showWarningMessage("CtxPack: no content to send to the buffer.");
      return;
    }

    const defaultTag = path.basename(editor.document.fileName);
    const tag = await vscode.window.showInputBox({
      title:         "CtxPack: Tag for this context",
      prompt:        "Tag for this context (e.g. auth-module)",
      value:         defaultTag,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : "Enter a non-empty tag."),
    });

    if (tag === undefined) { return; }

    buffer.push(tag, content);
    updateStatusBar();
    vscode.window.showInformationMessage(
      `CtxPack: context '${tag.trim() || defaultTag}' sent to the buffer.`
    );
    await askToActivateTag(tag.trim() || defaultTag);
  });

  const pushFileDisposable = registerCtxCommand("ctxpack.pushFile", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("CtxPack: no active editor available for pushFile.");
      return;
    }

    const content = editor.document.getText();
    if (!content.trim()) {
      vscode.window.showWarningMessage("CtxPack: file is empty, nothing to send.");
      return;
    }

    const tag = path.basename(editor.document.fileName);
    buffer.push(tag, content);
    updateStatusBar();
    vscode.window.showInformationMessage(`CtxPack: file '${tag}' sent to the buffer.`);
    await askToActivateTag(tag);
  });

  const pushPathDisposable           = registerCtxCommand("ctxpack.pushPath",           handlePathPush);
  const pushExplorerFileDisposable   = registerCtxCommand("ctxpack.pushExplorerFile",   handlePathPush);
  const pushExplorerFolderDisposable = registerCtxCommand("ctxpack.pushExplorerFolder", handlePathPush);

  const clearDisposable = registerCtxCommand("ctxpack.clear", () => {
    buffer.clear();
    updateStatusBar("$(database) ctx: buffer cleared");
    vscode.window.showInformationMessage("CtxPack: buffer cleared.");
  });

  const selectActiveSlotsDisposable = registerCtxCommand(
    "ctxpack.selectActiveSlots",
    async () => {
      const tags = await pickSlots(
        "CtxPack: choose active slots for dynamic context",
        "Selected slots will be injected on every chat iteration until you change them"
      );
      if (tags === undefined) { return; }

      const modes = await pickTargetModes();
      if (!modes) { return; }

      if (tags.length === 0) {
        for (const mode of modes) { buffer.clearActiveTags(mode); }
        updateStatusBar();
        vscode.window.showInformationMessage(
          "CtxPack: selected mode(s) now use all buffered slots."
        );
        return;
      }

      for (const mode of modes) { buffer.setActiveTags(tags, mode); }
      updateStatusBar();
      vscode.window.showInformationMessage(
        `CtxPack: updated ${modes.length} mode(s) to use ${tags.length} selected slot(s).`
      );
    }
  );

  const clearActiveSelectionDisposable = registerCtxCommand(
    "ctxpack.clearActiveSelection",
    () => {
      buffer.clearActiveTags("all");
      updateStatusBar();
      vscode.window.showInformationMessage(
        "CtxPack: active slot filter cleared for ask, plan, and agent."
      );
    }
  );

  const statusDisposable = registerCtxCommand("ctxpack.status", async () => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return;
    }
    await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label:       slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail:      new Date(slot.timestamp).toLocaleString(),
      })),
      {
        title:       `CtxPack: ${buffer.status()}`,
        placeHolder: "Slots currently in the buffer",
        canPickMany: false,
      }
    );
  });

  const inspectSlotDisposable = registerCtxCommand("ctxpack.inspectSlot", async () => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label:       slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail:      new Date(slot.timestamp).toLocaleString(),
      })),
      {
        title:       "CtxPack: inspect buffered slot",
        placeHolder: "Select a slot to preview in a temporary editor",
      }
    );
    if (!picked) { return; }

    const slot = buffer.findByTag(picked.label);
    if (!slot) {
      vscode.window.showWarningMessage(`CtxPack: slot '${picked.label}' is no longer available.`);
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content:
        `# ${slot.tag}\n\n` +
        `Estimated tokens: ~${slot.tokenEstimate}\n` +
        `Captured: ${new Date(slot.timestamp).toLocaleString()}\n\n---\n\n${slot.content}`,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  });

  const removeSlotDisposable = registerCtxCommand("ctxpack.removeSlot", async () => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label:       slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail:      new Date(slot.timestamp).toLocaleString(),
      })),
      {
        title:       "CtxPack: remove buffered slot",
        placeHolder: "Select a slot to remove from the current session buffer",
      }
    );
    if (!picked) { return; }

    if (!buffer.removeByTag(picked.label)) {
      vscode.window.showWarningMessage(`CtxPack: slot '${picked.label}' is no longer available.`);
      return;
    }

    updateStatusBar();
    vscode.window.showInformationMessage(`CtxPack: removed '${picked.label}' from the buffer.`);
  });

  const slotScopeStatusDisposable = registerCtxCommand("ctxpack.slotScopeStatus", () => {
    const summaries = buffer.getModeScopeSummary();
    const message = listCtxChatModes()
      .map(
        (mode) =>
          `${getCtxChatModeLabel(mode)}: ${buffer.hasActiveSelection(mode) ? summaries[mode] : "all buffered slots"}`
      )
      .join(" | ");
    vscode.window.showInformationMessage(
      `CtxPack: dynamic context scope by mode → ${message}.`
    );
  });

  const exportSemanticDisposable = registerCtxCommand("ctxpack.exportSemantic", async () => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) { return; }

    const nowText = await promptForOptionalNow();
    if (nowText === undefined) { return; }

    try {
      const built = await vscode.window.withProgress(
        {
          location:    vscode.ProgressLocation.Notification,
          title:       "CtxPack: generating semantic pack",
          cancellable: false,
        },
        async () => createSemanticPack(workspaceRoot, { nowText: nowText.trim() || undefined })
      );
      const doc = await vscode.workspace.openTextDocument(built.outputPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage("CtxPack: semantic pack generated.");
    } catch (error) {
      vscode.window.showErrorMessage(`CtxPack: failed to generate semantic pack. ${String(error)}`);
    }
  });

  const exportReadableDisposable = registerCtxCommand("ctxpack.exportReadable", async () => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) { return; }

    try {
      const built = await vscode.window.withProgress(
        {
          location:    vscode.ProgressLocation.Notification,
          title:       "CtxPack: generating readable project pack",
          cancellable: false,
        },
        async () => createReadablePack(workspaceRoot)
      );
      const doc = await vscode.workspace.openTextDocument(built.outputPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage("CtxPack: readable pack generated.");
    } catch (error) {
      vscode.window.showErrorMessage(`CtxPack: failed to generate readable pack. ${String(error)}`);
    }
  });

  const pushWorkspaceSemanticDisposable = registerCtxCommand(
    "ctxpack.pushWorkspaceSemantic",
    async () => {
      const workspaceRoot = getWorkspaceRootOrWarn();
      if (!workspaceRoot) { return; }

      const defaultTag = `${getWorkspaceDefaultTag(workspaceRoot)}-semantic`;
      const tag = await vscode.window.showInputBox({
        title:          "CtxPack: tag for workspace semantic context",
        prompt:         "Buffer tag for the generated semantic project context",
        value:          defaultTag,
        ignoreFocusOut: true,
        validateInput:  (value) => (value.trim() ? undefined : "Enter a non-empty tag."),
      });
      if (tag === undefined) { return; }

      const nowText = await promptForOptionalNow();
      if (nowText === undefined) { return; }

      try {
        const built = await vscode.window.withProgress(
          {
            location:    vscode.ProgressLocation.Notification,
            title:       "CtxPack: generating and pushing semantic pack",
            cancellable: false,
          },
          async () => createSemanticPack(workspaceRoot, { nowText: nowText.trim() || undefined })
        );
        buffer.push(tag.trim() || defaultTag, built.content);
        updateStatusBar();
        vscode.window.showInformationMessage(
          `CtxPack: workspace semantic context pushed as '${tag.trim() || defaultTag}'.`
        );
        await askToActivateTag(tag.trim() || defaultTag);
      } catch (error) {
        vscode.window.showErrorMessage(
          `CtxPack: failed to push semantic pack. ${String(error)}`
        );
      }
    }
  );

  const queryWorkspaceDisposable = registerCtxCommand(
    "ctxpack.queryWorkspace",
    async () => {
      const workspaceRoot = getWorkspaceRootOrWarn();
      if (!workspaceRoot) { return; }

      const query = await vscode.window.showInputBox({
        title:          "CtxPack: Query workspace",
        prompt:         "Ask for context about a file, symbol, or topic instead of dumping the whole workspace",
        placeHolder:    "e.g. how does authentication work?",
        ignoreFocusOut: true,
        validateInput:  (value) => (value.trim() ? undefined : "Enter a non-empty query."),
      });
      if (!query?.trim()) { return; }

      const slug = query.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 30) || "query";
      const defaultTag = `${getWorkspaceDefaultTag(workspaceRoot)}-query-${slug}`;

      try {
        const built = await vscode.window.withProgress(
          {
            location:    vscode.ProgressLocation.Notification,
            title:       "CtxPack: ranking workspace context for your query",
            cancellable: false,
          },
          async () => createQueryPack(workspaceRoot, query.trim())
        );

        if (built.fileCount === 0) {
          vscode.window.showWarningMessage(
            "CtxPack: no relevant modules found for that query. Try different wording."
          );
          return;
        }

        buffer.push(defaultTag, built.content);
        updateStatusBar();
        vscode.window.showInformationMessage(
          `CtxPack: query pushed ${built.fileCount} module(s) as '${defaultTag}'.`
        );
        await askToActivateTag(defaultTag);
      } catch (error) {
        vscode.window.showErrorMessage(`CtxPack: failed to run query. ${String(error)}`);
      }
    }
  );

  const createPackignoreDisposable = registerCtxCommand(
    "ctxpack.createPackignore",
    async () => {
      const workspaceRoot = getWorkspaceRootOrWarn();
      if (!workspaceRoot) { return; }

      try {
        const built = await vscode.window.withProgress(
          {
            location:    vscode.ProgressLocation.Notification,
            title:       "CtxPack: creating .packignore template",
            cancellable: false,
          },
          async () => createPackignoreTemplate(workspaceRoot)
        );
        const doc = await vscode.workspace.openTextDocument(built.outputPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage("CtxPack: .packignore template is ready.");
      } catch (error) {
        vscode.window.showErrorMessage(`CtxPack: failed to create .packignore. ${String(error)}`);
      }
    }
  );

  const wizardDisposable = registerCtxCommand("ctxpack.wizard", async () => {
    const action = await vscode.window.showQuickPick(
      [
        { label: "Push selection",                            value: "push"                  },
        { label: "Push entire file",                          value: "pushFile"              },
        { label: "Push file or directory",                    value: "pushPath"              },
        { label: "Choose active slots for dynamic context",   value: "selectActiveSlots"     },
        { label: "Show current dynamic context scope",        value: "slotScopeStatus"       },
        { label: "Generate semantic pack and push",           value: "pushWorkspaceSemantic" },
        { label: "Query workspace and push targeted context", value: "queryWorkspace"        },
        { label: "Generate semantic project pack",            value: "exportSemantic"        },
        { label: "Generate readable project pack",            value: "exportReadable"        },
        { label: "Inspect buffered slot",                     value: "inspectSlot"           },
        { label: "Remove buffered slot",                      value: "removeSlot"            },
        { label: "Clear active slot filter",                  value: "clearActiveSelection"  },
        { label: "Clear entire buffer",                       value: "clear"                 },
      ],
      { title: "CtxPack wizard", placeHolder: "Choose the next context action" }
    );
    if (!action) { return; }
    await vscode.commands.executeCommand(`ctxpack.${action.value}`);
  });

  context.subscriptions.push(
    pushDisposable,
    pushFileDisposable,
    pushPathDisposable,
    pushExplorerFileDisposable,
    pushExplorerFolderDisposable,
    clearDisposable,
    selectActiveSlotsDisposable,
    clearActiveSelectionDisposable,
    statusDisposable,
    inspectSlotDisposable,
    removeSlotDisposable,
    slotScopeStatusDisposable,
    exportSemanticDisposable,
    exportReadableDisposable,
    pushWorkspaceSemanticDisposable,
    queryWorkspaceDisposable,
    createPackignoreDisposable,
    wizardDisposable
  );

  updateStatusBar();
}

export function deactivate(): void {
  if (ipcServer) {
    ipcServer.close();
    ipcServer = undefined;
  }
  if (process.platform !== "win32" && socketPath) {
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // Ignore socket cleanup errors during shutdown.
    }
  }
  if (statusBar) {
    statusBar.dispose();
    statusBar = undefined;
  }
}

// ---------------------------------------------------------------------------
// Status bar builders
// ---------------------------------------------------------------------------

function formatInjectionSuffix(snapshot: CtxInjectionSnapshot | undefined): string {
  if (!snapshot)                          { return "📦"; }
  if (snapshot.status === "error")        { return "❌"; }
  if (snapshot.status === "reading")      { return "⏳"; }
  if (snapshot.status === "correlating")  { return "🔗"; }
  if (snapshot.status === "sent") {
    if (snapshot.modeLabel === "Advisor") { return "🔍"; }
    return snapshot.bufferAttached        ? "✅" : "➡️";
  }
  return "📦";
}

function buildCompactStatusText(
  buffer: ContextRingBuffer,
  snapshot: CtxInjectionSnapshot | undefined
): string {
  const slots   = buffer.listSlots().length;
  const tokenK  = (buffer.totalTokenEstimate() / 1000).toFixed(1);
  const badge   = formatInjectionSuffix(snapshot);
  return `$(database) ctx ${slots}s ~${tokenK}k ${badge}`;
}

function buildStatusTooltip(
  buffer: ContextRingBuffer,
  snapshot: CtxInjectionSnapshot | undefined
): string {
  const lines: string[] = [`CtxPack status: ${buffer.status()}`];

  if (!snapshot) {
    lines.push("Last operation: none yet in this session.");
    return lines.join("\n");
  }

  lines.push(`Last mode: ${snapshot.modeLabel}`);
  lines.push(`Last scope: ${snapshot.scopeLabel}`);

  if (snapshot.modeLabel === "Advisor") {
    // Advisor mode tooltip — no injection stats needed.
    const corrSummary = snapshot.correlatedSlots
      .map((e) => `${e.tag} (${Math.round(e.score * 100)}%)`)
      .join(", ");
    lines.push(`Correlated slots: ${corrSummary || "none"}`);
  } else {
    lines.push(`Used slots (${snapshot.usedTags.length}): ${snapshot.usedTags.join(", ") || "none"}`);
    lines.push(`Omitted slots (${snapshot.omittedTags.length}): ${snapshot.omittedTags.join(", ") || "none"}`);
    const corrSummary = snapshot.correlatedSlots
      .map((e) => `${e.tag} (${Math.round(e.score * 100)}%)`)
      .join(", ");
    lines.push(`Correlated: ${corrSummary || "none"}`);
    lines.push(`Context tokens: ~${snapshot.estimatedTokens} / budget ~${snapshot.tokenBudget}`);
  }

  lines.push("");

  switch (snapshot.status) {
    case "sent":
      if (snapshot.modeLabel === "Advisor") {
        lines.push("🔍 ADVISOR — buffer analysed, no injection.");
      } else if (snapshot.bufferAttached) {
        lines.push("✅ INJECTION CONFIRMED");
        lines.push(`${snapshot.usedTags.length} slot(s) forwarded to the model.`);
      } else {
        lines.push("ℹ️ SENT WITHOUT BUFFER ATTACHMENT");
        lines.push("No slots were attached (empty scope or budget constraints).");
      }
      break;
    case "error":
      lines.push("❌ OPERATION FAILED");
      lines.push(`Error: ${snapshot.errorMessage ?? "unknown"}`);
      break;
    case "reading":
      lines.push("⏳ Reading buffered slots...");
      break;
    case "correlating":
      lines.push("🔗 Correlating prompt with buffered slots...");
      break;
    default:
      lines.push("📦 Buffer ready for injection.");
      break;
  }

  return lines.join("\n");
}
