import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, rm, writeFile, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { extractAndUpdate, writeFact } from "../src/context/file-manager.js";
import { resetConfigForTests } from "../src/config.js";

let TMP: string;
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

beforeEach(async () => {
  TMP = join(tmpdir(), `ctx-flow-fm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(TMP, "domains"), { recursive: true });
  process.env.CTX_FLOW_CONTEXT_DIR = TMP;
  delete process.env.ANTHROPIC_API_KEY;
  create.mockReset();
  resetConfigForTests();
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  delete process.env.CTX_FLOW_CONTEXT_DIR;
  delete process.env.ANTHROPIC_API_KEY;
  if (ORIGINAL_KEY) process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  resetConfigForTests();
});

describe("writeFact", () => {
  it.each([
    "../goals",
    "..\\goals",
    "/tmp/escape",
    "C:\\escape",
    "auth:stream",
    "CON",
    "",
    "auth\u0000",
  ])("rejects unsafe domain %s", async (domain) => {
    await expect(writeFact(domain, "unsafe")).rejects.toThrow("Invalid domain");
  });

  it("rejects a domains directory redirected through a symlink or junction", async () => {
    const external = join(TMP, "external");
    await mkdir(external);
    await writeFile(join(external, "auth.md"), "unchanged");
    await rm(join(TMP, "domains"), { recursive: true });
    await symlink(
      external,
      join(TMP, "domains"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(writeFact("auth", "unsafe")).rejects.toThrow("symbolic links");
    expect(await readFile(join(external, "auth.md"), "utf-8")).toBe("unchanged");
  });
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

  it("deduplicates against existing bullets — same fact written twice appears once", async () => {
    await writeFact("auth", "JWT expiry is 1h");
    await writeFact("auth", "JWT expiry is 1h");
    const content = await readFile(join(TMP, "domains", "auth.md"), "utf-8");
    const occurrences = content.split("- JWT expiry is 1h").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("extractAndUpdate", () => {
  it("allows only active domains and counts only newly written facts", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            domain_updates: {
              "../goals": ["unsafe"],
              billing: ["inactive"],
              auth: ["one", "one", " two "],
            },
            decisions: [42],
            goals: "bad",
          }),
        },
      ],
    });
    const first = await extractAndUpdate("msg", "reply", ["auth"]);
    expect(first.factsAdded).toBe(2);
    expect(first.domainsUpdated).toEqual(["auth"]);
    expect((await extractAndUpdate("msg", "reply", ["auth"])).factsAdded).toBe(0);
    await expect(readFile(join(TMP, "goals.md"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(TMP, "domains", "billing.md"), "utf-8")).rejects.toThrow();
  });

  it.each(["null", "[]", "invalid", '{"domain_updates":{"auth":[42]},"constraints":[null]}'])(
    "handles invalid model data %s",
    async (raw) => {
      process.env.ANTHROPIC_API_KEY = "test-only";
      create.mockResolvedValue({ content: [{ type: "text", text: raw }] });
      expect((await extractAndUpdate("msg", "reply", ["auth"])).factsAdded).toBe(0);
    }
  );

  it("skips extraction when the API fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    create.mockRejectedValue(new Error("offline"));
    expect((await extractAndUpdate("msg", "reply", ["auth"])).skipped).toBe(true);
  });
  it("returns skipped when no API key is available", async () => {
    const result = await extractAndUpdate("user msg", "asst response", ["auth"]);
    expect(result.skipped).toBe(true);
    expect(result.factsAdded).toBe(0);
    expect(result.domainsUpdated).toEqual([]);
  });
});
