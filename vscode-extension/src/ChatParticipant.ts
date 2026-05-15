import * as vscode from "vscode";
import * as chatUtils from "@vscode/chat-extension-utils";
import { ContextRingBuffer } from "./ContextRingBuffer";
import { getCtxChatModeLabel, resolveCtxChatModeFromRequest } from "./WorkspacePackBuilder";

export interface CtxInjectionSnapshot {
  modeLabel: string;
  scopeLabel: string;
  usedTags: string[];
  omittedTags: string[];
  estimatedTokens: number;
  tokenBudget: number;
  status: "ready" | "sent" | "error";
  errorMessage?: string;
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  buffer: ContextRingBuffer,
  onInjectionSnapshot?: (snapshot: CtxInjectionSnapshot) => void
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    "ctxpack.assistant",
    async (request, chatContext, stream, token) => {
      const modeResolution = resolveCtxChatModeFromRequest(request);
      const chatMode = modeResolution.mode;
      const modeLabel = getCtxChatModeLabel(chatMode);
      const forwardedTools = chatMode === "agent" || modeResolution.source === "fallback" ? vscode.lm.tools : [];
      const contextTokenBudget = getContextTokenBudget(request.model?.maxInputTokens);
      const globalActiveTags = buffer.listActiveTagsAnyMode();
      const hasGlobalSelection = globalActiveTags.length > 0;
      const scopeLabel = hasGlobalSelection
        ? `selected slots (all modes): ${globalActiveTags.join(", ")}`
        : buffer.chatScopeSummary(chatMode);
      const promptContext = hasGlobalSelection
        ? buffer.buildPromptContextForTags(globalActiveTags, contextTokenBudget)
        : buffer.buildPromptContext(chatMode, contextTokenBudget);
      const omittedSummary = promptContext.omittedTags.length
        ? `Omitted slots because of prompt budget: ${promptContext.omittedTags.join(", ")}.`
        : "";

      const baseSnapshot: CtxInjectionSnapshot = {
        modeLabel,
        scopeLabel,
        usedTags: promptContext.usedTags,
        omittedTags: promptContext.omittedTags,
        estimatedTokens: promptContext.estimatedTokens,
        tokenBudget: contextTokenBudget,
        status: "ready",
      };
      onInjectionSnapshot?.(baseSnapshot);

      const usedList = promptContext.usedTags.length ? promptContext.usedTags.join(", ") : "none";
      const omittedList = promptContext.omittedTags.length ? promptContext.omittedTags.join(", ") : "none";
      stream.markdown(
        [
          "**CtxPack injection report**",
          `Mode: ${modeLabel}`,
          `Scope: ${scopeLabel}`,
          `Used slots (${promptContext.usedTags.length}): ${usedList}`,
          `Omitted slots (${promptContext.omittedTags.length}): ${omittedList}`,
          `Estimated context tokens: ~${promptContext.estimatedTokens} / budget ~${contextTokenBudget}`,
        ].join("  \n")
      );

      if (buffer.listSlots().length === 0) {
        stream.markdown(buildEmptyBufferGuide(modeLabel));
        onInjectionSnapshot?.({
          ...baseSnapshot,
          status: "sent",
        });
        return {
          metadata: {
            source: "ctxpack-empty-buffer-guide",
          },
        };
      }

      const contextBlock = promptContext.content
        ? [
            `[CTXPACK SESSION CONTEXT | mode: ${modeLabel} | scope: ${scopeLabel}]`,
            `Used slots: ${promptContext.usedTags.join(", ")}.`,
            `Estimated context tokens: ~${promptContext.estimatedTokens}.`,
            omittedSummary,
            "Read the CtxPack context before answering. If it contains a semantic pack, treat its module, relation, and context lines as primary workspace evidence unless a tool discovers newer contradictory data.",
            "If the answer depends on the buffer, explicitly ground the answer in the used slots instead of ignoring them.",
            "If the buffer does not contain enough evidence, say that clearly and then continue with tools or general reasoning.",
            "",
            promptContext.content,
          ]
            .filter(Boolean)
            .join("\n\n")
        : `[CTXPACK SESSION CONTEXT | mode: ${modeLabel} | scope: empty]\n\nNo buffered context is currently selected for this mode.`;

      const prompt = [
        "You are the CtxPack participant for VS Code.",
        `Current chat mode: ${modeLabel}.`,
        "Respect the current Copilot chat mode instead of forcing a generic Q&A behavior.",
        "In Agent mode, keep the request agentic and allow normal tool use.",
        "In Plan mode, prioritize planning and sequencing over direct execution unless the user explicitly asks to act.",
        "In Ask mode, answer directly and use tools only when that is the natural path for the current Copilot setup.",
        "Treat the CtxPack buffer as grounded workspace evidence that must be read before answering when it is present.",
        "Do not ignore the CtxPack block. Use it first, then combine it with chat history and tool results.",
        contextBlock,
      ].join("\n\n");

      try {
        const libResult = chatUtils.sendChatParticipantRequest(
          request,
          chatContext,
          {
            prompt,
            responseStreamOptions: {
              stream,
              references: true,
              responseText: true,
            },
            tools: forwardedTools,
            extensionMode: context.extensionMode,
          },
          token
        );

        const result = await awaitWithTimeout(
          libResult.result,
          45000,
          "CtxPack request timed out while waiting for the language model response."
        );
        onInjectionSnapshot?.({
          ...baseSnapshot,
          status: "sent",
        });
        return result;
      } catch (err) {
        if (token.isCancellationRequested) {
          return;
        }
        if (err instanceof vscode.LanguageModelError) {
          onInjectionSnapshot?.({
            ...baseSnapshot,
            status: "error",
            errorMessage: err.message,
          });
          stream.markdown(`Model error: ${err.message}`);
          return;
        }

        const genericMessage = err instanceof Error ? err.message : String(err);
        onInjectionSnapshot?.({
          ...baseSnapshot,
          status: "error",
          errorMessage: genericMessage,
        });
        stream.markdown(`Failed to query the language model. Details: ${genericMessage}`);
      }
    }
  );

  participant.iconPath = new vscode.ThemeIcon("database");
  context.subscriptions.push(participant);
  return participant;
}

function getContextTokenBudget(modelMaxInputTokens: number | undefined): number {
  if (!modelMaxInputTokens || !Number.isFinite(modelMaxInputTokens)) {
    return 2500;
  }

  return Math.max(700, Math.min(5000, Math.floor(modelMaxInputTokens * 0.3)));
}

async function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function buildEmptyBufferGuide(modeLabel: string): string {
  return [
    "**CtxPack is active, but the buffer is empty**",
    `You invoked @ctx in ${modeLabel} mode, but there are no buffered slots yet.`,
    "",
    "**How to use the extension**",
    "1. Add context to the buffer:",
    "   - `CtxPack: Push selection to buffer`",
    "   - `CtxPack: Push entire file to buffer`",
    "   - `CtxPack: Push file or directory to buffer`",
    "   - `CtxPack: Generate semantic pack and push to buffer`",
    "2. (Optional) Scope what `@ctx` uses with `CtxPack: Choose active slots for @ctx`.",
    "3. Run `@ctx` again and CtxPack will inject the selected slots into the chat.",
    "",
    "**Quick workflow**",
    "Use `CtxPack: Open context workflow wizard` from the Command Palette to run the full flow step by step.",
  ].join("\n");
}
