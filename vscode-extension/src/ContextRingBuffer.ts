export interface ContextSlot {
  tag: string;
  content: string;
  tokenEstimate: number;
  timestamp: number;
}

export interface PromptContextPayload {
  content: string;
  usedTags: string[];
  omittedTags: string[];
  estimatedTokens: number;
}

type ChatModeKey = "ask" | "plan" | "agent";

/**
 * FIFO buffer based on token estimation for session context.
 */
export class ContextRingBuffer {
  private slots: ContextSlot[] = [];

  private activeTagsByMode: Record<ChatModeKey, Set<string>> = {
    ask: new Set<string>(),
    plan: new Set<string>(),
    agent: new Set<string>(),
  };

  private readonly maxTokens: number;

  constructor(maxTokens = 8000) {
    this.maxTokens = Math.max(1, Math.floor(maxTokens));
  }

  /**
   * Adds a new slot to the end of the buffer and removes older ones if needed.
   */
  public push(tag: string, content: string): void {
    const safeTag = tag.trim() || "ctxpack";
    let safeContent = content;
    let newTokens = this.estimateTokens(safeContent);

    if (newTokens > this.maxTokens) {
      safeContent = `${safeContent.slice(0, this.maxTokens * 4)}\n[... truncated by buffer ...]`;
      newTokens = this.estimateTokens(safeContent);
    }

    while (this.slots.length > 0 && this.totalTokens() + newTokens > this.maxTokens) {
      const removed = this.slots.shift();
      if (removed) {
        this.deleteTagFromModes(removed.tag);
      }
    }

    this.slots.push({
      tag: safeTag,
      content: safeContent,
      tokenEstimate: newTokens,
      timestamp: Date.now(),
    });
  }

  /**
   * Returns the full formatted context for chat injection.
   */
  public flush(mode: ChatModeKey = "ask"): string {
    const slots = this.getSlotsForChat(mode);
    if (slots.length === 0) {
      return "";
    }

    return slots
      .map((slot) => `### [${slot.tag}]\n${slot.content}`)
      .join("\n\n");
  }

  /**
   * Builds a prompt-oriented payload that fits inside a token budget.
   * More recent slots are prioritized when the budget is tight.
   */
  public buildPromptContext(mode: ChatModeKey = "ask", maxTokensBudget = this.maxTokens): PromptContextPayload {
    const slots = this.getSlotsForChat(mode);
    if (slots.length === 0 || maxTokensBudget <= 0) {
      return {
        content: "",
        usedTags: [],
        omittedTags: [],
        estimatedTokens: 0,
      };
    }

    const included: ContextSlot[] = [];
    const omittedTags: string[] = [];
    let remaining = Math.max(1, Math.floor(maxTokensBudget));

    for (let index = slots.length - 1; index >= 0; index -= 1) {
      const slot = slots[index];
      if (slot.tokenEstimate <= remaining) {
        included.unshift(slot);
        remaining -= slot.tokenEstimate;
        continue;
      }

      if (included.length === 0) {
        const truncated = this.truncateSlotToBudget(slot, remaining);
        included.unshift(truncated);
        remaining = 0;
      } else {
        omittedTags.unshift(slot.tag);
      }
    }

    const content = included.map((slot) => `### [${slot.tag}]\n${slot.content}`).join("\n\n");
    return {
      content,
      usedTags: included.map((slot) => slot.tag),
      omittedTags,
      estimatedTokens: this.estimateTokens(content),
    };
  }

  /**
   * Removes all stored slots.
   */
  public clear(): void {
    this.slots = [];
    this.clearActiveTags("all");
  }

  /**
   * Returns a string with slot count and estimated tokens.
   */
  public status(): string {
    const total = this.totalTokens();
    const totalK = (total / 1000).toFixed(1);
    const scopedModes = this.listModes().filter((mode) => this.hasActiveSelection(mode)).length;
    const activeSuffix = scopedModes > 0 ? ` | scoped ${scopedModes}/3 modes` : " | active all";
    return `${this.slots.length} slots | ~${totalK}k tokens${activeSuffix}`;
  }

  /**
   * Finds the first slot by exact tag.
   */
  public findByTag(tag: string): ContextSlot | undefined {
    return this.slots.find((slot) => slot.tag === tag);
  }

  /**
   * Returns a shallow copy of the slots for external reads.
   */
  public listSlots(): ContextSlot[] {
    return [...this.slots];
  }

