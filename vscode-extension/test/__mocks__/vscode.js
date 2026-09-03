// Minimal runtime stub for the "vscode" module, used only so that Jest can
// `require` source files (like ChatParticipant.ts) which import * as vscode
// purely for types and API calls inside functions that these tests never
// invoke. Type-checking still uses the real @types/vscode declarations —
// this file only needs to exist so the module resolves at runtime.
class CancellationTokenSource {
  constructor() {
    this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  }
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {}
}

module.exports = { CancellationTokenSource };
