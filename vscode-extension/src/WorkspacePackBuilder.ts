import * as fs from "node:fs";
import * as path from "node:path";

export type CtxChatMode = "ask" | "plan" | "agent";
export type CtxResolvedChatMode = CtxChatMode | "auto";

export interface CtxChatModeResolution {
  mode: CtxResolvedChatMode;
  rawName?: string;
  source: "request" | "context" | "fallback";
}

export interface WorkspacePackOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  nowText?: string;
}

export interface WorkspacePackResult {
  outputPath: string;
  content: string;
  fileCount: number;
  truncated: boolean;
}

interface IgnoreMatcher {
  matches(relativePath: string, entryName: string, isDirectory: boolean): boolean;
}

interface WorkspaceFile {
  relativePath: string;
  content?: string;
  skippedReason?: string;
}

interface ModuleInfo {
  id: string;
  file: string;
  role: string;
  state: string;
  classes: string[];
  functions: string[];
  relations: Array<{ target: string; via: string }>;
  ctx: string;
}

interface TreeNode {
  children: Map<string, TreeNode>;
}

const DEFAULT_EXTENSIONS = new Set([
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cxx",
  "asm",
  "s",
  "py",
  "rs",
  "go",
  "js",
  "mjs",
  "ts",
  "jsx",
  "tsx",
  "php",
  "rb",
  "lua",
  "cs",
  "swift",
  "dart",
  "html",
  "css",
  "scss",
  "toml",
  "yaml",
  "yml",
  "json",
  "cmake",
  "mk",
  "md",
  "txt",
  "java",
  "kt",
  "sh",
  "bash",
]);

const HARDCODED_IGNORE_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "__pycache__",
  ".mypy_cache",
  "target",
  "build",
  "dist",
  "out",
  "bin",
  "obj",
  ".venv",
  "venv",
  "env",
  ".idea",
  ".vscode",
]);

const HARDCODED_IGNORE_FILE_SUFFIXES = [
  ".pyc",
  ".pyo",
  ".o",
  ".a",
  ".so",
  ".lib",
  ".dll",
  ".exe",
  ".bin",
  ".img",
  ".iso",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".mp3",
  ".mp4",
  ".wav",
  ".flac",
  ".zip",
  ".tar",
  ".gz",
  ".xz",
  ".7z",
  ".pdf",
  ".docx",
  ".xlsx",
  ".lock",
];

const DEFAULT_MAX_FILES = 250;
const DEFAULT_MAX_FILE_BYTES = 200_000;

const MODE_LABELS: Record<CtxChatMode, string> = {
  ask: "Ask",
  plan: "Plan",
  agent: "Agent",
};

export const DEFAULT_PACKIGNORE_TEMPLATE = `# .packignore - patterns to exclude from CtxPack exports
# Lines starting with # are comments.
# Pattern style: simple glob-like entries (* and ?) and path prefixes.

# Version control and editor metadata
.git
.svn
.hg
.idea
.vscode

# JavaScript/TypeScript ecosystems
node_modules
bower_components
jspm_packages
.pnpm-store
.npm
.yarn
.yarn/cache
.yarn/unplugged
.yarn/install-state.gz
.yarn/build-state.yml

# Python
__pycache__
.pytest_cache
.mypy_cache
.ruff_cache
.tox
.nox
.venv
venv
env
pip-wheel-metadata

# JVM/.NET/Go/Rust build outputs
.gradle
.mvn
target
out
build
bin
obj
TestResults
pkg

# Frontend framework outputs
dist
coverage
.next
.nuxt
.svelte-kit
.parcel-cache
.angular
.astro
.storybook-static

# Native/mobile/apple
DerivedData
Pods

# Infrastructure and deployment state
.terraform
*.tfstate
*.tfstate.*

# Caches, logs, and temporary files
.cache
tmp
temp
logs
*.log

# Environment and secrets
.env
.env.*
*.pem
*.key
*.p12
*.crt

# Lock files and dependency snapshots
*.lock
package-lock.json
yarn.lock
pnpm-lock.yaml
poetry.lock
Pipfile.lock
Cargo.lock

# Archives and binary bundles
*.zip
*.tar
*.gz
*.xz
*.7z
*.jar
*.war
*.ear

# Operating system artifacts
.DS_Store
Thumbs.db
`;

