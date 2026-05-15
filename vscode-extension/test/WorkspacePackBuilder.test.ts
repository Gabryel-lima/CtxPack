import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createPackignoreTemplate,
  createReadablePack,
  createSemanticPack,
  getCtxChatModeDisplay,
  resolveCtxChatMode,
  resolveCtxChatModeFromRequest,
} from "../src/WorkspacePackBuilder";

describe("WorkspacePackBuilder", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctxpack-workspace-pack-"));
    fs.mkdirSync(path.join(tempRoot, "src"));
    fs.writeFileSync(
      path.join(tempRoot, "src", "service.ts"),
      "export class UserService {\n  createUser(name: string) {\n    return name.trim();\n  }\n}\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempRoot, "src", "controller.ts"),
      "import { UserService } from './service';\nexport function handleCreate(name: string) {\n  return new UserService().createUser(name);\n}\n",
      "utf8"
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("creates a readable pack without Python", () => {
    const result = createReadablePack(tempRoot, { maxFiles: 20, maxFileBytes: 10_000 });

    expect(result.outputPath).toBe(path.join(tempRoot, `${path.basename(tempRoot)}.ctx.md`));
    expect(result.content).toContain("# CtxPack Readable Pack");
    expect(result.content).toContain("## src/controller.ts");
    expect(result.content).toContain("```ts");
  });

  it("creates a semantic pack with module and relation lines", () => {
    const result = createSemanticPack(tempRoot, {
      maxFiles: 20,
      maxFileBytes: 10_000,
      nowText: "extension mode routing",
    });

    expect(result.content).toContain(`PRJ:${path.basename(tempRoot)}|lang:TypeScript`);
    expect(result.content).toContain("NOW:extension mode routing");
    expect(result.content).toContain("MOD:src/controller|file:src/controller.ts|role:control logic, flow");
    expect(result.content).toContain("REL:src/controller->src/service|via:./service");
  });

  it("creates a packignore template when missing", () => {
    const result = createPackignoreTemplate(tempRoot);

    expect(result.outputPath).toBe(path.join(tempRoot, ".packignore"));
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.content).toContain("node_modules");
    expect(result.content).toContain(".terraform");
    expect(result.content).toContain("package-lock.json");
  });

  it("normalizes chat modes from VS Code mode names", () => {
    expect(resolveCtxChatMode("Agent")).toBe("agent");
    expect(resolveCtxChatMode("Plan")).toBe("plan");
    expect(resolveCtxChatMode(undefined)).toBe("ask");
  });

  it("resolves mode from request shape variants", () => {
    expect(resolveCtxChatModeFromRequest({ modeInstructions2: { name: "Agent" } }).mode).toBe("agent");
    expect(resolveCtxChatModeFromRequest({ modeInstructions: { name: "Plan" } }).mode).toBe("plan");
    expect(resolveCtxChatModeFromRequest({ modeName: "Ask" }).mode).toBe("ask");
  });

  it("resolves mode from chat context when request lacks mode", () => {
    const resolved = resolveCtxChatModeFromRequest(
      { prompt: "hello" },
      { modeInstructions2: { name: "Agent" } }
    );

    expect(resolved.mode).toBe("agent");
    expect(resolved.source).toBe("context");
  });

  it("falls back to auto when mode is absent", () => {
    const resolved = resolveCtxChatModeFromRequest({ prompt: "hello" });
    expect(resolved.mode).toBe("auto");
    expect(resolved.source).toBe("fallback");
    expect(getCtxChatModeDisplay(resolved)).toContain("Auto");
  });
});