  /**
   * Replaces the content of an existing tag without changing its FIFO position.
   */
  public replaceByTag(tag: string, content: string): boolean {
    const index = this.slots.findIndex((slot) => slot.tag === tag);
    if (index < 0) {
      return false;
    }

    let nextContent = content;
    let nextTokens = this.estimateTokens(nextContent);

    if (nextTokens > this.maxTokens) {
      nextContent = `${nextContent.slice(0, this.maxTokens * 4)}\n[... truncated by buffer ...]`;
      nextTokens = this.estimateTokens(nextContent);
    }

    this.slots[index] = {
      ...this.slots[index],
      content: nextContent,
      tokenEstimate: nextTokens,
      timestamp: Date.now(),
    };

    while (this.totalTokens() > this.maxTokens && this.slots.length > 1) {
      const oldestIndex = this.oldestIndexExcluding(index);
      if (oldestIndex < 0) {
        break;
      }
      const removed = this.slots.splice(oldestIndex, 1)[0];
      if (removed) {
        this.deleteTagFromModes(removed.tag);
      }
    }

    if (this.totalTokens() > this.maxTokens && this.slots.length === 1) {
      const only = this.slots[0];
      const clamped = `${only.content.slice(0, this.maxTokens * 4)}\n[... truncated by buffer ...]`;
      this.slots[0] = {
        ...only,
        content: clamped,
        tokenEstimate: this.estimateTokens(clamped),
      };
    }

    return true;
  }

  /**
   * Removes the first slot with the given tag.
   */
  public removeByTag(tag: string): boolean {
    const index = this.slots.findIndex((slot) => slot.tag === tag);
    if (index < 0) {
      return false;
    }

    this.slots.splice(index, 1);
    this.deleteTagFromModes(tag);
    return true;
  }

  /**
   * Marks a subset of tags as active for chat injection.
   */
  public setActiveTags(tags: string[], mode: ChatModeKey | "all" = "all"): void {
    const validTags = new Set(this.slots.map((slot) => slot.tag));
    const nextTags = new Set(tags.filter((tag) => validTags.has(tag)));
    for (const targetMode of this.resolveModes(mode)) {
      this.activeTagsByMode[targetMode] = new Set(nextTags);
    }
  }

  /**
   * Clears the active selection so chat uses the whole buffer again.
   */
  public clearActiveTags(mode: ChatModeKey | "all" = "all"): void {
    for (const targetMode of this.resolveModes(mode)) {
      this.activeTagsByMode[targetMode].clear();
    }
  }

  /**
   * Returns the tags that are currently active for chat injection.
   */
  public listActiveTags(mode: ChatModeKey = "ask"): string[] {
    return [...this.activeTagsByMode[mode]];
  }

  /**
   * Indicates whether chat is filtered to a selected subset.
   */
  public hasActiveSelection(mode: ChatModeKey = "ask"): boolean {
    return this.activeTagsByMode[mode].size > 0;
  }

  /**
   * Returns the slots currently targeted for chat injection.
   */
  public getSlotsForChat(mode: ChatModeKey = "ask"): ContextSlot[] {
    if (!this.hasActiveSelection(mode)) {
      return [...this.slots];
    }

    return this.slots.filter((slot) => this.activeTagsByMode[mode].has(slot.tag));
  }

  /**
   * Returns a short human-readable summary of what chat will inject.
   */
  public chatScopeSummary(mode: ChatModeKey = "ask"): string {
    if (!this.hasActiveSelection(mode)) {
      return "all buffered slots";
    }

    return this.getSlotsForChat(mode)
      .map((slot) => slot.tag)
      .join(", ");
  }

  public getModeScopeSummary(): Record<ChatModeKey, string> {
    return {
      ask: this.chatScopeSummary("ask"),
      plan: this.chatScopeSummary("plan"),
      agent: this.chatScopeSummary("agent"),
    };
  }

  private listModes(): ChatModeKey[] {
    return ["ask", "plan", "agent"];
  }

  private resolveModes(mode: ChatModeKey | "all"): ChatModeKey[] {
    return mode === "all" ? this.listModes() : [mode];
  }

  private deleteTagFromModes(tag: string): void {
    for (const mode of this.listModes()) {
      this.activeTagsByMode[mode].delete(tag);
    }
  }

  private oldestIndexExcluding(excludedIndex: number): number {
    let candidate = -1;
    for (let i = 0; i < this.slots.length; i += 1) {
      if (i === excludedIndex) {
        continue;
      }
      if (candidate < 0 || this.slots[i].timestamp < this.slots[candidate].timestamp) {
        candidate = i;
      }
    }
    return candidate;
  }

  private totalTokens(): number {
    return this.slots.reduce((sum, slot) => sum + slot.tokenEstimate, 0);
  }

  private estimateTokens(text: string): number {
    const specialChars = text.match(/[{};()]/g)?.length ?? 0;
    const isDenseCode = specialChars > text.length * 0.02;
    const ratio = isDenseCode ? 3.5 : 4.0;
    return Math.ceil(text.length / ratio);
  }

  private truncateSlotToBudget(slot: ContextSlot, tokenBudget: number): ContextSlot {
    const clampedBudget = Math.max(1, tokenBudget);
    const charBudget = Math.max(32, clampedBudget * 4);
    const suffix = "\n[... truncated for prompt budget ...]";
    const nextContent = `${slot.content.slice(0, Math.max(0, charBudget - suffix.length))}${suffix}`;
    return {
      ...slot,
      content: nextContent,
      tokenEstimate: this.estimateTokens(nextContent),
    };
  }
}