export function listCtxChatModes(): CtxChatMode[] {
  return ["ask", "plan", "agent"];
}

export function getCtxChatModeLabel(mode: CtxChatMode): string {
  return MODE_LABELS[mode];
}

export function resolveCtxChatMode(name: string | undefined): CtxChatMode {
  const normalized = (name ?? "").trim().toLowerCase();
  if (normalized.includes("agent") || normalized.includes("agente")) {
    return "agent";
  }
  if (normalized.includes("plan") || normalized.includes("plano")) {
    return "plan";
  }

  if (normalized.includes("ask") || normalized.includes("pergunta") || normalized.includes("question")) {
    return "ask";
  }

  return "ask";
}

export function resolveCtxChatModeFromRequest(requestLike: unknown, chatContextLike?: unknown): CtxChatModeResolution {
  const rawName = extractModeNameFromRequest(requestLike);
  if (rawName) {
    return {
      mode: resolveCtxChatMode(rawName),
      rawName,
      source: "request",
    };
  }

  const contextRawName = extractModeNameFromRequest(chatContextLike);
  if (contextRawName) {
    return {
      mode: resolveCtxChatMode(contextRawName),
      rawName: contextRawName,
      source: "context",
    };
  }

  return {
    mode: "auto",
    source: "fallback",
  };
}

export function getCtxChatModeDisplay(modeResolution: CtxChatModeResolution): string {
  if (modeResolution.mode === "auto") {
    return "Auto (mode metadata unavailable)";
  }

  const resolved = getCtxChatModeLabel(modeResolution.mode);
  if (modeResolution.source === "fallback") {
    return `Unknown (fallback: ${resolved})`;
  }

  if (modeResolution.source === "context") {
    return `${resolved} (inferred)`;
  }

  return resolved;
}

function extractModeNameFromRequest(requestLike: unknown): string | undefined {
  if (!isRecord(requestLike)) {
    return undefined;
  }

  const directCandidates: unknown[] = [
    readPath(requestLike, ["modeInstructions2", "name"]),
    readPath(requestLike, ["modeInstructions", "name"]),
    readPath(requestLike, ["modeInstruction", "name"]),
    readPath(requestLike, ["mode", "name"]),
    readPath(requestLike, ["chatMode", "name"]),
    readPath(requestLike, ["modeName"]),
    readPath(requestLike, ["mode"]),
    readPath(requestLike, ["chatMode"]),
  ];

  for (const candidate of directCandidates) {
    const text = asNonEmptyString(candidate);
    if (text) {
      return text;
    }
  }

  const inferredCandidates: unknown[] = [
    readPath(requestLike, ["modeInstructions2", "content"]),
    readPath(requestLike, ["modeInstructions", "content"]),
    readPath(requestLike, ["modeInstructions2"]),
    readPath(requestLike, ["modeInstructions"]),
  ];

  for (const candidate of inferredCandidates) {
    const text = asNonEmptyString(candidate);
    if (!text) {
      continue;
    }

    const inferred = inferModeKeyword(text);
    if (inferred) {
      return inferred;
    }
  }

  return undefined;
}

