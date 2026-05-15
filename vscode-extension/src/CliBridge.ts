import * as path from "node:path";
import * as vscode from "vscode";

function resolveWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getWorkspaceRootOrWarn(): string | undefined {
  const workspaceRoot = resolveWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage(
      "CtxPack: open a folder or workspace before using project pack commands."
    );
    return undefined;
  }

  return workspaceRoot;
}

export function getWorkspaceDefaultTag(workspaceRoot: string): string {
  return path.basename(workspaceRoot);
}

export async function promptForOptionalNow(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "CtxPack: Optional NOW field",
    prompt: "Current project focus for the semantic pack (leave empty to skip)",
    placeHolder: "Examples: extension UX, auth flow, semantic export",
    ignoreFocusOut: true,
  });
}
