import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { extractAndUpdate, writeFact } from "../src/context/file-manager.js";
import { resetConfigForTests } from "../src/config.js";

let TMP: string;
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(async () => {
  TMP = join(tmpdir(), `ctx-flow-fm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(TMP, "domains"), { recursive: true });
  process.env.CTX_FLOW_CONTEXT_DIR = TMP;
  delete process.env.ANTHROPIC_API_KEY;
  resetConfigForTests();
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  delete process.env.CTX_FLOW_CONTEXT_DIR;
  if (ORIGINAL_KEY) process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  resetConfigForTests();
});

describe("writeFact", () => {
  it("creates a domain file when none exists", async () => {
    await writeFact("auth", "JWT expiry is 1h");
    const content = await readFile(join(TMP, "domains", "auth.md"), "utf-8");
    expect(content).toContain("- JWT expiry is 1h");
  });

  it("appends to an existing domain file without clobbering", async () => {
    await writeFact("auth", "fact one");
    await writeFact("auth", "fact two");
    const content = await readFile(join(TMP, "domains", "auth.md"), "utf-8");
    expect(content).toContain("- fact one");
    expect(content).toContain("- fact two");
  });
});

describe("extractAndUpdate", () => {
  it("returns skipped when no API key is available", async () => {
    const result = await extractAndUpdate("user msg", "asst response", ["auth"]);
    expect(result.skipped).toBe(true);
    expect(result.factsAdded).toBe(0);
    expect(result.domainsUpdated).toEqual([]);
  });
});
