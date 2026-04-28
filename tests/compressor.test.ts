import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { compress, renderSummary } from "../src/summarizer/compressor.js";
import { resetConfigForTests } from "../src/config.js";
import type { StructuredSummary, Turn } from "../src/types.js";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  resetConfigForTests();
});

afterEach(() => {
  if (ORIGINAL_KEY) process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  resetConfigForTests();
});

describe("compress", () => {
  it("returns null when below the token threshold and not forced", async () => {
    const turns: Turn[] = [{ role: "user", content: "hello" }];
    const result = await compress(turns, null, 1);
    expect(result).toBeNull();
  });

  it("produces a fallback summary when forced and no API key is available", async () => {
    const turns: Turn[] = [
      { role: "user", content: "we use postgres" },
      { role: "assistant", content: "noted" },
    ];
    const result = await compress(turns, null, 5, true);
    expect(result).not.toBeNull();
    expect(result!.summary.compressedAt).toBe(5);
    expect(result!.summary.facts.length).toBeGreaterThan(0);
  });

  it("merges existing summary fields into the fallback summary", async () => {
    const existing: StructuredSummary = {
      goals: ["ship v2"],
      facts: ["we use postgres"],
      decisions: ["go with REST"],
      constraints: ["sub-100ms"],
      openQuestions: [],
      compressedAt: 4,
    };
    const turns: Turn[] = [{ role: "user", content: "x" }];
    const result = await compress(turns, existing, 6, true);
    expect(result!.summary.goals).toEqual(["ship v2"]);
    expect(result!.summary.decisions).toEqual(["go with REST"]);
    expect(result!.summary.constraints).toEqual(["sub-100ms"]);
    expect(result!.summary.compressedAt).toBe(6);
  });

  it("respects a custom token threshold from config", async () => {
    process.env.CTX_FLOW_CONFIG = "/nonexistent/path-do-not-load.json";
    resetConfigForTests();
    const tinyTurn: Turn[] = [{ role: "user", content: "x".repeat(40) }];
    const result = await compress(tinyTurn, null, 1);
    expect(result).toBeNull();
    delete process.env.CTX_FLOW_CONFIG;
    resetConfigForTests();
  });
});

describe("renderSummary", () => {
  it("formats all sections that have content", () => {
    const summary: StructuredSummary = {
      goals: ["g1"],
      facts: ["f1", "f2"],
      decisions: ["d1"],
      constraints: ["c1"],
      openQuestions: ["q1"],
      compressedAt: 7,
    };
    const out = renderSummary(summary);
    expect(out).toContain("compressed at turn 7");
    expect(out).toContain("**Goals:** g1");
    expect(out).toContain("**Facts:** f1 | f2");
    expect(out).toContain("**Decisions:** d1");
    expect(out).toContain("**Constraints:** c1");
    expect(out).toContain("**Open:** q1");
  });

  it("omits empty sections", () => {
    const summary: StructuredSummary = {
      goals: [],
      facts: ["only fact"],
      decisions: [],
      constraints: [],
      openQuestions: [],
      compressedAt: 1,
    };
    const out = renderSummary(summary);
    expect(out).toContain("**Facts:** only fact");
    expect(out).not.toContain("**Goals:**");
    expect(out).not.toContain("**Decisions:**");
  });
});
