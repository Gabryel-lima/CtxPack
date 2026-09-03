import { ContextRingBuffer } from "../src/ContextRingBuffer";

describe("ContextRingBuffer", () => {
  it("keeps slots within the token limit", () => {
    const buffer = new ContextRingBuffer(50);

    buffer.push("a", "x".repeat(80));
    buffer.push("b", "y".repeat(80));
    buffer.push("c", "z".repeat(80));
    buffer.push("d", "w".repeat(80));

    expect(buffer.findByTag("d")).toBeDefined();
    expect(buffer.findByTag("c")).toBeDefined();
    expect(buffer.findByTag("b")).toBeUndefined();
    expect(buffer.findByTag("a")).toBeUndefined();
  });

  it("FIFO eviction removes the oldest slot first", () => {
    const buffer = new ContextRingBuffer(70);

    buffer.push("oldest", "a".repeat(100));
    buffer.push("middle", "b".repeat(100));
    buffer.push("newest", "c".repeat(100));

    expect(buffer.findByTag("newest")).toBeDefined();
    expect(buffer.findByTag("oldest")).toBeUndefined();
  });

  it("replaceByTag preserves position in the array", () => {
    const buffer = new ContextRingBuffer(300);

    buffer.push("first", "1111");
    buffer.push("second", "2222");
    buffer.push("third", "3333");

    const replaced = buffer.replaceByTag("second", "2222-replaced");
    expect(replaced).toBe(true);

    const flush = buffer.flush();
    const secondIndex = flush.indexOf("### [second]");
    const firstIndex = flush.indexOf("### [first]");
    const thirdIndex = flush.indexOf("### [third]");

    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
    expect(flush).toContain("2222-replaced");
  });

  it("flush returns an empty string when the buffer is empty", () => {
    const buffer = new ContextRingBuffer(100);
    expect(buffer.flush()).toBe("");
  });

  it("removeByTag removes only the requested slot", () => {
    const buffer = new ContextRingBuffer(100);
    buffer.push("first", "1111");
    buffer.push("second", "2222");

    expect(buffer.removeByTag("first")).toBe(true);
    expect(buffer.findByTag("first")).toBeUndefined();
    expect(buffer.findByTag("second")).toBeDefined();
    expect(buffer.removeByTag("missing")).toBe(false);
  });

  it("flush uses only active tags when a selection exists", () => {
    const buffer = new ContextRingBuffer(200);
    buffer.push("first", "1111");
    buffer.push("second", "2222");
    buffer.push("third", "3333");

    buffer.setActiveTags(["second", "third"]);

    const flush = buffer.flush();
    expect(flush).not.toContain("### [first]");
    expect(flush).toContain("### [second]");
    expect(flush).toContain("### [third]");
    expect(buffer.chatScopeSummary()).toBe("second, third");
  });

  it("clearActiveTags restores full-buffer injection", () => {
    const buffer = new ContextRingBuffer(200);
    buffer.push("first", "1111");
    buffer.push("second", "2222");
    buffer.setActiveTags(["second"]);

    buffer.clearActiveTags();

    const flush = buffer.flush();
    expect(flush).toContain("### [first]");
    expect(flush).toContain("### [second]");
    expect(buffer.chatScopeSummary()).toBe("all buffered slots");
  });

  it("removing an active tag also removes it from the active selection", () => {
    const buffer = new ContextRingBuffer(200);
    buffer.push("first", "1111");
    buffer.push("second", "2222");
    buffer.setActiveTags(["second"]);

    buffer.removeByTag("second");

    expect(buffer.listActiveTags()).toEqual([]);
    expect(buffer.hasActiveSelection()).toBe(false);
  });

  it("status reports slot count and tokens correctly", () => {
    const buffer = new ContextRingBuffer(100);
    buffer.push("mod", "abcd");

    const status = buffer.status();
    expect(status).toMatch(/^1 slots \| ~\d+\.\dk tokens \| active all$/);
  });

  it("keeps active selections isolated per chat mode", () => {
    const buffer = new ContextRingBuffer(200);
    buffer.push("first", "1111");
    buffer.push("second", "2222");

    buffer.setActiveTags(["second"], "agent");

    expect(buffer.flush("agent")).toContain("### [second]");
    expect(buffer.flush("agent")).not.toContain("### [first]");
    expect(buffer.flush("ask")).toContain("### [first]");
    expect(buffer.flush("ask")).toContain("### [second]");
  });

  it("clears only the requested mode selection", () => {
    const buffer = new ContextRingBuffer(200);
    buffer.push("first", "1111");
    buffer.push("second", "2222");
    buffer.setActiveTags(["second"], "plan");
    buffer.setActiveTags(["first"], "agent");

    buffer.clearActiveTags("plan");

    expect(buffer.hasActiveSelection("plan")).toBe(false);
    expect(buffer.hasActiveSelection("agent")).toBe(true);
    expect(buffer.listActiveTags("agent")).toEqual(["first"]);
  });

  it("buildPromptContext keeps recent slots inside a budget", () => {
    const buffer = new ContextRingBuffer(500);
    buffer.push("oldest", "a".repeat(160));
    buffer.push("middle", "b".repeat(160));
    buffer.push("newest", "c".repeat(160));

    const payload = buffer.buildPromptContext("ask", 90);

    expect(payload.usedTags).toContain("newest");
    expect(payload.omittedTags.length).toBeGreaterThan(0);
    expect(payload.estimatedTokens).toBeLessThanOrEqual(100);
  });

  it("buildPromptContext truncates a single large slot to fit the budget", () => {
    const buffer = new ContextRingBuffer(500);
    buffer.push("semantic", "x".repeat(1000));

    const payload = buffer.buildPromptContext("ask", 40);

    expect(payload.usedTags).toEqual(["semantic"]);
    expect(payload.content).toContain("[... truncated for prompt budget ...]");
    expect(payload.estimatedTokens).toBeLessThanOrEqual(60);
  });

  it("buildPromptContextRanked includes a ranked-relevant slot that pure recency would drop", () => {
    const buffer = new ContextRingBuffer(500);
    buffer.push("old-relevant", "a".repeat(160));
    buffer.push("newer-noise", "b".repeat(160));
    buffer.push("newest-noise", "c".repeat(160));

    // Each 160-char slot costs ~45 estimated tokens, so a 60-token budget
    // fits exactly one slot — pure recency keeps only "newest-noise".
    const recency = buffer.buildPromptContext("ask", 60);
    expect(recency.usedTags).toEqual(["newest-noise"]);

    const slots = buffer.getSlotsForChat("ask");
    const ranked = buffer.buildPromptContextRanked(slots, 60, ["old-relevant"]);
    expect(ranked.usedTags).toEqual(["old-relevant"]);
  });

  it("buildPromptContextRanked falls back to recency order for slots absent from rankedTags", () => {
    const buffer = new ContextRingBuffer(500);
    buffer.push("oldest", "a".repeat(160));
    buffer.push("middle", "b".repeat(160));
    buffer.push("newest", "c".repeat(160));

    const slots = buffer.getSlotsForChat("ask");
    // No ranking signal at all — behavior should match buildPromptContext.
    const ranked = buffer.buildPromptContextRanked(slots, 60, []);
    expect(ranked.usedTags).toEqual(["newest"]);
  });
});
