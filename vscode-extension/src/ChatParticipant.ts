import * as vscode from "vscode";
import * as chatUtils from "@vscode/chat-extension-utils";
import { ContextRingBuffer } from "./ContextRingBuffer";
import {
  CtxChatMode,
  getCtxChatModeDisplay,
  resolveCtxChatModeFromRequest,
} from "./WorkspacePackBuilder";

export interface CtxInjectionSnapshot {
  modeLabel: string;
  modeSource: "request" | "context" | "fallback";
  scopeLabel: string;
  usedTags: string[];
  omittedTags: string[];
  estimatedTokens: number;
  tokenBudget: number;
  forwardedToolsCount: number;
  availableToolsCount: number;
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
      const modeResolution = resolveCtxChatModeFromRequest(request, chatContext);
      const chatMode = modeResolution.mode;
      const modeLabel = getCtxChatModeDisplay(modeResolution);
      const availableTools = vscode.lm.tools;
      const forwardedTools = selectToolsForModel(request.model, availableTools, chatMode, modeResolution.source);
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
        modeSource: modeResolution.source,
        scopeLabel,
        usedTags: promptContext.usedTags,
        omittedTags: promptContext.omittedTags,
        estimatedTokens: promptContext.estimatedTokens,
        tokenBudget: contextTokenBudget,
        forwardedToolsCount: forwardedTools.length,
        availableToolsCount: availableTools.length,
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
          `Forwarded tools: ${forwardedTools.length}/${availableTools.length}`,
          "",
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
        "Respect the current Copilot chat mode when available instead of forcing a generic Q&A behavior.",
        "In Agent mode, keep the request agentic and allow normal tool use.",
        "In Plan mode, prioritize planning and sequencing over direct execution unless the user explicitly asks to act.",
        "In Ask mode, answer directly and use tools only when that is the natural path for the current Copilot setup.",
        "When mode cannot be detected by API fields, do not force Ask behavior; infer intent from the user request and chat context.",
        "Treat the CtxPack buffer as grounded workspace evidence that must be read before answering when it is present.",
        "Do not ignore the CtxPack block. Use it first, then combine it with chat history and tool results.",
        contextBlock,
      ].join("\n\n");

      try {
        const result = await sendWithToolFallback(
          request,
          chatContext,
          stream,
          token,
          prompt,
          forwardedTools,
          context.extensionMode
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
          stream.markdown(`\n\nModel error: ${err.message}`);
          return;
        }

        const genericMessage = err instanceof Error ? err.message : String(err);
        onInjectionSnapshot?.({
          ...baseSnapshot,
          status: "error",
          errorMessage: genericMessage,
        });
        stream.markdown(`\n\nFailed to query the language model. Details: ${genericMessage}`);
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

/**
 * Determines if tools should be forwarded to the language model based on the current chat mode.
 * 
 * Tool availability per mode:
 * - "agent": Full tool access for autonomous task execution
 * - "ask": Tools available for natural use by the AI (e.g., file operations, searches)
 * - "plan": Tools disabled - mode is read-only for strategic planning only
 * 
 * @param mode The current CtxPack chat mode
 * @returns true if tools should be forwarded, false otherwise
 */
function shouldForwardToolsForMode(mode: CtxChatMode): boolean {
  return mode === "agent" || mode === "ask";
}

function isToolCountLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot have more than\s+\d+\s+tools per request/i.test(message);
}

function getToolLimitFromModel(model: vscode.LanguageModelChat | undefined): number {
  if (!model) {
    return 0;
  }

  // ChatRequest.model (LanguageModelChat) does not expose toolCalling capability in this API version.
  // Keep a conservative ceiling below common provider limits to avoid request rejection.
  return 96;
}

function selectToolsForModel(
  model: vscode.LanguageModelChat | undefined,
  tools: readonly vscode.LanguageModelToolInformation[],
  mode: CtxChatMode,
  modeSource: "request" | "context" | "fallback"
): vscode.LanguageModelToolInformation[] {
  if (tools.length === 0) {
    return [];
  }

  // In fallback mode, prefer not to block tools because the mode could not be detected reliably.
  const allowToolsByMode = shouldForwardToolsForMode(mode) || modeSource === "fallback";
  if (!allowToolsByMode) {
    return [];
  }

  const limit = getToolLimitFromModel(model);
  if (limit <= 0) {
    return [];
  }

  if (tools.length <= limit) {
    return [...tools];
  }

  return [...tools].slice(0, limit);
}

async function sendWithToolFallback(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  prompt: string,
  tools: readonly vscode.LanguageModelToolInformation[],
  extensionMode: vscode.ExtensionMode
): Promise<vscode.ChatResult> {
  const requestWithTools = chatUtils.sendChatParticipantRequest(
    request,
    chatContext,
    {
      prompt,
      responseStreamOptions: {
        stream,
        references: true,
        responseText: true,
      },
      tools,
      extensionMode,
    },
    token
  );

  try {
    return await awaitWithTimeout(
      requestWithTools.result,
      45000,
      "CtxPack request timed out while waiting for the language model response."
    );
  } catch (error) {
    if (!isToolCountLimitError(error)) {
      throw error;
    }

    stream.markdown("\n\nCtxPack note: tool list exceeded the model limit; retrying with model-managed tool set.");
    const fallbackRequest = chatUtils.sendChatParticipantRequest(
      request,
      chatContext,
      {
        prompt,
        responseStreamOptions: {
          stream,
          references: true,
          responseText: true,
        },
        extensionMode,
      },
      token
    );

    return await awaitWithTimeout(
      fallbackRequest.result,
      45000,
      "CtxPack request timed out while waiting for the language model response after tool fallback."
    );
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
