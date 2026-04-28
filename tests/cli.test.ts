import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { init } from "../src/cli.js";

let TMP: string;

beforeEach(async () => {
  TMP = join(tmpdir(), `ctx-flow-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("init", () => {
  it("scaffolds the full context tree", async () => {
    const { created, skipped } = await init(TMP);
    expect(created).toBeGreaterThan(0);
    expect(skipped).toBe(0);

    const goals = await readFile(join(TMP, "context", "goals.md"), "utf-8");
    expect(goals).toContain("Project Goals");

    const auth = await stat(join(TMP, "context", "domains", "auth.md"));
    expect(auth.isFile()).toBe(true);
  });

  it("does not overwrite existing files on re-init", async () => {
    await init(TMP);
    const second = await init(TMP);
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });
});
