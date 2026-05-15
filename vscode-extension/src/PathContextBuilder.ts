import * as fs from "node:fs";
import * as path from "node:path";

export interface PathContextResult {
  tag: string;
  content: string;
}

export interface PickablePath {
  fsPath: string;
}

interface BuilderLimits {
  maxFiles: number;
  maxFileBytes: number;
}

function isTextBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

function relativeLabel(targetPath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, targetPath);
  return rel && !rel.startsWith("..") ? rel : path.basename(targetPath);
}

function walkDir(dirPath: string, collected: string[], limits: BuilderLimits): void {
  if (collected.length >= limits.maxFiles) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (collected.length >= limits.maxFiles) {
      return;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, collected, limits);
      continue;
    }

    if (entry.isFile()) {
      collected.push(fullPath);
    }
  }
}

function buildFileSection(filePath: string, workspaceRoot: string, limits: BuilderLimits): string | undefined {
  const stat = fs.statSync(filePath);
  if (stat.size > limits.maxFileBytes) {
    return `## ${relativeLabel(filePath, workspaceRoot)}\n[Skipped: file larger than ${limits.maxFileBytes} bytes]`;
  }

  const raw = fs.readFileSync(filePath);
  if (!isTextBuffer(raw)) {
    return `## ${relativeLabel(filePath, workspaceRoot)}\n[Skipped: binary file]`;
  }

  const content = raw.toString("utf8");
  const ext = path.extname(filePath).replace(/^\./, "") || "txt";
  const fence = "```";
  return `## ${relativeLabel(filePath, workspaceRoot)}\n\n${fence}${ext}\n${content}\n${fence}`;
}

export function buildPathContext(targetPath: string, workspaceRoot: string, limits: BuilderLimits): PathContextResult {
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    const section = buildFileSection(targetPath, workspaceRoot, limits);
    return {
      tag: relativeLabel(targetPath, workspaceRoot),
      content: section ?? `[CtxPack] Unable to read file: ${relativeLabel(targetPath, workspaceRoot)}`,
    };
  }

  const files: string[] = [];
  walkDir(targetPath, files, limits);
  const sections = files
    .map((filePath) => buildFileSection(filePath, workspaceRoot, limits))
    .filter((section): section is string => Boolean(section));

  const rel = relativeLabel(targetPath, workspaceRoot);
  const tree = files.map((filePath) => `- ${relativeLabel(filePath, workspaceRoot)}`).join("\n");
  const truncatedNotice = files.length >= limits.maxFiles ? "\n[CtxPack] Directory listing truncated by max file limit." : "";

  return {
    tag: rel,
    content: `# Directory Context: ${rel}\n\nFiles collected:\n${tree || "- (no files found)"}${truncatedNotice}\n\n---\n\n${sections.join("\n\n")}`,
  };
}

export async function pickPath(resource?: PickablePath): Promise<PickablePath | undefined> {
  if (resource) {
    return resource;
  }

  const vscode = await import("vscode");

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Use as CtxPack source",
  });

  return picked?.[0];
}
