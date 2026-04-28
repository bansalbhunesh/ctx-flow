import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, resetConfigForTests } from "../src/config.js";

let TMP: string;

beforeEach(async () => {
  TMP = join(tmpdir(), `ctx-flow-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(TMP, { recursive: true });
  resetConfigForTests();
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  delete process.env.CTX_FLOW_CONFIG;
  delete process.env.CTX_FLOW_CONTEXT_DIR;
  resetConfigForTests();
});

describe("loadConfig", () => {
  it("uses sensible defaults when no config file or env vars are set", async () => {
    const cfg = await loadConfig();
    expect(cfg.tokenThreshold).toBe(4000);
    expect(cfg.haikuModel).toBe("claude-haiku-4-5-20251001");
    expect(cfg.keywordMap.auth).toBeDefined();
  });

  it("respects CTX_FLOW_CONFIG pointing at a custom config file", async () => {
    const configPath = join(TMP, "custom.json");
    await writeFile(
      configPath,
      JSON.stringify({
        tokenThreshold: 999,
        haikuModel: "fake-model",
        keywordMap: { billing: ["invoice", "stripe"] },
      })
    );
    process.env.CTX_FLOW_CONFIG = configPath;
    resetConfigForTests();

    const cfg = await loadConfig();
    expect(cfg.tokenThreshold).toBe(999);
    expect(cfg.haikuModel).toBe("fake-model");
    expect(cfg.keywordMap.billing).toEqual(["invoice", "stripe"]);
    // built-in defaults still merged
    expect(cfg.keywordMap.auth).toBeDefined();
  });

  it("CTX_FLOW_CONTEXT_DIR overrides config file contextDir", async () => {
    const configPath = join(TMP, "custom.json");
    await writeFile(configPath, JSON.stringify({ contextDir: "/tmp/from-config" }));
    process.env.CTX_FLOW_CONFIG = configPath;
    process.env.CTX_FLOW_CONTEXT_DIR = "/tmp/from-env";
    resetConfigForTests();

    const cfg = await loadConfig();
    expect(cfg.contextDir).toBe("/tmp/from-env");
  });

  it("returns the same cached object on repeated calls", async () => {
    const a = await loadConfig();
    const b = await loadConfig();
    expect(a).toBe(b);
  });

  it("falls back to defaults when the config file is malformed JSON", async () => {
    const configPath = join(TMP, "bad.json");
    await writeFile(configPath, "{ not valid json");
    process.env.CTX_FLOW_CONFIG = configPath;
    resetConfigForTests();

    const cfg = await loadConfig();
    expect(cfg.tokenThreshold).toBe(4000);
  });
});
