import * as vscode from "vscode";
import * as chatUtils from "@vscode/chat-extension-utils";
import { ContextRingBuffer } from "./ContextRingBuffer";
import { getCtxChatModeLabel, resolveCtxChatMode } from "./WorkspacePackBuilder";

interface ChatRequestModeInfo {
  modeInstructions2?: {
    name: string;
    content: string;
  };
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  buffer: ContextRingBuffer
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    "ctxpack.assistant",
    async (request, chatContext, stream, token) => {
      const requestWithMode = request as vscode.ChatRequest & ChatRequestModeInfo;
      const chatMode = resolveCtxChatMode(requestWithMode.modeInstructions2?.name);
      const scopeLabel = buffer.chatScopeSummary(chatMode);
      const modeLabel = getCtxChatModeLabel(chatMode);
      const contextTokenBudget = getContextTokenBudget(request.model.maxInputTokens);
      const promptContext = buffer.buildPromptContext(chatMode, contextTokenBudget);
      const omittedSummary = promptContext.omittedTags.length
        ? `Omitted slots because of prompt budget: ${promptContext.omittedTags.join(", ")}.`
        : "";
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
            tools: vscode.lm.tools,
            extensionMode: context.extensionMode,
          },
          token
        );

        return await libResult.result;
      } catch (err) {
        if (token.isCancellationRequested) {
          return;
        }
        if (err instanceof vscode.LanguageModelError) {
          stream.markdown(`Model error: ${err.message}`);
          return;
        }
        stream.markdown("Failed to query the language model.");
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
