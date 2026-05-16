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
  bufferAttached: boolean;
  omittedTags: string[];
  correlatedSlots: Array<{ tag: string; score: number; matchedTerms: string[] }>;
  estimatedTokens: number;
  tokenBudget: number;
  forwardedToolsCount: number;
  availableToolsCount: number;
  status: "ready" | "reading" | "correlating" | "sent" | "error";
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
      // Validação inicial: rejeitar prompts vazios
      if (!request.prompt.trim()) {
        stream.markdown("**CtxPack**: Please provide a prompt. Empty prompts cannot be processed.");
        onInjectionSnapshot?.({
          modeLabel: "unknown",
          modeSource: "fallback",
          scopeLabel: "n/a",
          usedTags: [],
          bufferAttached: false,
          omittedTags: [],
          correlatedSlots: [],
          estimatedTokens: 0,
          tokenBudget: 0,
          forwardedToolsCount: 0,
          availableToolsCount: 0,
          status: "error",
          errorMessage: "Empty prompt provided",
        });
        return { metadata: { source: "ctxpack-empty-prompt-rejection" } };
      }

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
      const correlations = correlateSlotsWithPrompt(request.prompt, promptContext.content);
      const omittedSummary = promptContext.omittedTags.length
        ? `Omitted slots because of prompt budget: ${promptContext.omittedTags.join(", ")}.`
        : "";

      const baseSnapshot: CtxInjectionSnapshot = {
        modeLabel,
        modeSource: modeResolution.source,
        scopeLabel,
        usedTags: promptContext.usedTags,
        bufferAttached: promptContext.usedTags.length > 0,
        omittedTags: promptContext.omittedTags,
        correlatedSlots: correlations,
        estimatedTokens: promptContext.estimatedTokens,
        tokenBudget: contextTokenBudget,
        forwardedToolsCount: forwardedTools.length,
        availableToolsCount: availableTools.length,
        status: "ready",
      };

      onInjectionSnapshot?.(baseSnapshot);

      stream.progress("⏳ CtxPack: reading buffered slots...");
      onInjectionSnapshot?.({
        ...baseSnapshot,
        status: "reading",
      });

      stream.progress("🔗 CtxPack: correlating prompt intent with buffered slots...");
      onInjectionSnapshot?.({
        ...baseSnapshot,
        status: "correlating",
      });

      // FIX: check empty buffer BEFORE printing the injection report. Previously the
      // report was streamed unconditionally (showing "Used slots: none / Omitted: none"),
      // followed by the empty-buffer guide — confusing and noisy for the user.
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

      const usedList = promptContext.usedTags.length ? promptContext.usedTags.join(", ") : "none";
      const omittedList = promptContext.omittedTags.length ? promptContext.omittedTags.join(", ") : "none";
      stream.markdown(
        [
          "**CtxPack injection report**",
          "Buffer access: confirmed (CtxPack context was attached to this request).",
          `Mode: ${modeLabel}`,
          `Scope: ${scopeLabel}`,
          `Used slots (${promptContext.usedTags.length}): ${usedList}`,
          `Omitted slots (${promptContext.omittedTags.length}): ${omittedList}`,
          `Estimated context tokens: ~${promptContext.estimatedTokens} / budget ~${contextTokenBudget}`,
          `Forwarded tools: ${forwardedTools.length}/${availableTools.length}`,
          "",
        ].join("  \n")
      );

      const correlationMarkdown = buildCorrelationMarkdown(correlations);
      if (correlationMarkdown) {
        stream.markdown(correlationMarkdown);
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
        "Do not ignore the CtxPack block. Read it first and answer from it directly when possible.",
        // FIX: explicit instruction to avoid unnecessary tool use when the buffer already
        // has the needed context. The previous wording ("combine it with chat history and
        // tool results") was causing the agent to search/read files already in the buffer.
        "Only invoke tools when the CtxPack buffer does not contain enough information to answer the request. Do not search or read files that are already represented in the buffer.",
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
        stream.progress("✅ CtxPack: context injection complete.");
        onInjectionSnapshot?.({
          ...baseSnapshot,
          status: "sent",
        });
        return result;
      } catch (err) {
        if (token.isCancellationRequested) {
          stream.progress("⚠️ CtxPack: request cancelled.");
          onInjectionSnapshot?.({
            ...baseSnapshot,
            status: "error",
            errorMessage: "Request cancelled",
          });
          return;
        }
        if (err instanceof vscode.LanguageModelError) {
          stream.progress(`❌ CtxPack: model error - ${err.message}`);
          onInjectionSnapshot?.({
            ...baseSnapshot,
            status: "error",
            errorMessage: err.message,
          });
          stream.markdown(`\n\nModel error: ${err.message}`);
          return;
        }

        const genericMessage = err instanceof Error ? err.message : String(err);
        stream.progress(`❌ CtxPack: request failed - ${genericMessage}`);
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

function tokenizeForCorrelation(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length >= 3);
}

