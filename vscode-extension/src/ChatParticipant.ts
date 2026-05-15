import * as vscode from "vscode";
import { ContextRingBuffer } from "./ContextRingBuffer";

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  buffer: ContextRingBuffer
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    "ctxpack.assistant",
    async (request, _chatContext, stream, token) => {
      const injectedContext = buffer.flush();
      const scopeLabel = buffer.chatScopeSummary();

      const systemBlock = injectedContext
        ? `[CTXPACK SESSION CONTEXT | scope: ${scopeLabel}]\n\n${injectedContext}\n\n---`
        : "[No accumulated context. Use CtxPack commands such as 'Push selection to buffer' or run ctxpack.py with --push to feed the buffer.]";

      const models = await vscode.lm.selectChatModels({
        vendor: "copilot",
        family: "gpt-4o",
      });

      const model = models[0];
      if (!model) {
        stream.markdown("Copilot model is not available.");
        return;
      }

      const messages = [
        vscode.LanguageModelChatMessage.User(systemBlock),
        vscode.LanguageModelChatMessage.User(request.prompt),
      ];

      try {
        const response = await model.sendRequest(messages, {}, token);
        for await (const chunk of response.text) {
          stream.markdown(chunk);
        }
      } catch (err) {
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
