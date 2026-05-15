import * as childProcess from "node:child_process";
import * as fs from "node:fs";
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

async function findCtxpackScript(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("ctxpack");
  const configuredPath = config.get<string>("cliPath", "").trim();
  if (configuredPath) {
    if (fs.existsSync(configuredPath)) {
      return configuredPath;
    }

    void vscode.window.showWarningMessage(
      `CtxPack: configured cliPath was not found: ${configuredPath}`
    );
    return undefined;
  }

  const workspaceRoot = resolveWorkspaceRoot();
  if (workspaceRoot) {
    const workspaceScript = path.join(workspaceRoot, "ctxpack.py");
    if (fs.existsSync(workspaceScript)) {
      return workspaceScript;
    }
  }

  const extensionScript = path.resolve(__dirname, "..", "..", "ctxpack.py");
  if (fs.existsSync(extensionScript)) {
    return extensionScript;
  }

  void vscode.window.showWarningMessage(
    "CtxPack: could not find ctxpack.py. Add it to the workspace root or configure ctxpack.cliPath."
  );
  return undefined;
}

async function resolvePythonCommand(): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration("ctxpack").get<string>("pythonPath", "python3").trim();
  const candidates = configured ? [configured] : [];

  for (const fallback of ["python3", "python", "py"]) {
    if (!candidates.includes(fallback)) {
      candidates.push(fallback);
    }
  }

  for (const candidate of candidates) {
    try {
      await execFile(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  void vscode.window.showWarningMessage(
    "CtxPack: no Python interpreter was found. Configure ctxpack.pythonPath if needed."
  );
  return undefined;
}

function execFile(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
        return;
      }

      resolve([stdout, stderr].filter(Boolean).join("\n").trim());
    });
  });
}

export interface RunCtxpackOptions {
  title: string;
  workspaceRoot: string;
  args: string[];
}

export async function runCtxpack(options: RunCtxpackOptions): Promise<string> {
  const [pythonCommand, scriptPath] = await Promise.all([resolvePythonCommand(), findCtxpackScript()]);
  if (!pythonCommand || !scriptPath) {
    throw new Error("CtxPack prerequisites were not resolved.");
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.title,
      cancellable: false,
    },
    async () => execFile(pythonCommand, [scriptPath, ...options.args], options.workspaceRoot)
  );
}

export async function promptForOptionalNow(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "CtxPack: Optional NOW field",
    prompt: "Current project focus for the semantic pack (leave empty to skip)",
    placeHolder: "Examples: extension UX, auth flow, semantic export",
    ignoreFocusOut: true,
  });
}
