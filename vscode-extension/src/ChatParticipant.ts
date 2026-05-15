import * as vscode from "vscode";
import * as chatUtils from "@vscode/chat-extension-utils";
import { ContextRingBuffer } from "./ContextRingBuffer";
import {
  CtxChatMode,
  CtxResolvedChatMode,
  getCtxChatModeLabel,
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
      const effectiveMode = resolveEffectiveMode(modeResolution.mode, request, chatContext);
      const modeLabel = buildModeLabel(modeResolution, effectiveMode);
      const availableTools = vscode.lm.tools;
      const forwardedTools = selectToolsForModel(request.model, availableTools, effectiveMode, modeResolution.source);
      const contextTokenBudget = getContextTokenBudget(request.model?.maxInputTokens);
      const globalActiveTags = buffer.listActiveTagsAnyMode();
      const hasGlobalSelection = globalActiveTags.length > 0;
      const scopeLabel = hasGlobalSelection
        ? `selected slots (all modes): ${globalActiveTags.join(", ")}`
        : buffer.chatScopeSummary(effectiveMode);
      const promptContext = hasGlobalSelection
        ? buffer.buildPromptContextForTags(globalActiveTags, contextTokenBudget)
        : buffer.buildPromptContext(effectiveMode, contextTokenBudget);
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
        getModeBehaviorInstruction(modeResolution.mode, effectiveMode),
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

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out while waiting for the language model response/i.test(message);
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

function buildModeLabel(mode: { mode: CtxResolvedChatMode; source: "request" | "context" | "fallback" }, effectiveMode: CtxChatMode): string {
  const resolvedLabel = getCtxChatModeDisplay(mode);
  if (mode.mode !== "auto") {
    return resolvedLabel;
  }

  return `${resolvedLabel} -> ${getCtxChatModeLabel(effectiveMode)} (intent)`;
}

function resolveEffectiveMode(mode: CtxResolvedChatMode, request: vscode.ChatRequest, chatContext: vscode.ChatContext): CtxChatMode {
  if (mode !== "auto") {
    return mode;
  }

  return inferIntentMode(request, chatContext);
}

function inferIntentMode(request: vscode.ChatRequest, chatContext: vscode.ChatContext): CtxChatMode {
  if (request.toolReferences.length > 0) {
    return "agent";
  }

  const signalText = collectIntentSignals(request, chatContext).join(" ").toLowerCase();

  // Distinguish explicit agent activation from generic model picking.
  if (/(set\s*agent|modo\s*agent|agent\s*mode|ativar\s*agent|trocar\s*para\s*agent)/u.test(signalText)) {
    return "agent";
  }

  if (/(pick\s*model|choose\s*model|select\s*model|escolher\s*modelo|selecionar\s*modelo|trocar\s*modelo)/u.test(signalText)) {
    return "ask";
  }

  if (/(\bplan\b|\bplano\b|arquitetura|roadmap|estrat[eé]gia|passo\s*a\s*passo|sequ[êe]ncia)/u.test(signalText)) {
    return "plan";
  }

  if (/(implemente|implement|corrija|fix|refatore|refactor|edite|edit|execute|rode|run|crie|fa[çc]a|apply|patch|gera\s*c[oó]digo)/u.test(signalText)) {
    return "agent";
  }

  if (/(\?|como\b|what\b|why\b|qual\b|quais\b|explique|explain|resuma|summari[sz]e)/u.test(signalText)) {
    return "ask";
  }

  // Prefer agentic behavior when metadata is missing to avoid blocking legitimate edit requests.
  return "agent";
}

function collectIntentSignals(request: vscode.ChatRequest, chatContext: vscode.ChatContext): string[] {
  const parts: string[] = [request.prompt, request.command ?? ""];

  for (const reference of request.references) {
    if (reference.modelDescription) {
      parts.push(reference.modelDescription);
    }
  }

  for (const turn of chatContext.history.slice(-6)) {
    if (isRecord(turn)) {
      const prompt = "prompt" in turn ? asString(turn.prompt) : undefined;
      const command = "command" in turn ? asString(turn.command) : undefined;
      if (prompt) {
        parts.push(prompt);
      }
      if (command) {
        parts.push(command);
      }

      const response = "response" in turn ? turn.response : undefined;
      if (Array.isArray(response)) {
        for (const part of response) {
          if (!isRecord(part)) {
            continue;
          }

          const commandValue = isRecord(part.value) ? part.value : undefined;
          const title = commandValue ? asString(commandValue.title) : undefined;
          if (title) {
            parts.push(title);
          }
        }
      }
    }
  }

  return parts.filter((value) => value.trim().length > 0);
}

function getModeBehaviorInstruction(mode: CtxResolvedChatMode, effectiveMode: CtxChatMode): string {
  if (mode === "auto") {
    return `Mode metadata is unavailable: inferred intent is ${getCtxChatModeLabel(effectiveMode)}. Keep execution unblocked, and when edits are requested, proceed agentically.`;
  }

  if (mode === "agent") {
    return "In Agent mode, keep the request agentic, execute concrete steps, and use tools naturally when they improve correctness.";
  }

  if (mode === "plan") {
    return "In Plan mode, prioritize planning and sequencing over direct execution unless the user explicitly asks to act.";
  }

  if (mode === "ask") {
    return "In Ask mode, answer directly first, but do not block tool usage or edits when the user explicitly asks to implement changes.";
  }

  return "Mode metadata is unavailable: infer intent from the latest user prompt and history, keep execution unblocked, and use tools when they improve correctness.";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
  // Keep a conservative ceiling to reduce latency and avoid provider-side tool-list limits.
  return 48;
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

  // In fallback mode (metadata unavailable), avoid forwarding a large explicit tool list.
  // Let the provider manage tools implicitly to reduce request payload and timeout risk.
  if (modeSource === "fallback") {
    return [];
  }

  const allowToolsByMode = shouldForwardToolsForMode(mode);
  if (!allowToolsByMode) {
    return [];
  }

  const modeLimit = mode === "agent" ? 48 : 24;
  const limit = Math.min(modeLimit, getToolLimitFromModel(model));
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
  const sendRequest = (explicitTools?: readonly vscode.LanguageModelToolInformation[]) =>
    chatUtils.sendChatParticipantRequest(
      request,
      chatContext,
      {
        prompt,
        responseStreamOptions: {
          stream,
          references: true,
          responseText: true,
        },
        ...(explicitTools && explicitTools.length > 0 ? { tools: explicitTools } : {}),
        extensionMode,
      },
      token
    );

  const hasExplicitTools = tools.length > 0;
  const firstAttempt = sendRequest(hasExplicitTools ? tools : undefined);

  try {
    return await awaitWithTimeout(
      firstAttempt.result,
      hasExplicitTools ? 90000 : 180000,
      "CtxPack request timed out while waiting for the language model response."
    );
  } catch (error) {
    const shouldRetryWithoutTools = hasExplicitTools && (isToolCountLimitError(error) || isTimeoutError(error));
    if (!shouldRetryWithoutTools) {
      throw error;
    }

    const note = isToolCountLimitError(error)
      ? "CtxPack note: tool list exceeded the model limit; retrying with model-managed tool set."
      : "CtxPack note: request with explicit tools timed out; retrying with model-managed tool set.";
    stream.markdown(`\n\n${note}`);
    const fallbackRequest = sendRequest(undefined);

    return await awaitWithTimeout(
      fallbackRequest.result,
      180000,
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
