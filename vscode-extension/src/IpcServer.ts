import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export interface IpcPushMessage {
  tag?: string;
  content?: string;
}

function extractWorkspaceHash(socketPath: string): string | undefined {
  const match = socketPath.match(/ctxpack-([a-f0-9]{8})/i);
  return match?.[1]?.toLowerCase();
}

function consumeFallbackPushFile(
  fullPath: string,
  onMessage: (tag: string, content: string) => void
): void {
  try {
    if (!fs.existsSync(fullPath)) {
      return;
    }

    const raw = fs.readFileSync(fullPath, "utf8");
    const msg = JSON.parse(raw) as IpcPushMessage;
    if (!msg.content || !msg.content.trim()) {
      return;
    }

    onMessage(msg.tag?.trim() || "ctxpack", msg.content);
    fs.unlinkSync(fullPath);
  } catch {
    // Ignore partial or invalid reads; a later fs event may retry successfully.
  }
}

export function getSocketPath(workspaceRoot: string): string {
  const hash = crypto
    .createHash("md5")
    .update(workspaceRoot)
    .digest("hex")
    .slice(0, 8);

  if (process.platform === "win32") {
    return `\\\\.\\pipe\\ctxpack-${hash}`;
  }

  return path.join(os.tmpdir(), `ctxpack-${hash}.sock`);
}

export function createIpcServer(
  socketPath: string,
  onMessage: (tag: string, content: string) => void
): net.Server {
  if (process.platform !== "win32" && fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  const server = net.createServer((socket) => {
    let raw = "";

    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });

    socket.on("error", (err) => {
      console.error("[CtxPack IPC] socket error:", err);
    });

    socket.on("end", () => {
      try {
        const msg = JSON.parse(raw) as IpcPushMessage;
        if (!msg.content || !msg.content.trim()) {
          throw new Error("missing 'content' field");
        }

        const tag = msg.tag?.trim() || "ctxpack";
        onMessage(tag, msg.content);
        socket.write(JSON.stringify({ ok: true }));
      } catch (err) {
        socket.write(JSON.stringify({ ok: false, error: String(err) }));
      } finally {
        socket.end();
      }
    });
  });

  let fallbackWatcher: fs.FSWatcher | undefined;
  if (process.platform === "win32") {
    const hash = extractWorkspaceHash(socketPath);
    if (hash) {
      const tmpDir = os.tmpdir();
      const pattern = new RegExp(`^ctxpack-${hash}-push\\.json$`, "i");

      fallbackWatcher = fs.watch(tmpDir, (eventType, filename) => {
        if (!filename || (eventType !== "rename" && eventType !== "change")) {
          return;
        }
        if (!pattern.test(filename)) {
          return;
        }

        const fullPath = path.join(tmpDir, filename);
        consumeFallbackPushFile(fullPath, onMessage);
      });

      fallbackWatcher.on("error", (err) => {
        console.error("[CtxPack IPC] fallback watcher error:", err);
      });
    }
  }

  server.on("close", () => {
    if (fallbackWatcher) {
      fallbackWatcher.close();
      fallbackWatcher = undefined;
    }
  });

  server.on("error", (err) => {
    console.error("[CtxPack IPC] server error:", err);
  });

  server.listen(socketPath, () => {
    console.log(`[CtxPack IPC] listening on: ${socketPath}`);
  });

  return server;
}