function parseSlotSections(content: string): Array<{ tag: string; body: string }> {
  const sections: Array<{ tag: string; body: string }> = [];
  const regex = /^### \[(.+?)\]\n([\s\S]*?)(?=\n\n### \[|$)/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    sections.push({
      tag: match[1].trim(),
      body: match[2].trim(),
    });
  }

  return sections;
}

function correlateSlotsWithPrompt(
  prompt: string,
  promptContextContent: string
): Array<{ tag: string; score: number; matchedTerms: string[] }> {
  const promptTerms = new Set(tokenizeForCorrelation(prompt));
  if (promptTerms.size === 0) {
    return [];
  }

  const sections = parseSlotSections(promptContextContent);
  const result: Array<{ tag: string; score: number; matchedTerms: string[] }> = [];

  for (const section of sections) {
    const slotTerms = new Set(tokenizeForCorrelation(section.body));
    const matchedTerms = [...promptTerms].filter((term) => slotTerms.has(term)).slice(0, 6);
    if (matchedTerms.length === 0) {
      continue;
    }

    const rawScore = matchedTerms.length / Math.max(1, Math.min(promptTerms.size, 12));
    result.push({
      tag: section.tag,
      score: Math.min(1, Number(rawScore.toFixed(2))),
      matchedTerms,
    });
  }

  return result.sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildCorrelationMarkdown(correlations: Array<{ tag: string; score: number; matchedTerms: string[] }>): string {
  if (correlations.length === 0) {
    return "**CtxPack slot correlation**  \nNo strong lexical overlap detected between the prompt and buffered slots.";
  }

  const lines = [
    "**CtxPack slot correlation**",
    "| Slot | Correlation | Matched terms |",
    "| --- | --- | --- |",
  ];

  for (const item of correlations) {
    const percentage = Math.round(item.score * 100);
    const bars = "#".repeat(Math.max(1, Math.round(item.score * 8)));
    lines.push(`| ${item.tag} | ${bars} ${percentage}% | ${item.matchedTerms.join(", ")} |`);
  }

  return `${lines.join("\n")}\n`;
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

  // FIX: was "agent" — defaulting to agent caused the model to invoke tools on every
  // unclassified prompt, including simple questions that the buffer could answer directly.
  // "ask" is the safer default: it keeps the request answerable without tool loops.
  return "ask";
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
    // FIX: the previous instruction said "keep execution unblocked, proceed agentically"
    // while tools were simultaneously suppressed (modeSource=fallback → tools=[]).
    // The contradiction made the model attempt implicit tool calls through the provider,
    // causing search loops. Now we explicitly tell it to answer from the buffer first.
    return `Mode metadata is unavailable: inferred intent is ${getCtxChatModeLabel(effectiveMode)}. Prioritize answering from the CtxPack context. Only invoke tools when the buffer clearly lacks the information needed to answer the request.`;
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
  // FIX: use a `null` sentinel to distinguish "let the model manage tools natively"
  // from "explicitly pass no tools". Previously, passing `undefined` for the tools
  // parameter omitted the key entirely from the request options — the VS Code / Copilot
  // API then defaulted to forwarding ALL available tools implicitly, causing the model
  // to invoke searches and file reads even when we wanted zero tool access (e.g. when
  // modeSource === "fallback" or mode === "plan"). Passing `tools: []` explicitly tells
  // the provider the caller has intentionally disabled tool access for this request.
  //
  //   null  → omit the tools key (model-managed, only used in the tool-limit retry path)
  //   []    → pass tools: [] explicitly (blocks implicit provider-side tool injection)
  //   [...] → explicit curated tool list
  const sendRequest = (explicitTools: readonly vscode.LanguageModelToolInformation[] | null) =>
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
        ...(explicitTools !== null ? { tools: explicitTools } : {}),
        extensionMode,
      },
      token
    );

  const hasExplicitTools = tools.length > 0;
  // Pass tools explicitly — use [] when none are selected so implicit tool access is blocked.
  const firstAttempt = sendRequest(hasExplicitTools ? tools : []);

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
    // null = omit tools key entirely so the provider falls back to its native tool management.
    const fallbackRequest = sendRequest(null);

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
    `CtxPack is running in ${modeLabel} mode, but there are no buffered slots yet.`,
    "",
    "**How to use the extension**",
    "1. Add context to the buffer:",
    "   - `CtxPack: Push selection to buffer`",
    "   - `CtxPack: Push entire file to buffer`",
    "   - `CtxPack: Push file or directory to buffer`",
    "   - `CtxPack: Generate semantic pack and push to buffer`",
    "2. (Optional) Scope what dynamic injection uses with `CtxPack: Choose active slots for dynamic context`.",
    "3. Send your prompt normally and CtxPack will inject the selected slots into the chat.",
    "",
    "**About the @ctx command**",
    "The `@ctx` participant is available for asking questions or getting suggestions about CtxPack itself.",
    "You do NOT need `@ctx` prefix for normal prompts—context injection happens automatically.",
    "Use `@ctx` when you need help understanding how to use CtxPack or debugging buffer issues.",
    "",
    "**Quick workflow**",
    "Use `CtxPack: Open context workflow wizard` from the Command Palette to run the full flow step by step.",
  ].join("\n");
}
