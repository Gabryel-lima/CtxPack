import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createPackignoreTemplate,
  createQueryPack,
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
    expect(resolveCtxChatMode("Task")).toBe("agent");
    expect(resolveCtxChatMode("Edit")).toBe("agent");
    expect(resolveCtxChatMode("Plan")).toBe("plan");
    expect(resolveCtxChatMode(undefined)).toBe("ask");
  });

  it("resolves mode from request shape variants", () => {
    expect(resolveCtxChatModeFromRequest({ modeInstructions2: { name: "Agent" } }).mode).toBe("agent");
    expect(resolveCtxChatModeFromRequest({ modeInstructions2: { name: "Task" } }).mode).toBe("agent");
    expect(resolveCtxChatModeFromRequest({ modeInstructions: { name: "Plan" } }).mode).toBe("plan");
    expect(resolveCtxChatModeFromRequest({ modeName: "Ask" }).mode).toBe("ask");
  });

  it("infers agent mode from mode instruction content with task keywords", () => {
    const resolved = resolveCtxChatModeFromRequest({
      modeInstructions2: {
        content: "Task mode: execute edits directly and apply changes",
      },
    });

    expect(resolved.mode).toBe("agent");
    expect(resolved.source).toBe("request");
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

  describe("createQueryPack", () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempRoot, "src", "unrelated.ts"), "export const nothing = 0;\n", "utf8");
    });

    it("ranks a module whose name/content matches the query above an unrelated one", () => {
      const result = createQueryPack(tempRoot, "createUser service", {
        maxFiles: 20,
        maxFileBytes: 10_000,
        top: 5,
      });

      expect(result.content).toContain("MOD:src/service|");
      expect(result.content).not.toContain("MOD:src/unrelated|");
    });

    it("boosts a module related via a 1-hop REL edge even without its own lexical match", () => {
      // "createUser" is only a declared symbol in service.ts — controller.ts
      // only *calls* it, so it can't score lexically and must be pulled in
      // purely by import-graph proximity to service.ts.
      const result = createQueryPack(tempRoot, "createUser", {
        maxFiles: 20,
        maxFileBytes: 10_000,
        top: 10,
      });

      expect(result.content).toContain("MOD:src/controller|");
      expect(result.content).toMatch(/WHY:src\/controller\|graph:1-hop via src\/service/);
      expect(result.content).not.toContain("MOD:src/unrelated|");
    });

    it("includes a WHY: line explaining each selected module's match", () => {
      const result = createQueryPack(tempRoot, "UserService", { maxFiles: 20, maxFileBytes: 10_000 });

      expect(result.content).toMatch(/WHY:src\/service\|(name-match|symbol-match)/);
    });

    it("only keeps REL edges between two modules that are both selected", () => {
      const result = createQueryPack(tempRoot, "createUser", { maxFiles: 20, maxFileBytes: 10_000, top: 10 });

      expect(result.content).toContain("REL:src/controller->src/service|via:./service");
    });

    it("limits output to the requested top-N modules", () => {
      // "src" lexically matches every module's id/file, so this isolates the
      // top-N cutoff itself rather than the ranking that feeds it.
      const limited = createQueryPack(tempRoot, "src", { maxFiles: 20, maxFileBytes: 10_000, top: 1 });
      const unlimited = createQueryPack(tempRoot, "src", { maxFiles: 20, maxFileBytes: 10_000, top: 10 });

      expect(limited.fileCount).toBe(1);
      expect(unlimited.fileCount).toBe(3);
    });

    it("does not write the query result to disk", () => {
      createQueryPack(tempRoot, "createUser service", { maxFiles: 20, maxFileBytes: 10_000 });
      const entries = fs.readdirSync(tempRoot);
      expect(entries.some((entry) => entry.includes(".query."))).toBe(false);
    });
  });
});
