import * as vscode from "vscode";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { registerChatParticipant } from "./ChatParticipant";
import {
  getWorkspaceDefaultTag,
  getWorkspaceRootOrWarn,
  promptForOptionalNow,
  runCtxpack,
} from "./CliBridge";
import { ContextRingBuffer } from "./ContextRingBuffer";
import { createIpcServer, getSocketPath } from "./IpcServer";
import { buildPathContext, pickPath } from "./PathContextBuilder";

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
  const config = vscode.workspace.getConfiguration("ctxpack");
  const maxTokens = config.get<number>("maxTokens", 8000);
  const buffer = new ContextRingBuffer(maxTokens);
  const workspaceRoot = resolveWorkspaceRoot(context);
  socketPath = getSocketPath(workspaceRoot);
  registerChatParticipant(context, buffer);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "ctxpack.status";
  context.subscriptions.push(statusBar);

  const updateStatusBar = (overrideText?: string): void => {
    if (!statusBar) {
      return;
    }
    statusBar.text = overrideText ?? `$(database) ctx: ${buffer.status()}`;
    statusBar.show();
  };

  const askToActivateTag = async (tag: string): Promise<void> => {
    const answer = await vscode.window.showQuickPick(
      [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
      {
        title: "CtxPack: use this slot in @ctx?",
        placeHolder: `Choose whether '${tag}' should become active for chat injection`,
      }
    );

    if (answer?.value !== "yes") {
      return;
    }

    buffer.setActiveTags([tag]);
    updateStatusBar();
    vscode.window.showInformationMessage(`CtxPack: @ctx is now scoped to '${tag}'.`);
  };

  const pickSlots = async (title: string, placeHolder: string): Promise<string[] | undefined> => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return undefined;
    }

    const activeTags = new Set(buffer.listActiveTags());
    const picks = await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label: slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail: new Date(slot.timestamp).toLocaleString(),
        picked: activeTags.has(slot.tag),
      })),
      {
        title,
        placeHolder,
        canPickMany: true,
      }
    );

    return picks?.map((item) => item.label);
  };

  const handlePathPush = async (resource?: vscode.Uri): Promise<void> => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) {
      return;
    }

    const target = await pickPath(resource);
    if (!target) {
      return;
    }

    const maxFiles = vscode.workspace.getConfiguration("ctxpack").get<number>("maxFilesPerPathPush", 25);
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

  const pushDisposable = vscode.commands.registerCommand("ctxpack.push", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("CtxPack: no active editor available for push.");
      return;
    }

    const selected = editor.document.getText(editor.selection);
    const content = selected.trim().length > 0 ? selected : editor.document.getText();

    if (!content.trim()) {
      vscode.window.showWarningMessage("CtxPack: no content to send to the buffer.");
      return;
    }

    const defaultTag = path.basename(editor.document.fileName);
    const tag = await vscode.window.showInputBox({
      title: "CtxPack: Tag for this context",
      prompt: "Tag for this context (e.g. auth-module)",
      value: defaultTag,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return "Enter a non-empty tag.";
        }
        return undefined;
      },
    });

    if (tag === undefined) {
      return;
    }

    buffer.push(tag, content);
    updateStatusBar();
    vscode.window.showInformationMessage(`CtxPack: context '${tag.trim() || defaultTag}' sent to the buffer.`);
    await askToActivateTag(tag.trim() || defaultTag);
  });

  const pushFileDisposable = vscode.commands.registerCommand("ctxpack.pushFile", async () => {
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

  const pushPathDisposable = vscode.commands.registerCommand("ctxpack.pushPath", handlePathPush);
  const pushExplorerFileDisposable = vscode.commands.registerCommand("ctxpack.pushExplorerFile", handlePathPush);
  const pushExplorerFolderDisposable = vscode.commands.registerCommand("ctxpack.pushExplorerFolder", handlePathPush);

  const clearDisposable = vscode.commands.registerCommand("ctxpack.clear", () => {
    buffer.clear();
    updateStatusBar("$(database) ctx: buffer cleared");
    vscode.window.showInformationMessage("CtxPack: buffer cleared.");
  });

  const selectActiveSlotsDisposable = vscode.commands.registerCommand("ctxpack.selectActiveSlots", async () => {
    const tags = await pickSlots(
      "CtxPack: choose active slots for @ctx",
      "Selected slots will be injected on every @ctx iteration until you change them"
    );

    if (tags === undefined) {
      return;
    }

    if (tags.length === 0) {
      buffer.clearActiveTags();
      updateStatusBar();
      vscode.window.showInformationMessage("CtxPack: @ctx now uses all buffered slots.");
      return;
    }

    buffer.setActiveTags(tags);
    updateStatusBar();
    vscode.window.showInformationMessage(`CtxPack: @ctx now uses ${tags.length} selected slot(s).`);
  });

  const clearActiveSelectionDisposable = vscode.commands.registerCommand("ctxpack.clearActiveSelection", () => {
    buffer.clearActiveTags();
    updateStatusBar();
    vscode.window.showInformationMessage("CtxPack: active slot filter cleared. @ctx will use all buffered slots.");
  });

  const statusDisposable = vscode.commands.registerCommand("ctxpack.status", async () => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return;
    }

    const items: vscode.QuickPickItem[] = slots.map((slot) => ({
      label: slot.tag,
      description: `~${slot.tokenEstimate} tokens`,
      detail: new Date(slot.timestamp).toLocaleString(),
    }));

    await vscode.window.showQuickPick(items, {
      title: `CtxPack: ${buffer.status()}`,
      placeHolder: "Slots currently in the buffer",
      canPickMany: false,
    });
  });

  const inspectSlotDisposable = vscode.commands.registerCommand("ctxpack.inspectSlot", async () => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label: slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail: new Date(slot.timestamp).toLocaleString(),
      })),
      {
        title: "CtxPack: inspect buffered slot",
        placeHolder: "Select a slot to preview in a temporary editor",
      }
    );

    if (!picked) {
      return;
    }

    const slot = buffer.findByTag(picked.label);
    if (!slot) {
      vscode.window.showWarningMessage(`CtxPack: slot '${picked.label}' is no longer available.`);
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: `# ${slot.tag}\n\nEstimated tokens: ~${slot.tokenEstimate}\nCaptured: ${new Date(
        slot.timestamp
      ).toLocaleString()}\n\n---\n\n${slot.content}`,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  });

  const removeSlotDisposable = vscode.commands.registerCommand("ctxpack.removeSlot", async () => {
    const slots = buffer.listSlots();
    if (slots.length === 0) {
      vscode.window.showInformationMessage("CtxPack: buffer is empty.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      slots.map((slot) => ({
        label: slot.tag,
        description: `~${slot.tokenEstimate} tokens`,
        detail: new Date(slot.timestamp).toLocaleString(),
      })),
      {
        title: "CtxPack: remove buffered slot",
        placeHolder: "Select a slot to remove from the current session buffer",
      }
    );

    if (!picked) {
      return;
    }

    if (!buffer.removeByTag(picked.label)) {
      vscode.window.showWarningMessage(`CtxPack: slot '${picked.label}' is no longer available.`);
      return;
    }

    updateStatusBar();
    vscode.window.showInformationMessage(`CtxPack: removed '${picked.label}' from the buffer.`);
  });

  const slotScopeStatusDisposable = vscode.commands.registerCommand("ctxpack.slotScopeStatus", () => {
    const scope = buffer.chatScopeSummary();
    const mode = buffer.hasActiveSelection() ? "selected slots" : "full buffer";
    vscode.window.showInformationMessage(`CtxPack: @ctx scope is ${mode}: ${scope}.`);
  });

  const exportSemanticDisposable = vscode.commands.registerCommand("ctxpack.exportSemantic", async () => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) {
      return;
    }

    const nowText = await promptForOptionalNow();
    if (nowText === undefined) {
      return;
    }

    const args = [workspaceRoot, "--semantic-only"];
    if (nowText.trim()) {
      args.push("--now", nowText.trim());
    }

    try {
      await runCtxpack({
        title: "CtxPack: generating semantic pack",
        workspaceRoot,
        args,
      });

      const outputPath = path.join(workspaceRoot, `${path.basename(workspaceRoot)}.sem.ctx.md`);
      const doc = await vscode.workspace.openTextDocument(outputPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage("CtxPack: semantic pack generated.");
    } catch (error) {
      vscode.window.showErrorMessage(`CtxPack: failed to generate semantic pack. ${String(error)}`);
    }
  });

  const exportReadableDisposable = vscode.commands.registerCommand("ctxpack.exportReadable", async () => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) {
      return;
    }

    try {
      await runCtxpack({
        title: "CtxPack: generating readable project pack",
        workspaceRoot,
        args: [workspaceRoot, "--readable", "--no-semantic"],
      });

      const outputPath = path.join(workspaceRoot, `${path.basename(workspaceRoot)}.ctx.md`);
      const doc = await vscode.workspace.openTextDocument(outputPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage("CtxPack: readable pack generated.");
    } catch (error) {
      vscode.window.showErrorMessage(`CtxPack: failed to generate readable pack. ${String(error)}`);
    }
  });

  const pushWorkspaceSemanticDisposable = vscode.commands.registerCommand(
    "ctxpack.pushWorkspaceSemantic",
    async () => {
      const workspaceRoot = getWorkspaceRootOrWarn();
      if (!workspaceRoot) {
        return;
      }

      const defaultTag = `${getWorkspaceDefaultTag(workspaceRoot)}-semantic`;
      const tag = await vscode.window.showInputBox({
        title: "CtxPack: tag for workspace semantic context",
        prompt: "Buffer tag for the generated semantic project context",
        value: defaultTag,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : "Enter a non-empty tag."),
      });

      if (tag === undefined) {
        return;
      }

      const nowText = await promptForOptionalNow();
      if (nowText === undefined) {
        return;
      }

      const args = [
        workspaceRoot,
        "--semantic-only",
        "--push",
        "--push-workspace",
        workspaceRoot,
        "--push-tag",
        tag.trim() || defaultTag,
      ];

      if (nowText.trim()) {
        args.push("--now", nowText.trim());
      }

      try {
        await runCtxpack({
          title: "CtxPack: generating and pushing semantic pack",
          workspaceRoot,
          args,
        });

        updateStatusBar();
        vscode.window.showInformationMessage(
          `CtxPack: workspace semantic context pushed as '${tag.trim() || defaultTag}'.`
        );
        await askToActivateTag(tag.trim() || defaultTag);
      } catch (error) {
        vscode.window.showErrorMessage(`CtxPack: failed to push semantic pack. ${String(error)}`);
      }
    }
  );

  const createPackignoreDisposable = vscode.commands.registerCommand("ctxpack.createPackignore", async () => {
    const workspaceRoot = getWorkspaceRootOrWarn();
    if (!workspaceRoot) {
      return;
    }

    try {
      await runCtxpack({
        title: "CtxPack: creating .packignore template",
        workspaceRoot,
        args: [workspaceRoot, "--setup"],
      });

      const targetPath = path.join(workspaceRoot, ".packignore");
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage("CtxPack: .packignore template is ready.");
    } catch (error) {
      vscode.window.showErrorMessage(`CtxPack: failed to create .packignore. ${String(error)}`);
    }
  });

  const wizardDisposable = vscode.commands.registerCommand("ctxpack.wizard", async () => {
    const action = await vscode.window.showQuickPick(
      [
        { label: "Push selection", value: "push" },
        { label: "Push entire file", value: "pushFile" },
        { label: "Push file or directory", value: "pushPath" },
        { label: "Choose active slots for @ctx", value: "selectActiveSlots" },
        { label: "Show current @ctx scope", value: "slotScopeStatus" },
        { label: "Generate semantic pack and push", value: "pushWorkspaceSemantic" },
        { label: "Generate semantic project pack", value: "exportSemantic" },
        { label: "Generate readable project pack", value: "exportReadable" },
        { label: "Inspect buffered slot", value: "inspectSlot" },
        { label: "Remove buffered slot", value: "removeSlot" },
        { label: "Clear active slot filter", value: "clearActiveSelection" },
        { label: "Clear entire buffer", value: "clear" },
      ],
      {
        title: "CtxPack wizard",
        placeHolder: "Choose the next context action",
      }
    );

    if (!action) {
      return;
    }

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
