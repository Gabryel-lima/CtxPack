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

// ---------------------------------------------------------------------------
// Participant registration
// ---------------------------------------------------------------------------

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  buffer: ContextRingBuffer,
  onInjectionSnapshot?: (snapshot: CtxInjectionSnapshot) => void
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    "ctxpack.assistant",
    async (request, chatContext, stream, token) => {
      if (request.command === "run") {
        // Força modo agent: execução com tools
        return await handleInjectionMode(
          request,
          chatContext,
          stream,
          token,
          buffer,
          context,
          onInjectionSnapshot,
          /*forceAgent*/ true
        );
      }

      // Advisor mode only for empty prompt or empty buffer.
      const advisorResult = await handleAdvisorMode(
        request,
        stream,
        buffer,
        onInjectionSnapshot
      );
      if (advisorResult) {
        return advisorResult;
      }

      // Modo injection padrão: sempre injeta contexto e responde
      return await handleInjectionMode(
        request,
        chatContext,
        stream,
        token,
        buffer,
        context,
        onInjectionSnapshot
      );
    }
  );

  participant.iconPath = new vscode.ThemeIcon("database");
  context.subscriptions.push(participant);
  return participant;
}

async function handleAdvisorMode(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  buffer: ContextRingBuffer,
  onInjectionSnapshot?: (snapshot: CtxInjectionSnapshot) => void
): Promise<vscode.ChatResult | undefined> {
  const slots = buffer.listSlots();
  const totalTokens = buffer.totalTokenEstimate();
  const tokenK = (totalTokens / 1000).toFixed(1);
  const prompt = request.prompt.trim();
  // Só entra no modo advisor se buffer está vazio ou prompt está vazio
  if (slots.length > 0 && prompt.length > 0) {
    // Não é advisor, deve ser handled pelo modo injection
    return undefined;
  }

  // Snapshot so the status bar and extension UI always update even in advisor mode.
  const advisorSnapshot = (
    status: CtxInjectionSnapshot["status"],
    correlations: Array<{ tag: string; score: number; matchedTerms: string[] }> = []
  ): void => {
    onInjectionSnapshot?.({
      modeLabel: "Advisor",
      modeSource: "fallback",
      scopeLabel: slots.length > 0 ? `${slots.length} slot(s) in buffer` : "empty",
      usedTags: [],
      bufferAttached: false,
      omittedTags: [],
      correlatedSlots: correlations,
      estimatedTokens: 0,
      tokenBudget: 0,
      forwardedToolsCount: 0,
      availableToolsCount: 0,
      status,
    });
  };

  advisorSnapshot("reading");

  if (slots.length === 0) {
    stream.markdown(buildEmptyBufferGuide("Advisor"));
    advisorSnapshot("sent");
    return { metadata: { source: "ctxpack-advisor-empty" } };
  }

  // Correlate the prompt against all slot content only when there is a real query.
  const allContent = slots.map((s) => `### [${s.tag}]\n${s.content}`).join("\n\n");
  const correlations = prompt.length >= 3
    ? correlateSlotsWithPrompt(prompt, allContent)
    : [];

  advisorSnapshot("correlating", correlations);

  const correlationMap = new Map(correlations.map((c) => [c.tag, c]));

  // Sort slots by relevance (highest first) when the user typed a prompt.
  const sortedSlots = correlations.length > 0
    ? [...slots].sort((a, b) => {
        const sa = correlationMap.get(a.tag)?.score ?? 0;
        const sb = correlationMap.get(b.tag)?.score ?? 0;
        return sb - sa;
      })
    : slots;

  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push("### CtxPack — Buffer Advisor");
  lines.push("");
  lines.push(
    `> **Buffer:** ${slots.length} slot(s) &nbsp;·&nbsp; ~${tokenK}k tokens` +
    `&nbsp;·&nbsp; Scope: ${buffer.chatScopeSummary("ask")}`
  );
  lines.push("");

  // ── Slot table ────────────────────────────────────────────────────────────
  lines.push("**Buffered slots**");
  lines.push("");
  lines.push("| # | Slot | ~Tokens | Relevance | Active (ask · plan · agent) |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (let i = 0; i < sortedSlots.length; i++) {
    const slot = sortedSlots[i];
    const corr = correlationMap.get(slot.tag);
    const relevanceCell = corr
      ? `${"█".repeat(Math.max(1, Math.round(corr.score * 5)))} ${Math.round(corr.score * 100)}%`
      : "—";

    const activeAsk   = buffer.listActiveTags("ask").includes(slot.tag)   ? "✓" : "—";
    const activePlan  = buffer.listActiveTags("plan").includes(slot.tag)  ? "✓" : "—";
    const activeAgent = buffer.listActiveTags("agent").includes(slot.tag) ? "✓" : "—";

    lines.push(
      `| ${i + 1} | \`${slot.tag}\` | ~${slot.tokenEstimate} | ${relevanceCell} | ${activeAsk} · ${activePlan} · ${activeAgent} |`
    );
  }

  lines.push("");

  // ── Correlation detail ────────────────────────────────────────────────────
  if (correlations.length > 0) {
    const topTerms = correlations
      .flatMap((c) => c.matchedTerms)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 8);

    lines.push(`**Matched terms:** \`${topTerms.join("` · `")}\``);
    lines.push("");
    lines.push("**Recommendations**");
    lines.push("");

    const top = correlations[0];
    lines.push(`- Activate **\`${top.tag}\`** — highest relevance (${Math.round(top.score * 100)}%) for this prompt.`);

    if (correlations.length > 1) {
      const others = correlations.slice(1).map((c) => `\`${c.tag}\``).join(", ");
      lines.push(`- Also relevant: ${others}`);
    }

    const irrelevant = slots.filter((s) => !correlationMap.has(s.tag));
    if (irrelevant.length > 0) {
      lines.push(
        `- Consider deactivating ${irrelevant.map((s) => `\`${s.tag}\``).join(", ")} — no term overlap with this prompt.`
      );
    }

    lines.push("- Run **`CtxPack: Choose active slots`** to scope the injection to the relevant slots.");
  } else if (prompt.length >= 3) {
    lines.push("> No lexical overlap found between your prompt and the buffered slots.");
    lines.push(
      "> Consider pushing more targeted context via **`CtxPack: Push selection to buffer`**."
    );
  }

  lines.push("");
  lines.push("---");
  lines.push(
    "*Use **`@ctx [question]`** to get an answer with the current buffer injected into the model. " +
    "Use **`@ctx /run [action]`** to force agentic execution with tools. " +
    "Use **`CtxPack: Choose active slots`** to control which slots are forwarded.*"
  );

  stream.markdown(lines.join("\n"));
  advisorSnapshot("sent", correlations);

  return { metadata: { source: "ctxpack-advisor" } };
}

async function handleInjectionMode(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  buffer: ContextRingBuffer,
  context: vscode.ExtensionContext,
  onInjectionSnapshot?: (snapshot: CtxInjectionSnapshot) => void,
  forceAgent?: boolean
): Promise<vscode.ChatResult | undefined> {
  if (!request.prompt.trim()) {
    stream.markdown(
      "**CtxPack** — provide a prompt to continue.\n\n" +
      "Examples:\n" +
      "- `@ctx explain the auth flow`\n" +
      "- `@ctx /run refactor auth module and apply the patch`"
    );
    return { metadata: { source: "ctxpack-empty-prompt" } };
  }

  let modeResolution  = resolveCtxChatModeFromRequest(request, chatContext);
  let effectiveMode   = resolveEffectiveMode(modeResolution.mode, request, chatContext);
  if (forceAgent) {
    modeResolution = { mode: "agent", source: "request" };
    effectiveMode = "agent";
  }
  const modeLabel       = buildModeLabel(modeResolution, effectiveMode);
  const availableTools  = vscode.lm.tools;
  const forwardedTools  = selectToolsForModel(request.model, availableTools, effectiveMode, modeResolution.source);
  const debugRouting = vscode.workspace
    .getConfiguration("ctxpack")
    .get<boolean>("debugPromptRouting", false);

  if (debugRouting) {
    console.log("[CtxPack] prompt-routing", {
      commandTriggered: request.command ?? "none",
      mode: effectiveMode,
      modeSource: modeResolution.source,
      prompt: request.prompt,
      toolsEnabled: forwardedTools.length > 0,
      forwardedToolsCount: forwardedTools.length,
      availableToolsCount: availableTools.length,
      model: describeModel(request.model),
    });
  }

  const contextTokenBudget = getContextTokenBudget(request.model?.maxInputTokens);
  const globalActiveTags   = buffer.listActiveTagsAnyMode();
  const hasGlobalSelection = globalActiveTags.length > 0;
  const scopeLabel = hasGlobalSelection
    ? `selected (all modes): ${globalActiveTags.join(", ")}`
    : buffer.chatScopeSummary(effectiveMode);

  const slots      = buffer.listSlots();
  const totalTokens = buffer.totalTokenEstimate();
  const tokenK     = (totalTokens / 1000).toFixed(1);

  const baseSnapshot: CtxInjectionSnapshot = {
    modeLabel,
    modeSource:           modeResolution.source,
    scopeLabel,
    usedTags:             [],
    bufferAttached:       false,
    omittedTags:          [],
    correlatedSlots:      [],
    estimatedTokens:      0,
    tokenBudget:          contextTokenBudget,
    forwardedToolsCount:  forwardedTools.length,
    availableToolsCount:  availableTools.length,
    status:               "ready",
  };

  onInjectionSnapshot?.(baseSnapshot);

  // ── Agent action-log messages ─────────────────────────────────────────────
  // These appear as spinning entries in the VS Code Copilot chat action-log
  // panel while the participant processes the request. They explicitly name
  // CtxPack so the user always sees that the model is reading from the buffer.

  stream.progress(
    `CtxPack: loading ${slots.length} slot(s) (~${tokenK}k tokens) from buffer [${modeLabel}]`
  );
  onInjectionSnapshot?.({ ...baseSnapshot, status: "reading" });

  const promptContext = hasGlobalSelection
    ? buffer.buildPromptContextForTags(globalActiveTags, contextTokenBudget)
    : buffer.buildPromptContext(effectiveMode, contextTokenBudget);

  const correlations = correlateSlotsWithPrompt(request.prompt, promptContext.content);

  const topTermsPreview = correlations
    .flatMap((c) => c.matchedTerms)
    .slice(0, 4)
    .join(", ");
  const correlationNote = correlations.length > 0
    ? `${correlations.length} relevant slot(s) — ${topTermsPreview}`
    : "no strong term overlap";

  stream.progress(`CtxPack: correlating prompt → ${correlationNote}`);
  onInjectionSnapshot?.({ ...baseSnapshot, status: "correlating", correlatedSlots: correlations });

  if (slots.length === 0) {
    stream.markdown(buildEmptyBufferGuide(modeLabel));
    onInjectionSnapshot?.({ ...baseSnapshot, status: "sent" });
    return { metadata: { source: "ctxpack-empty-buffer" } };
  }

  const usedCount   = promptContext.usedTags.length;
  const budgetK     = (contextTokenBudget / 1000).toFixed(1);

  stream.progress(
    `CtxPack: forwarding ${usedCount} slot(s) (~${promptContext.estimatedTokens} / ~${budgetK}k tokens) to model`
  );

  // ── Compact injection badge ───────────────────────────────────────────────
  // Replaces the old multi-line injection report. One blockquote line with
  // the slot list below, scannable at a glance.
  const omittedSuffix = promptContext.omittedTags.length > 0
    ? ` · ⚠ omitted: ${promptContext.omittedTags.map((t) => `\`${t}\``).join(", ")} (budget)`
    : "";

  stream.markdown(
    buildInjectionBadge(
      promptContext.usedTags,
      promptContext.estimatedTokens,
      contextTokenBudget,
      modeLabel,
      omittedSuffix
    )
  );

  if (correlations.length > 0) {
    stream.markdown(buildCompactCorrelationTable(correlations));
  }

  // ── Build context block and model prompt ──────────────────────────────────
  const omittedBlock = promptContext.omittedTags.length > 0
    ? `Omitted slots (budget exceeded): ${promptContext.omittedTags.join(", ")}.`
    : "";

  const contextBlock = promptContext.content
    ? [
        `[CTXPACK CONTEXT | mode: ${modeLabel} | scope: ${scopeLabel}]`,
        `Injected slots: ${promptContext.usedTags.join(", ")}.`,
        `Estimated tokens: ~${promptContext.estimatedTokens}.`,
        omittedBlock,
        "Read the CtxPack context before answering. Treat it as primary workspace evidence.",
        "If the answer depends on the buffer, ground your response in the injected slots.",
        "If the buffer lacks sufficient information, state that clearly then use tools or general reasoning.",
        "",
        promptContext.content,
      ]
        .filter(Boolean)
        .join("\n\n")
    : `[CTXPACK CONTEXT | mode: ${modeLabel} | scope: empty]\n\nNo buffered context is active for this mode.`;

  const modelPrompt = [
    "You are the CtxPack assistant for VS Code.",
    `Current chat mode: ${modeLabel}.`,
    "Respect the current Copilot chat mode when available.",
    getModeBehaviorInstruction(modeResolution.mode, effectiveMode),
    "Treat the CtxPack buffer as grounded workspace evidence. Read it first, answer from it directly when possible.",
    "Only invoke tools when the CtxPack buffer does not contain enough information. Do not search or read files already represented in the buffer.",
    "IMPORTANT: Do NOT call the `skill`, `task_complete`, `memory`, or `vscode_askQuestions` tools. These are internal Copilot assistant tools and are not available in this context. Calling them will produce an error.",
    contextBlock,
  ].join("\n\n");

  const updatedSnapshot: CtxInjectionSnapshot = {
    ...baseSnapshot,
    usedTags:        promptContext.usedTags,
    bufferAttached:  promptContext.usedTags.length > 0,
    omittedTags:     promptContext.omittedTags,
    correlatedSlots: correlations,
    estimatedTokens: promptContext.estimatedTokens,
  };

  try {
    const result = await sendWithToolFallback(
      request, chatContext, stream, token,
      modelPrompt, forwardedTools, context.extensionMode,
      forceAgent
    );

    stream.progress(`CtxPack: injection complete — ${usedCount} slot(s) used`);
    onInjectionSnapshot?.({ ...updatedSnapshot, status: "sent" });
    return result;
  } catch (err) {
    if (token.isCancellationRequested) {
      stream.progress("CtxPack: request cancelled");
      onInjectionSnapshot?.({ ...updatedSnapshot, status: "error", errorMessage: "Request cancelled" });
      return;
    }
    if (err instanceof vscode.LanguageModelError) {
      stream.progress(`CtxPack: model error — ${err.message}`);
      onInjectionSnapshot?.({ ...updatedSnapshot, status: "error", errorMessage: err.message });
      stream.markdown(`\n\n**Model error:** ${err.message}`);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    stream.progress(`CtxPack: request failed — ${msg}`);
    onInjectionSnapshot?.({ ...updatedSnapshot, status: "error", errorMessage: msg });
    stream.markdown(`\n\n**CtxPack error:** ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// UI builders
// ---------------------------------------------------------------------------

/**
 * Compact blockquote badge shown at the top of every participant response.
 * Replaces the old multi-line injection report wall of text.
 *
 * Renders as:
 *   > CtxPack · 2 slot(s) · ~1.8k / 2.5k tokens · Ask mode
 *   > `slot-a` · `slot-b`
 */
function buildInjectionBadge(
  usedTags: string[],
  estimatedTokens: number,
  tokenBudget: number,
  modeLabel: string,
  omittedSuffix: string
): string {
  const tagLine = usedTags.length > 0
    ? usedTags.map((t) => `\`${t}\``).join(" · ")
    : "_no slots attached_";

  return (
    `> **CtxPack** · ${usedTags.length} slot(s) · ~${estimatedTokens} / ${tokenBudget} tokens · ${modeLabel}${omittedSuffix}\n` +
    `> ${tagLine}\n`
  );
}

/**
 * Compact relevance table. Only shown when the prompt has term overlap with slots.
 */
function buildCompactCorrelationTable(
  correlations: Array<{ tag: string; score: number; matchedTerms: string[] }>
): string {
  const lines = [
    "| Slot | Relevance | Matched terms |",
    "| --- | --- | --- |",
  ];
  for (const item of correlations) {
    const pct  = Math.round(item.score * 100);
    const bars = "█".repeat(Math.max(1, Math.round(item.score * 5)));
    lines.push(`| \`${item.tag}\` | ${bars} ${pct}% | ${item.matchedTerms.join(", ")} |`);
  }
  return lines.join("\n") + "\n";
}

function buildEmptyBufferGuide(modeLabel: string): string {
  return [
    "**CtxPack — buffer is empty**",
    "",
    `Running in **${modeLabel}** mode, mas nenhum slot está no buffer.`,
    "",
    "**Adicione contexto ao buffer:**",
    "- `CtxPack: Push selection to buffer`",
    "- `CtxPack: Push entire file to buffer`",
    "- `CtxPack: Push file or directory to buffer`",
    "- `CtxPack: Generate semantic pack and push to buffer`",
    "",
    "**Usando @ctx:**",
    "- `@ctx [mensagem]` — injeta contexto e responde (modo padrão)",
    "- `@ctx /run [ação]` — executa ação agentica com tools e contexto do buffer",
    "- `CtxPack: Open context workflow wizard` — fluxo guiado passo a passo",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Mode resolution helpers
// ---------------------------------------------------------------------------

function getContextTokenBudget(modelMaxInputTokens: number | undefined): number {
  if (!modelMaxInputTokens || !Number.isFinite(modelMaxInputTokens)) {
    return 2500;
  }
  return Math.max(700, Math.min(5000, Math.floor(modelMaxInputTokens * 0.3)));
}

function buildModeLabel(
  mode: { mode: CtxResolvedChatMode; source: "request" | "context" | "fallback" },
  effectiveMode: CtxChatMode
): string {
  const resolvedLabel = getCtxChatModeDisplay(mode);
  if (mode.mode !== "auto") {
    return resolvedLabel;
  }
  return `${resolvedLabel} → ${getCtxChatModeLabel(effectiveMode)} (intent)`;
}

function resolveEffectiveMode(
  mode: CtxResolvedChatMode,
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): CtxChatMode {
  if (mode !== "auto") {
    return mode;
  }
  return inferIntentMode(request, chatContext);
}

function inferIntentMode(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): CtxChatMode {
  if (request.toolReferences.length > 0) {
    return "agent";
  }

  const signalText = collectIntentSignals(request, chatContext).join(" ").toLowerCase();

  if (/(set\s*agent|modo\s*agent|agent\s*mode|ativar\s*agent|trocar\s*para\s*agent)/u.test(signalText)) {
    return "agent";
  }
  if (/(pick\s*model|choose\s*model|select\s*model|escolher\s*modelo|selecionar\s*modelo|trocar\s*modelo)/u.test(signalText)) {
    return "ask";
  }
  if (/(\bplan\b|\bplano\b|arquitetura|roadmap|estrat[eé]gia|passo\s*a\s*passo|sequ[êe]ncia)/u.test(signalText)) {
    return "plan";
  }
  if (/(implemente|implement|corrija|fix|refatore|refactor|edite|edit|execute|rode|run|crie|fa[çc]a|apply|patch|rename|renomeie|rename\s+all|substitua|replace|modifique|modify|change\s+all|gera\s*c[oó]digo)/u.test(signalText)) {
    return "agent";
  }
  if (/(\?|como\b|what\b|why\b|qual\b|quais\b|explique|explain|resuma|summari[sz]e)/u.test(signalText)) {
    return "ask";
  }

  // Conservative default — avoids unexpected tool loops on unclassified prompts.
  return "ask";
}

function collectIntentSignals(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): string[] {
  const parts: string[] = [request.prompt, request.command ?? ""];

  for (const reference of request.references) {
    if (reference.modelDescription) {
      parts.push(reference.modelDescription);
    }
  }

  for (const turn of chatContext.history.slice(-6)) {
    if (isRecord(turn)) {
      const prompt  = "prompt"  in turn ? asString(turn.prompt)  : undefined;
      const command = "command" in turn ? asString(turn.command) : undefined;
      if (prompt)  { parts.push(prompt); }
      if (command) { parts.push(command); }

      const response = "response" in turn ? turn.response : undefined;
      if (Array.isArray(response)) {
        for (const part of response) {
          if (!isRecord(part)) { continue; }
          const commandValue = isRecord(part.value) ? part.value : undefined;
          const title = commandValue ? asString(commandValue.title) : undefined;
          if (title) { parts.push(title); }
        }
      }
    }
  }

  return parts.filter((v) => v.trim().length > 0);
}

function getModeBehaviorInstruction(
  mode: CtxResolvedChatMode,
  effectiveMode: CtxChatMode
): string {
  if (mode === "auto") {
    return (
      `Mode metadata is unavailable: inferred intent is ${getCtxChatModeLabel(effectiveMode)}. ` +
      "Prioritize answering from the CtxPack context. Only invoke tools when the buffer clearly lacks the information needed."
    );
  }
  if (mode === "agent") {
    return (
      "In Agent mode (/run), you MUST apply changes directly to workspace files using the available editing tools. " +
      "Do NOT describe or suggest changes in text — execute them with tools. " +
      "After completing the task, briefly report what was done."
    );
  }
  if (mode === "plan") {
    return "In Plan mode, prioritize planning and sequencing over direct execution unless the user explicitly asks to act.";
  }
  if (mode === "ask") {
    return "In Ask mode, answer directly first. Do not block tool usage or edits when the user explicitly requests them.";
  }
  return "Infer intent from the latest user prompt and history. Use tools only when the buffer lacks sufficient context.";
}

// ---------------------------------------------------------------------------
// Tool selection
// ---------------------------------------------------------------------------

// Tools that are internal to the Copilot assistant layer and must never be
// forwarded to a participant-scoped model request. Forwarding them causes the
// model to call e.g. skill("troubleshoot") which fails with "Skill not found".
const BLOCKED_META_TOOLS = new Set([
  "skill",
  "task_complete",
  "memory",
  "vscode_askQuestions",
]);

function shouldForwardToolsForMode(mode: CtxChatMode): boolean {
  return mode === "agent" || mode === "ask";
}

function getToolLimitFromModel(model: vscode.LanguageModelChat | undefined): number {
  if (!model) { return 0; }
  // Conservative ceiling — provider-side limit not exposed in this API version.
  return 48;
}

function selectToolsForModel(
  model: vscode.LanguageModelChat | undefined,
  tools: readonly vscode.LanguageModelToolInformation[],
  mode: CtxChatMode,
  modeSource: "request" | "context" | "fallback"
): vscode.LanguageModelToolInformation[] {
  if (tools.length === 0)            { return []; }
  if (modeSource === "fallback" && mode !== "agent") { return []; }
  if (!shouldForwardToolsForMode(mode)) { return []; }

  const modeLimit = mode === "agent" ? 48 : 24;
  const limit = Math.min(modeLimit, getToolLimitFromModel(model));
  if (limit <= 0) { return []; }

  const eligible = [...tools].filter((t) => !BLOCKED_META_TOOLS.has(t.name));
  return eligible.length <= limit ? eligible : eligible.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Request sender with tool-limit retry
// ---------------------------------------------------------------------------

async function sendWithToolFallback(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  prompt: string,
  tools: readonly vscode.LanguageModelToolInformation[],
  extensionMode: vscode.ExtensionMode,
  isForceAgent?: boolean
): Promise<vscode.ChatResult> {
  // Sentinel contract:
  //   null  → omit the tools key (model-managed, only used in the retry path)
  //   []    → pass tools: [] explicitly (blocks implicit provider-side tool injection)
  //   [...] → explicit curated list
  const sendRequest = (explicitTools: readonly vscode.LanguageModelToolInformation[] | null) =>
    chatUtils.sendChatParticipantRequest(
      request,
      chatContext,
      {
        prompt,
        responseStreamOptions: { stream, references: true, responseText: true },
        ...(explicitTools !== null ? { tools: explicitTools } : {}),
        extensionMode,
      },
      token
    );

  const hasExplicitTools = tools.length > 0;
  // Pass [] when no tools are selected to block implicit provider-side tool access.
  const firstAttempt = sendRequest(hasExplicitTools ? tools : []);

  // Agent mode (/run) gets a much longer first-attempt window so complex multi-step
  // edits have time to complete without triggering the null-tool fallback (which
  // causes the model to suggest rather than apply edits).
  const firstTimeout = isForceAgent ? 300_000 : (hasExplicitTools ? 90_000 : 180_000);

  try {
    return await awaitWithTimeout(
      firstAttempt.result,
      firstTimeout,
      "CtxPack request timed out."
    );
  } catch (error) {
    // In forced agent mode (/run), never fall back to provider-managed tools on timeout:
    // doing so strips the file-editing tools and causes the model to suggest edits
    // instead of applying them. Re-throw so the user gets an explicit error.
    if (isForceAgent && isTimeoutError(error)) { throw error; }

    const shouldRetry =
      hasExplicitTools && (isToolCountLimitError(error) || isTimeoutError(error));
    if (!shouldRetry) { throw error; }

    const note = isToolCountLimitError(error)
      ? "CtxPack: tool list exceeded model limit — retrying with model-managed tools."
      : "CtxPack: request timed out with explicit tools — retrying with model-managed tools.";
    stream.markdown(`\n\n_${note}_`);

    // null = omit tools key so the provider falls back to its own tool management.
    const fallback = sendRequest(null);
    return await awaitWithTimeout(
      fallback.result,
      180_000,
      "CtxPack request timed out after tool fallback."
    );
  }
}

// ---------------------------------------------------------------------------
// Correlation helpers
// ---------------------------------------------------------------------------

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
    sections.push({ tag: match[1].trim(), body: match[2].trim() });
  }
  return sections;
}

function correlateSlotsWithPrompt(
  prompt: string,
  promptContextContent: string
): Array<{ tag: string; score: number; matchedTerms: string[] }> {
  const promptTerms = new Set(tokenizeForCorrelation(prompt));
  if (promptTerms.size === 0) { return []; }

  const sections = parseSlotSections(promptContextContent);
  const result: Array<{ tag: string; score: number; matchedTerms: string[] }> = [];

  for (const section of sections) {
    const slotTerms   = new Set(tokenizeForCorrelation(section.body));
    const matchedTerms = [...promptTerms].filter((t) => slotTerms.has(t)).slice(0, 6);
    if (matchedTerms.length === 0) { continue; }

    const rawScore = matchedTerms.length / Math.max(1, Math.min(promptTerms.size, 12));
    result.push({
      tag: section.tag,
      score: Math.min(1, Number(rawScore.toFixed(2))),
      matchedTerms,
    });
  }

  return result.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        handle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (handle) { clearTimeout(handle); }
  }
}

function isTimeoutError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /timed out/i.test(msg);
}

function isToolCountLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /cannot have more than\s+\d+\s+tools per request/i.test(msg);
}

function describeModel(model: vscode.LanguageModelChat | undefined): string {
  if (!model) {
    return "unknown";
  }

  const raw = model as unknown as {
    id?: string;
    name?: string;
    vendor?: string;
    family?: string;
    version?: string;
  };

  const parts = [raw.id, raw.name, raw.vendor, raw.family, raw.version]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  return parts.length > 0 ? parts.join("/") : "unknown";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
