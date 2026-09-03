import { ContextSlot } from "../src/ContextRingBuffer";
import { correlateSlotsWithPrompt, tokenizeForCorrelation } from "../src/ChatParticipant";

function makeSlot(tag: string, content: string): ContextSlot {
  return { tag, content, tokenEstimate: Math.ceil(content.length / 4), timestamp: Date.now() };
}

describe("tokenizeForCorrelation", () => {
  it("lowercases and splits on non-alphanumeric characters", () => {
    expect(tokenizeForCorrelation("Auth-Flow Handler_v2!")).toEqual(["auth", "flow", "handler_v2"]);
  });

  it("drops terms shorter than 3 characters", () => {
    expect(tokenizeForCorrelation("a to the db")).toEqual(["the"]);
  });
});

describe("correlateSlotsWithPrompt", () => {
  it("scores a slot with full term overlap near 1.0", () => {
    const slots = [makeSlot("auth", "This module handles the authentication login flow.")];
    const result = correlateSlotsWithPrompt("authentication login flow", slots);

    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("auth");
    expect(result[0].score).toBeGreaterThan(0.9);
  });

  it("returns no correlations for a prompt with no terms 3+ characters long", () => {
    const slots = [makeSlot("auth", "This module handles the authentication login flow.")];
    expect(correlateSlotsWithPrompt("hi ok", slots)).toEqual([]);
  });

  it("excludes slots with zero term overlap", () => {
    const slots = [
      makeSlot("auth", "authentication login session token"),
      makeSlot("billing", "invoice payment subscription plan"),
    ];
    const result = correlateSlotsWithPrompt("authentication session", slots);

    expect(result.map((r) => r.tag)).toEqual(["auth"]);
  });

  it("ranks a slot with more matched terms above one with fewer", () => {
    const slots = [
      makeSlot("partial", "authentication only"),
      makeSlot("full", "authentication session token login flow"),
    ];
    const result = correlateSlotsWithPrompt("authentication session token login", slots);

    expect(result[0].tag).toBe("full");
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });
});