function inferModeKeyword(text: string): string | undefined {
  const normalized = text.toLowerCase();
  if (normalized.includes("agent") || normalized.includes("agente")) {
    return "agent";
  }
  if (normalized.includes("plan") || normalized.includes("plano")) {
    return "plan";
  }
  if (normalized.includes("ask") || normalized.includes("pergunta") || normalized.includes("question")) {
    return "ask";
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPath(source: Record<string, unknown>, pathParts: string[]): unknown {
  let current: unknown = source;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createPackignoreTemplate(workspaceRoot: string): WorkspacePackResult {
  const outputPath = path.join(workspaceRoot, ".packignore");
  if (!fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, DEFAULT_PACKIGNORE_TEMPLATE, "utf8");
  }

  const content = fs.readFileSync(outputPath, "utf8");
  return {
    outputPath,
    content,
    fileCount: 1,
    truncated: false,
  };
}

export function createReadablePack(workspaceRoot: string, options: WorkspacePackOptions = {}): WorkspacePackResult {
  const collected = collectWorkspaceFiles(workspaceRoot, options);
  const projectName = path.basename(workspaceRoot);
  const outputPath = path.join(workspaceRoot, `${projectName}.ctx.md`);
  const treeLines = buildTreeLines(collected.files.map((file) => file.relativePath));
  const sections = collected.files.map((file) => buildReadableSection(file)).join("\n\n");
  const content = [
    `# CtxPack Readable Pack: ${projectName}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    collected.truncated ? "> File collection truncated by the configured workspace export limit." : undefined,
    "",
    "## Directory Tree",
    "",
    "```text",
    treeLines || projectName,
    "```",
    "",
    "## Files",
    "",
    sections,
    "",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  fs.writeFileSync(outputPath, content, "utf8");
  return {
    outputPath,
    content,
    fileCount: collected.files.length,
    truncated: collected.truncated,
  };
}

export function createSemanticPack(workspaceRoot: string, options: WorkspacePackOptions = {}): WorkspacePackResult {
  const collected = collectWorkspaceFiles(workspaceRoot, options);
  const projectName = path.basename(workspaceRoot);
  const outputPath = path.join(workspaceRoot, `${projectName}.sem.ctx.md`);
  const modules = collected.files.map((file) => describeModule(file));
  const languages = new Set(modules.map((module) => guessLanguageFromPath(module.file)).filter(Boolean));
  const lines: string[] = [
    "<!-- DSL SEMANTIC: PRJ=project, DEP=dependencies, MOD=module, REL=module relations, CONV=conventions, DEC=design decisions, BUG=known issues, NOW=current focus, CTX=extra context -->",
    "",
    `PRJ:${projectName}|lang:${[...languages].join(",") || "Unknown"}`,
  ];

  if (options.nowText?.trim()) {
    lines.push(`NOW:${sanitizeInline(options.nowText.trim())}`);
  }

  for (const module of modules) {
    lines.push(`MOD:${module.id}|file:${module.file}|role:${module.role}|state:${module.state}`);
    for (const className of module.classes) {
      lines.push(`  CLASS:${className}`);
    }
    for (const functionName of module.functions) {
      lines.push(`  FUNC:${functionName}`);
    }
  }

  for (const module of modules) {
    for (const relation of module.relations) {
      lines.push(`REL:${module.id}->${relation.target}|via:${relation.via}`);
    }
  }

  lines.push("CONV:Preserve existing repository conventions");
  for (const module of modules) {
    lines.push(`CTX:${module.file}: ${module.ctx}`);
  }

  const body = lines.join("\n");
  const estimatedTokens = Math.ceil(body.length / 4);
  const sizeKb = Math.max(1, Math.round(body.length / 1024));
  const content = `${body}\n\n---\n## SEMANTIC PACK SUMMARY\n- Estimated tokens: ~${estimatedTokens}\n- Output size: ~${sizeKb} KB\n`;

  fs.writeFileSync(outputPath, content, "utf8");
  return {
    outputPath,
    content,
    fileCount: collected.files.length,
    truncated: collected.truncated,
  };
}

function buildReadableSection(file: WorkspaceFile): string {
  if (file.skippedReason) {
    return `## ${file.relativePath}\n[Skipped: ${file.skippedReason}]`;
  }

  const ext = path.extname(file.relativePath).replace(/^\./, "") || "txt";
  const fence = "```";
  return `## ${file.relativePath}\n\n${fence}${ext}\n${file.content ?? ""}\n${fence}`;
}

function collectWorkspaceFiles(workspaceRoot: string, options: WorkspacePackOptions): { files: WorkspaceFile[]; truncated: boolean } {
  const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
  const maxFileBytes = Math.max(1, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const matcher = createIgnoreMatcher(workspaceRoot);
  const files: WorkspaceFile[] = [];
  let truncated = false;

  const visit = (currentPath: string): void => {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = toPosixRelative(workspaceRoot, absolutePath);
      if (matcher.matches(relativePath, entry.name, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (!entry.isFile() || !shouldIncludeFile(relativePath)) {
        continue;
      }

      const stat = fs.statSync(absolutePath);
      if (stat.size > maxFileBytes) {
        files.push({ relativePath, skippedReason: `file larger than ${maxFileBytes} bytes` });
        continue;
      }

      const raw = fs.readFileSync(absolutePath);
      if (!isTextBuffer(raw)) {
        files.push({ relativePath, skippedReason: "binary file" });
        continue;
      }

      files.push({ relativePath, content: raw.toString("utf8") });
    }
  };

  visit(workspaceRoot);
  return { files, truncated };
}

function createIgnoreMatcher(workspaceRoot: string): IgnoreMatcher {
  const regexes = readPackignorePatterns(workspaceRoot).map(patternToRegExp);

  return {
    matches(relativePath: string, entryName: string, isDirectory: boolean): boolean {
      if (isDirectory && HARDCODED_IGNORE_DIRS.has(entryName)) {
        return true;
      }

      if (!isDirectory && (entryName === ".DS_Store" || entryName === "Thumbs.db")) {
        return true;
      }

      if (!isDirectory && HARDCODED_IGNORE_FILE_SUFFIXES.some((suffix) => entryName.endsWith(suffix))) {
        return true;
      }

      return regexes.some((regex) => regex.test(relativePath) || regex.test(entryName));
    },
  };
}

function readPackignorePatterns(workspaceRoot: string): string[] {
  const packignorePath = path.join(workspaceRoot, ".packignore");
  if (!fs.existsSync(packignorePath)) {
    return [];
  }

  return fs
    .readFileSync(packignorePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const normalized = escaped.endsWith("/") ? `${escaped}.*` : escaped;
  return new RegExp(`(^|/)${normalized}$`, "u");
}

function shouldIncludeFile(relativePath: string): boolean {
  const basename = path.basename(relativePath);
  if (basename === "Makefile") {
    return true;
  }

  const extension = path.extname(relativePath).replace(/^\./, "").toLowerCase();
  return DEFAULT_EXTENSIONS.has(extension);
}

function isTextBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

function buildTreeLines(relativePaths: string[]): string {
  const root: TreeNode = { children: new Map() };
  for (const relativePath of relativePaths) {
    const segments = relativePath.split("/");
    let current = root;
    for (const segment of segments) {
      let child = current.children.get(segment);
      if (!child) {
        child = { children: new Map() };
        current.children.set(segment, child);
      }
      current = child;
    }
  }

  const lines: string[] = [];
  renderTree(root, lines, "");
  return lines.join("\n");
}

function renderTree(node: TreeNode, lines: string[], prefix: string): void {
  const entries = [...node.children.entries()];
  entries.forEach(([name, child], index) => {
    const isLast = index === entries.length - 1;
    lines.push(`${prefix}${isLast ? "└─" : "├─"} ${name}`);
    renderTree(child, lines, `${prefix}${isLast ? "   " : "│  "}`);
  });
}

function describeModule(file: WorkspaceFile): ModuleInfo {
  const content = file.content ?? "";
  const extracted = extractSymbols(content, file.relativePath);
  return {
    id: file.relativePath.replace(/\.[^.]+$/u, ""),
    file: file.relativePath,
    role: inferRole(file.relativePath),
    state: inferState(content, extracted),
    classes: extracted.classes,
    functions: extracted.functions,
    relations: extracted.relations,
    ctx: summarizeModule(file.relativePath, extracted),
  };
}

function extractSymbols(content: string, relativePath: string): { classes: string[]; functions: string[]; relations: Array<{ target: string; via: string }> } {
  if (!content.trim()) {
    return { classes: [], functions: [], relations: [] };
  }

  const classes = collectMatches(content, [
    /\bclass\s+([A-Z][A-Za-z0-9_]*)/gu,
    /\binterface\s+([A-Z][A-Za-z0-9_]*)/gu,
    /\bstruct\s+([A-Z][A-Za-z0-9_]*)/gu,
    /\benum\s+([A-Z][A-Za-z0-9_]*)/gu,
  ]);

  const functions = collectMatches(content, [
    /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu,
    /\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu,
    /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu,
    /\b(?:public|private|protected|internal|static|async|final|override|virtual|export)?\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^\n;{}]*\)\s*(?::\s*[A-Za-z_<>,.?\[\]\s]+)?\s*\{/gu,
  ]).filter((name) => !["if", "for", "while", "switch", "catch", "function"].includes(name));

  const relations = collectRelations(content, relativePath);
  return {
    classes: dedupe(classes).slice(0, 12),
    functions: dedupe(functions).slice(0, 20),
    relations: dedupeRelations(relations),
  };
}

function collectRelations(content: string, relativePath: string): Array<{ target: string; via: string }> {
  const viaValues = collectMatches(content, [
    /from\s+["']([^"']+)["']/gu,
    /import\s+["']([^"']+)["']/gu,
    /require\(\s*["']([^"']+)["']\s*\)/gu,
    /from\s+([A-Za-z0-9_./-]+)/gu,
  ]);

  return viaValues
    .map((via) => ({ via, target: resolveRelationTarget(relativePath, via) }))
    .filter((relation): relation is { target: string; via: string } => Boolean(relation.target));
}

function resolveRelationTarget(sourcePath: string, rawTarget: string): string | undefined {
  const cleanTarget = rawTarget.trim().replace(/^@/, "");
  if (!cleanTarget || cleanTarget.startsWith("http") || cleanTarget.startsWith("node:")) {
    return undefined;
  }

  if (cleanTarget.startsWith(".")) {
    const sourceDir = path.posix.dirname(sourcePath);
    return path.posix.normalize(path.posix.join(sourceDir, cleanTarget)).replace(/\.[^.]+$/u, "");
  }

  if (!cleanTarget.includes("/") && path.extname(sourcePath) === ".py") {
    const sourceDir = path.posix.dirname(sourcePath);
    return path.posix.join(sourceDir, cleanTarget).replace(/\.[^.]+$/u, "");
  }

  return undefined;
}

function summarizeModule(relativePath: string, extracted: { classes: string[]; functions: string[] }): string {
  const parts = [`${relativePath} acts as ${inferRole(relativePath)}`];
  if (extracted.classes.length > 0) {
    parts.push(`classes ${extracted.classes.slice(0, 3).join(", ")}`);
  }
  if (extracted.functions.length > 0) {
    parts.push(`functions ${extracted.functions.slice(0, 4).join(", ")}`);
  }
  return sanitizeInline(parts.join("; "));
}

function inferRole(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.includes("controller") || lower.includes("handler")) {
    return "control logic, flow";
  }
  if (lower.includes("service") || lower.includes("usecase")) {
    return "business logic";
  }
  if (lower.includes("repo") || lower.includes("repository") || lower.includes("store")) {
    return "data access, persistence";
  }
  if (lower.includes("app") || lower.includes("main") || lower.includes("server")) {
    return "application root";
  }
  if (lower.includes("parser")) {
    return "parsing, format interpretation";
  }
  return "module";
}

function inferState(content: string, extracted: { classes: string[]; functions: string[] }): string {
  if (/\b(todo|fixme|planned)\b/iu.test(content)) {
    return "planned";
  }
  if (extracted.classes.length > 0 || extracted.functions.length > 0) {
    return "done";
  }
  return "planned";
}

function guessLanguageFromPath(relativePath: string): string {
  const extension = path.extname(relativePath).replace(/^\./, "").toLowerCase();
  const map: Record<string, string> = {
    py: "Python",
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    go: "Go",
    rs: "Rust",
    java: "Java",
    kt: "Kotlin",
    cs: "C#",
    cpp: "C++",
    cc: "C++",
    cxx: "C++",
    c: "C",
    h: "C",
    php: "PHP",
    rb: "Ruby",
    lua: "Lua",
    swift: "Swift",
    dart: "Dart",
    sh: "Shell",
    bash: "Shell",
    md: "Markdown",
    json: "JSON",
  };
  return map[extension] ?? (extension ? extension.toUpperCase() : "Unknown");
}

function collectMatches(content: string, regexes: RegExp[]): string[] {
  const matches: string[] = [];
  for (const regex of regexes) {
    for (const match of content.matchAll(regex)) {
      const value = match[1]?.trim();
      if (value) {
        matches.push(value);
      }
    }
  }
  return matches;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeRelations(values: Array<{ target: string; via: string }>): Array<{ target: string; via: string }> {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.target}|${value.via}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sanitizeInline(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/\|/gu, "/").trim();
}

function toPosixRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
}
