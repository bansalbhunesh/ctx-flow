import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { handleInject, handleUpdate, handleReset, createServer } from "../src/index.js";
import { resetConfigForTests } from "../src/config.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let TMP: string;
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

async function seed(): Promise<void> {
  await mkdir(join(TMP, "domains"), { recursive: true });
  await writeFile(join(TMP, "goals.md"), "# Goals\n\n- ship v2\n");
  await writeFile(join(TMP, "constraints.md"), "# Constraints\n\n- sub-100ms\n");
  await writeFile(join(TMP, "decisions.md"), "# Decisions\n\n- use postgres\n");
  await writeFile(
    join(TMP, "domains", "auth.md"),
    "# Auth\n\n- JWT 1h expiry\n- refresh token rotation\n"
  );
}

beforeEach(async () => {
  TMP = join(tmpdir(), `ctx-flow-index-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.CTX_FLOW_CONTEXT_DIR = TMP;
  delete process.env.ANTHROPIC_API_KEY;
  create.mockReset();
  resetConfigForTests();
  await seed();
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  delete process.env.CTX_FLOW_CONTEXT_DIR;
  delete process.env.ANTHROPIC_API_KEY;
  if (ORIGINAL_KEY) process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  resetConfigForTests();
});

describe("handleInject", () => {
  it("loads core files plus matched domain on a keyword hit", async () => {
    const result = await handleInject("how do I refresh the JWT?");
    expect(result.context).toContain("ship v2");
    expect(result.context).toContain("sub-100ms");
    expect(result.context).toContain("JWT 1h expiry");
    expect(result.filesLoaded).toContain("goals.md");
    expect(result.filesLoaded).toContain("constraints.md");
    expect(result.filesLoaded).toContain("decisions.md");
    expect(result.filesLoaded).toContain("domains/auth.md");
    expect(result.filesLoaded).toContain("[routed via keyword]");
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("returns just core files when message matches no domain", async () => {
    const result = await handleInject("zzz cooking text totally unrelated zzz");
    expect(result.context).toContain("ship v2");
    expect(result.filesLoaded).not.toContain("domains/auth.md");
    expect(result.filesLoaded).not.toContain("[routed via keyword]");
  });

  it("recovers cleanly from a corrupt .session.json", async () => {
    await writeFile(join(TMP, ".session.json"), "{ this is not json");
    const result = await handleInject("anything");
    expect(result.context.length).toBeGreaterThan(0);
  });

  it.each([
    "null",
    "{}",
    '{"turnCount":1,"totalTokensUsed":2,"summaryExists":true,"lastSummary":{"facts":"bad"}}',
  ])("recovers from invalid session structure %s", async (value) => {
    await writeFile(join(TMP, ".session.json"), value);
    expect((await handleInject("hello")).context).toContain("ship v2");
  });

  it("loads persisted uncompressed history after a server restart", async () => {
    await writeFile(
      join(TMP, ".session.json"),
      JSON.stringify({
        turnCount: 1,
        totalTokensUsed: 12,
        summaryExists: false,
        lastSummary: null,
        pendingTurns: [{ role: "user", content: "Remember the launch date" }],
      })
    );
    expect((await handleInject("launch")).context).toContain("Remember the launch date");
  });
});

describe("handleUpdate", () => {
  it("continues persisting turns when extraction and compression requests fail", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    create.mockRejectedValue(new Error("offline"));
    const message = "x".repeat(17000);
    await expect(
      handleUpdate({ message, response: "reply", detectedDomains: ["auth"] })
    ).resolves.toContain("Turn 1");
    const state = JSON.parse(await readFile(join(TMP, ".session.json"), "utf-8"));
    expect(state.pendingTurns[0].content).toBe(message);
    expect(state.lastSummary).toBeNull();
  });

  it("replaces pending turns with a valid summary after successful compression", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "{}" }] });
    create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            goals: [],
            facts: ["launch Friday"],
            decisions: [],
            constraints: [],
            openQuestions: [],
          }),
        },
      ],
    });
    await handleUpdate({
      message: "launch Friday " + "x".repeat(17000),
      response: "recorded",
      detectedDomains: ["auth"],
    });
    const state = JSON.parse(await readFile(join(TMP, ".session.json"), "utf-8"));
    expect(state.pendingTurns).toEqual([]);
    expect(state.lastSummary.facts).toEqual(["launch Friday"]);
    expect((await handleInject("login")).context).toContain("launch Friday");
  });
  it("injects new history even below the compression threshold", async () => {
    await handleUpdate({
      message: "Deployment is Friday",
      response: "Recorded",
      detectedDomains: [],
    });
    expect((await handleInject("deployment")).context).toContain("Deployment is Friday");
  });

  it("keeps full history above the threshold without an API key", async () => {
    const message = "Keep this detail " + "x".repeat(17000);
    await handleUpdate({ message, response: "Recorded", detectedDomains: [] });
    const state = JSON.parse(await readFile(join(TMP, ".session.json"), "utf-8"));
    expect(state.pendingTurns[0].content).toBe(message);
    expect(state.summaryExists).toBe(false);
    expect((await handleInject("detail")).context).toContain(message);
  });

  it("does not lose concurrent updates or mix separate context directories", async () => {
    await Promise.all(
      ["first", "second", "third"].map((message) =>
        handleUpdate({ message, response: "noted", detectedDomains: [] })
      )
    );
    const state = JSON.parse(await readFile(join(TMP, ".session.json"), "utf-8"));
    expect(state.turnCount).toBe(3);
    expect(state.pendingTurns).toHaveLength(6);
    process.env.CTX_FLOW_CONTEXT_DIR = join(TMP, "other-project");
    resetConfigForTests();
    expect((await handleInject("first")).context).not.toContain("first");
  });
  it("increments the turn counter and persists the session file", async () => {
    const r1 = await handleUpdate({
      message: "msg1",
      response: "resp1",
      detectedDomains: ["auth"],
    });
    expect(r1).toMatch(/Turn 1/);

    const r2 = await handleUpdate({
      message: "msg2",
      response: "resp2",
      detectedDomains: [],
    });
    expect(r2).toMatch(/Turn 2/);

    const onDisk = JSON.parse(await readFile(join(TMP, ".session.json"), "utf-8"));
    expect(onDisk.turnCount).toBe(2);
    expect(onDisk.totalTokensUsed).toBeGreaterThan(0);
  });
});

describe("handleReset", () => {
  it("zeroes the persisted session", async () => {
    await handleUpdate({
      message: "msg1",
      response: "resp1",
      detectedDomains: ["auth"],
    });
    const msg = await handleReset();
    expect(msg).toContain("Session reset");

    const onDisk = JSON.parse(await readFile(join(TMP, ".session.json"), "utf-8"));
    expect(onDisk.turnCount).toBe(0);
    expect(onDisk.totalTokensUsed).toBe(0);
    expect(onDisk.summaryExists).toBe(false);
    expect(onDisk.pendingTurns).toEqual([]);
    expect(await readFile(join(TMP, "goals.md"), "utf-8")).toContain("ship v2");
  });
});

describe("createServer", () => {
  it("exposes all four tools and rejects malformed MCP arguments without writing", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        "ctx_inject",
        "ctx_reset",
        "ctx_update",
        "ctx_write_fact",
      ]);
      expect(client.getServerVersion()?.version).toBe("1.2.0");
      for (const [name, args] of [
        ["ctx_inject", {}],
        ["ctx_update", { message: "m", response: "r", detectedDomains: [42] }],
        ["ctx_write_fact", { domain: "../goals", fact: "unsafe" }],
      ] as const) {
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      }
      const written = await client.callTool({
        name: "ctx_write_fact",
        arguments: { domain: "auth", fact: "Passkeys enabled" },
      });
      expect(written.isError).not.toBe(true);
      const injected = await client.callTool({
        name: "ctx_inject",
        arguments: { message: "login" },
      });
      expect(JSON.stringify(injected.content)).toContain("Passkeys enabled");
      expect(await readFile(join(TMP, "goals.md"), "utf-8")).not.toContain("unsafe");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
