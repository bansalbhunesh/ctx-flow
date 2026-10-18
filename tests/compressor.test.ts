import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { compress, renderSummary } from "../src/summarizer/compressor.js";
import { resetConfigForTests } from "../src/config.js";
import type { StructuredSummary, Turn } from "../src/types.js";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  create.mockReset();
  resetConfigForTests();
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  if (ORIGINAL_KEY) process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  resetConfigForTests();
});

describe("compress", () => {
  it("returns null when below the token threshold and not forced", async () => {
    const turns: Turn[] = [{ role: "user", content: "hello" }];
    const result = await compress(turns, null, 1);
    expect(result).toBeNull();
  });

  it("preserves original history by skipping compression without an API key", async () => {
    const turns: Turn[] = [
      { role: "user", content: "we use postgres" },
      { role: "assistant", content: "noted" },
    ];
    const result = await compress(turns, null, 5, true);
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not replace an existing summary with a placeholder", async () => {
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
    expect(result).toBeNull();
    expect(existing.facts).toEqual(["we use postgres"]);
  });

  it.each(["not JSON", "null", "{}", '{"facts":"wrong type"}'])(
    "retains history on malformed model output %s",
    async (raw) => {
      process.env.ANTHROPIC_API_KEY = "test-only";
      create.mockResolvedValue({ content: [{ type: "text", text: raw }] });
      expect(await compress([{ role: "user", content: "retain this" }], null, 1, true)).toBeNull();
    }
  );

  it("retains history if the API is unavailable", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    create.mockRejectedValue(new Error("offline"));
    expect(await compress([{ role: "user", content: "retain this" }], null, 1, true)).toBeNull();
  });

  it("accepts a valid summary and supplies the existing one for incremental compression", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    const previous: StructuredSummary = {
      goals: ["ship v2"],
      facts: ["Postgres"],
      decisions: [],
      constraints: [],
      openQuestions: [],
      compressedAt: 1,
    };
    create.mockResolvedValue({
      content: [
        { type: "text", text: JSON.stringify({ ...previous, facts: ["Postgres", "Redis"] }) },
      ],
    });
    const result = await compress([{ role: "user", content: "Redis cache" }], previous, 2, true);
    expect(result!.summary.facts).toEqual(["Postgres", "Redis"]);
    expect(result!.summary.compressedAt).toBe(2);
    expect(create.mock.calls[0][0].messages[0].content).toContain("Postgres");
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
