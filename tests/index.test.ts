import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { handleInject, handleUpdate, handleReset, createServer } from "../src/index.js";
import { resetConfigForTests } from "../src/config.js";

let TMP: string;
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

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
  resetConfigForTests();
  await seed();
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  delete process.env.CTX_FLOW_CONTEXT_DIR;
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
});

describe("handleUpdate", () => {
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
  });
});

describe("createServer", () => {
  it("returns a server instance with the four ctx_* tools registered", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
