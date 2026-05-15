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
    fs.writeFileSync(path.join(dirPath, "image.bin"), Buffer.from([0, 159, 146, 150]));

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
});
