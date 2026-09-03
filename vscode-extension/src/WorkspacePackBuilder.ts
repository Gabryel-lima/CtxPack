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

export interface WorkspaceQueryOptions extends WorkspacePackOptions {
  fileHint?: string;
  symbolHint?: string;
  top?: number;
  minScore?: number;
  maxHops?: number;
  hopDecay?: number;
}

export interface ModuleQueryScore {
  module: ModuleInfo;
  score: number;
  reasons: string[];
}

export interface WorkspacePackResult {
  outputPath: string;
  content: string;
  fileCount: number;
  truncated: boolean;
}

export interface IgnoreMatcher {
  matches(relativePath: string, entryName: string, isDirectory: boolean): boolean;
}

interface WorkspaceFile {
  relativePath: string;
  content?: string;
  skippedReason?: string;
}

export interface ModuleInfo {
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
  if (
    normalized.includes("agent") ||
    normalized.includes("agente") ||
    normalized.includes("task") ||
    normalized.includes("tarefa") ||
    normalized.includes("edit") ||
    normalized.includes("execute") ||
    normalized.includes("action")
  ) {
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
    readPath(requestLike, ["mode", "label"]),
    readPath(requestLike, ["mode", "id"]),
    readPath(requestLike, ["chatMode", "name"]),
    readPath(requestLike, ["chatMode", "label"]),
    readPath(requestLike, ["chatMode", "id"]),
    readPath(requestLike, ["participantMode", "name"]),
    readPath(requestLike, ["participantMode", "id"]),
    readPath(requestLike, ["session", "mode", "name"]),
    readPath(requestLike, ["session", "mode", "id"]),
    readPath(requestLike, ["modeName"]),
    readPath(requestLike, ["modeId"]),
    readPath(requestLike, ["modeKind"]),
    readPath(requestLike, ["mode"]),
    readPath(requestLike, ["chatMode"]),
    readPath(requestLike, ["participantMode"]),
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
  if (
    normalized.includes("agent") ||
    normalized.includes("agente") ||
    normalized.includes("task") ||
    normalized.includes("tarefa") ||
    normalized.includes("edit") ||
    normalized.includes("execute") ||
    normalized.includes("action")
  ) {
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

/**
 * Ranks the workspace's modules by relevance to a query instead of always
 * dumping everything, and emits a trimmed semantic DSL subset for only the
 * top matches — same DSL shape as createSemanticPack plus a WHY: line per
 * module. Deliberately does NOT write to disk (unlike the other builders):
 * a query result is meant to be pushed straight into the buffer as a small,
 * ephemeral, pre-scoped slot, not kept as a project artifact.
 *
 * Ranking mirrors analyzers/relevance_ranker.py on the Python side
 * conceptually (lexical overlap + import-graph proximity, no ML) — the two
 * are implemented independently and may drift; keep that in mind if you
 * change one without the other.
 */
export function createQueryPack(
  workspaceRoot: string,
  query: string,
  options: WorkspaceQueryOptions = {}
): WorkspacePackResult {
  const collected = collectWorkspaceFiles(workspaceRoot, options);
  const modules = collected.files.map((file) => describeModule(file));
  const scored = rankModules(modules, query, options);

  const projectName = path.basename(workspaceRoot);
  const languages = new Set(scored.map(({ module }) => guessLanguageFromPath(module.file)).filter(Boolean));
  const selectedIds = new Set(scored.map(({ module }) => module.id));

  const lines: string[] = [
    "<!-- DSL SEMANTIC (QUERY SUBSET): PRJ=project, DEP=dependencies, MOD=module, REL=module relations, CONV=conventions, DEC=design decisions, BUG=known issues, NOW=current focus, CTX=extra context, WHY=why this module was selected for the query -->",
    "",
    `PRJ:${projectName}|lang:${[...languages].join(",") || "Unknown"}`,
  ];

  for (const { module, reasons } of scored) {
    lines.push(`MOD:${module.id}|file:${module.file}|role:${module.role}|state:${module.state}`);
    for (const className of module.classes) {
      lines.push(`  CLASS:${className}`);
    }
    for (const functionName of module.functions) {
      lines.push(`  FUNC:${functionName}`);
    }
    lines.push(`WHY:${module.id}|${reasons.join(",") || "seed match"}`);
  }

  for (const { module } of scored) {
    for (const relation of module.relations) {
      if (selectedIds.has(relation.target)) {
        lines.push(`REL:${module.id}->${relation.target}|via:${relation.via}`);
      }
    }
  }

  for (const { module } of scored) {
    lines.push(`CTX:${module.file}: ${module.ctx}`);
  }

  const body = lines.join("\n");
  const estimatedTokens = Math.ceil(body.length / 4);
  const sizeKb = Math.max(1, Math.round(body.length / 1024));
  const content =
    `${body}\n\n---\n## QUERY PACK SUMMARY\n- Query: ${sanitizeInline(query)}\n` +
    `- Modules matched: ${scored.length}\n- Estimated tokens: ~${estimatedTokens}\n- Output size: ~${sizeKb} KB\n`;

  const slug = query.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 40) || "query";
  const outputPath = path.join(workspaceRoot, `${projectName}.${slug}.query.sem.ctx.md`);

  return {
    outputPath,
    content,
    fileCount: scored.length,
    truncated: collected.truncated,
  };
}

const RELEVANCE_TOKEN_RE = /[a-z0-9_]+/gu;
const NAME_WEIGHT = 1.0;
const SYMBOL_WEIGHT = 0.8;
const TAG_WEIGHT = 0.6;
const ROLE_WEIGHT = 0.4;
const HINT_SCORE = 1.0;

function tokenizeForRelevance(text: string): Set<string> {
  const matches = text.toLowerCase().match(RELEVANCE_TOKEN_RE) ?? [];
  return new Set(matches.filter((token) => token.length >= 2));
}

function lexicalModuleScore(module: ModuleInfo, queryTerms: Set<string>): { score: number; reasons: string[] } {
  if (queryTerms.size === 0) {
    return { score: 0, reasons: [] };
  }

  let best = 0;
  const reasons: string[] = [];

  const consider = (text: string, weight: number, label: string): void => {
    const terms = tokenizeForRelevance(text);
    const matched = [...queryTerms].filter((term) => terms.has(term));
    if (matched.length === 0) {
      return;
    }
    const score = weight * (matched.length / queryTerms.size);
    if (score > best) {
      best = score;
    }
    reasons.push(`${label}(${matched.join(",")})`);
  };

  consider(`${module.id} ${module.file}`, NAME_WEIGHT, "name-match");
  consider([...module.classes, ...module.functions].join(" "), SYMBOL_WEIGHT, "symbol-match");
  consider(module.role, ROLE_WEIGHT, "role-match");
  consider(module.ctx, TAG_WEIGHT, "tag-match");

  return { score: best, reasons };
}

function buildModuleAdjacency(modules: ModuleInfo[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!adjacency.has(a)) {
      adjacency.set(a, new Set());
    }
    adjacency.get(a)!.add(b);
  };
  for (const module of modules) {
    for (const relation of module.relations) {
      link(module.id, relation.target);
      link(relation.target, module.id);
    }
  }
  return adjacency;
}

function propagateModuleGraphScores(
  seedScores: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  maxHops: number,
  hopDecay: number
): { scores: Map<string, number>; reasons: Map<string, string> } {
  const scores = new Map<string, number>();
  const reasons = new Map<string, string>();
  const visited = new Set(seedScores.keys());
  let frontier = [...seedScores.entries()];
  let hop = 0;

  while (frontier.length > 0 && hop < maxHops) {
    hop += 1;
    const nextFrontier: Array<[string, number]> = [];
    for (const [name, score] of frontier) {
      const decayed = score * hopDecay;
      if (decayed <= 0) {
        continue;
      }
      for (const neighbor of adjacency.get(name) ?? []) {
        if (visited.has(neighbor)) {
          continue;
        }
        scores.set(neighbor, decayed);
        reasons.set(neighbor, `graph:${hop}-hop via ${name}`);
        nextFrontier.push([neighbor, decayed]);
      }
    }
    for (const [name] of nextFrontier) {
      visited.add(name);
    }
    frontier = nextFrontier;
  }

  return { scores, reasons };
}

function rankModules(
  modules: ModuleInfo[],
  query: string,
  options: WorkspaceQueryOptions
): ModuleQueryScore[] {
  const queryTerms = tokenizeForRelevance(query ?? "");
  const maxHops = options.maxHops ?? 2;
  const hopDecay = options.hopDecay ?? 0.5;
  const top = options.top ?? 15;
  const minScore = options.minScore ?? 0.05;

  const lexicalScores = new Map<string, number>();
  const lexicalReasons = new Map<string, string[]>();

  for (const module of modules) {
    const { score, reasons } = lexicalModuleScore(module, queryTerms);
    if (score > 0) {
      lexicalScores.set(module.id, score);
      lexicalReasons.set(module.id, reasons);
    }
  }

  if (options.fileHint?.trim()) {
    const needle = options.fileHint.trim().toLowerCase();
    for (const module of modules) {
      if (module.file.toLowerCase().includes(needle) || module.id.toLowerCase().includes(needle)) {
        lexicalScores.set(module.id, Math.max(lexicalScores.get(module.id) ?? 0, HINT_SCORE));
        lexicalReasons.set(module.id, [...(lexicalReasons.get(module.id) ?? []), `file-hint(${options.fileHint})`]);
      }
    }
  }

  if (options.symbolHint?.trim()) {
    const needle = options.symbolHint.trim().toLowerCase();
    for (const module of modules) {
      const symbolMatch = [...module.classes, ...module.functions].find((symbol) => symbol.toLowerCase().includes(needle));
      if (symbolMatch) {
        lexicalScores.set(module.id, Math.max(lexicalScores.get(module.id) ?? 0, HINT_SCORE));
        lexicalReasons.set(module.id, [
          ...(lexicalReasons.get(module.id) ?? []),
          `symbol-hint(${options.symbolHint}:${symbolMatch})`,
        ]);
      }
    }
  }

  const adjacency = buildModuleAdjacency(modules);
  const { scores: graphScores, reasons: graphReasons } = propagateModuleGraphScores(
    lexicalScores,
    adjacency,
    maxHops,
    hopDecay
  );

  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const allIds = new Set([...lexicalScores.keys(), ...graphScores.keys()]);
  const results: ModuleQueryScore[] = [];

  for (const id of allIds) {
    const module = moduleById.get(id);
    if (!module) {
      continue;
    }
    const score = Math.max(lexicalScores.get(id) ?? 0, graphScores.get(id) ?? 0);
    if (score < minScore) {
      continue;
    }
    const reasons = [...(lexicalReasons.get(id) ?? [])];
    const graphReason = graphReasons.get(id);
    if (graphReason) {
      reasons.push(graphReason);
    }
    results.push({ module, score: Math.round(score * 10000) / 10000, reasons });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, top);
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

export function createIgnoreMatcher(workspaceRoot: string): IgnoreMatcher {
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

export function shouldIncludeFile(relativePath: string): boolean {
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
