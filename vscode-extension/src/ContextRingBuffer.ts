export interface ContextSlot {
  tag: string;
  content: string;
  tokenEstimate: number;
  timestamp: number;
}

/**
 * FIFO buffer based on token estimation for session context.
 */
export class ContextRingBuffer {
  private slots: ContextSlot[] = [];

  private activeTags = new Set<string>();

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
        this.activeTags.delete(removed.tag);
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
  public flush(): string {
    const slots = this.getSlotsForChat();
    if (slots.length === 0) {
      return "";
    }

    return slots
      .map((slot) => `### [${slot.tag}]\n${slot.content}`)
      .join("\n\n");
  }

  /**
   * Removes all stored slots.
   */
  public clear(): void {
    this.slots = [];
    this.activeTags.clear();
  }

  /**
   * Returns a string with slot count and estimated tokens.
   */
  public status(): string {
    const total = this.totalTokens();
    const totalK = (total / 1000).toFixed(1);
    const activeSuffix = this.hasActiveSelection() ? ` | active ${this.activeTags.size}` : " | active all";
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
        this.activeTags.delete(removed.tag);
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
    this.activeTags.delete(tag);
    return true;
  }

  /**
   * Marks a subset of tags as active for chat injection.
   */
  public setActiveTags(tags: string[]): void {
    const validTags = new Set(this.slots.map((slot) => slot.tag));
    this.activeTags = new Set(tags.filter((tag) => validTags.has(tag)));
  }

  /**
   * Clears the active selection so chat uses the whole buffer again.
   */
  public clearActiveTags(): void {
    this.activeTags.clear();
  }

  /**
   * Returns the tags that are currently active for chat injection.
   */
  public listActiveTags(): string[] {
    return [...this.activeTags];
  }

  /**
   * Indicates whether chat is filtered to a selected subset.
   */
  public hasActiveSelection(): boolean {
    return this.activeTags.size > 0;
  }

  /**
   * Returns the slots currently targeted for chat injection.
   */
  public getSlotsForChat(): ContextSlot[] {
    if (!this.hasActiveSelection()) {
      return [...this.slots];
    }

    return this.slots.filter((slot) => this.activeTags.has(slot.tag));
  }

  /**
   * Returns a short human-readable summary of what chat will inject.
   */
  public chatScopeSummary(): string {
    if (!this.hasActiveSelection()) {
      return "all buffered slots";
    }

    return this.getSlotsForChat()
      .map((slot) => slot.tag)
      .join(", ");
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
}
