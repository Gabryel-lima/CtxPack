import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildPathContext } from "../src/PathContextBuilder";

describe("PathContextBuilder", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctxpack-path-builder-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("builds a readable slot for a single file", () => {
    const filePath = path.join(tempRoot, "sample.ts");
    fs.writeFileSync(filePath, "export const value = 1;\n", "utf8");

    const result = buildPathContext(filePath, tempRoot, { maxFiles: 10, maxFileBytes: 10_000 });

    expect(result.tag).toBe("sample.ts");
    expect(result.content).toContain("## sample.ts");
    expect(result.content).toContain("```ts");
    expect(result.content).toContain("export const value = 1;");
  });

  it("builds a directory slot with collected file list", () => {
    const dirPath = path.join(tempRoot, "src");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "a.ts"), "export const a = 1;\n", "utf8");
    fs.writeFileSync(path.join(dirPath, "b.ts"), "export const b = 2;\n", "utf8");

    const result = buildPathContext(dirPath, tempRoot, { maxFiles: 10, maxFileBytes: 10_000 });

    expect(result.tag).toBe("src");
    expect(result.content).toContain("# Directory Context: src");
    expect(result.content).toContain("- src/a.ts");
    expect(result.content).toContain("- src/b.ts");
    expect(result.content).toContain("## src/a.ts");
    expect(result.content).toContain("## src/b.ts");
  });

  it("marks large files as skipped", () => {
    const filePath = path.join(tempRoot, "large.txt");
    fs.writeFileSync(filePath, "x".repeat(32), "utf8");

    const result = buildPathContext(filePath, tempRoot, { maxFiles: 10, maxFileBytes: 8 });

    expect(result.content).toContain("[Skipped: file larger than 8 bytes]");
  });

  it("skips binary files inside directories", () => {
    const dirPath = path.join(tempRoot, "assets");
    fs.mkdirSync(dirPath);
    // ".dat" isn't in WorkspacePackBuilder's hardcoded binary-extension ignore
    // list, so this exercises content-sniffing (isTextBuffer) rather than the
    // ignore-matcher's extension shortcut.
    fs.writeFileSync(path.join(dirPath, "payload.dat"), Buffer.from([0, 159, 146, 150]));

    const result = buildPathContext(dirPath, tempRoot, { maxFiles: 10, maxFileBytes: 10_000 });

    expect(result.content).toContain("[Skipped: binary file]");
  });

  it("reports when directory collection is truncated by file limit", () => {
    const dirPath = path.join(tempRoot, "many");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "a.ts"), "a\n", "utf8");
    fs.writeFileSync(path.join(dirPath, "b.ts"), "b\n", "utf8");
    fs.writeFileSync(path.join(dirPath, "c.ts"), "c\n", "utf8");

    const result = buildPathContext(dirPath, tempRoot, { maxFiles: 2, maxFileBytes: 10_000 });

    expect(result.content).toContain("[CtxPack] Directory listing truncated by max file limit.");
  });

  it("excludes hardcoded ignore directories like node_modules and .git", () => {
    const dirPath = path.join(tempRoot, "project");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "index.ts"), "export const ok = true;\n", "utf8");

    const nodeModules = path.join(dirPath, "node_modules", "some-pkg");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "index.js"), "module.exports = {};\n", "utf8");

    const gitDir = path.join(dirPath, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf8");

    const result = buildPathContext(dirPath, tempRoot, { maxFiles: 50, maxFileBytes: 10_000 });

    expect(result.content).toContain("## project/index.ts");
    expect(result.content).not.toContain("node_modules/some-pkg/index.js");
    expect(result.content).not.toContain(".git/HEAD");
  });

  it("respects .packignore patterns from the workspace root", () => {
    fs.writeFileSync(path.join(tempRoot, ".packignore"), "secrets/\n", "utf8");

    const dirPath = path.join(tempRoot, "project");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "index.ts"), "export const ok = true;\n", "utf8");

    const secretsDir = path.join(dirPath, "secrets");
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, "keys.txt"), "super-secret\n", "utf8");

    const result = buildPathContext(dirPath, tempRoot, { maxFiles: 50, maxFileBytes: 10_000 });

    expect(result.content).toContain("## project/index.ts");
    expect(result.content).not.toContain("secrets/keys.txt");
    expect(result.content).not.toContain("super-secret");
  });
});
