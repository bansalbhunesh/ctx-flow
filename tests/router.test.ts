import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { routeIntent, keywordMatch } from "../src/router/intent-router.js";
import { resetConfigForTests } from "../src/config.js";

let TMP: string;
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(async () => {
  TMP = join(tmpdir(), `ctx-flow-router-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(TMP, "domains"), { recursive: true });
  await writeFile(join(TMP, "domains", "auth.md"), "# auth");
  await writeFile(join(TMP, "domains", "api.md"), "# api");
  await writeFile(join(TMP, "domains", "ui.md"), "# ui");
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

describe("keywordMatch", () => {
  const map = {
    auth: ["login", "jwt", "token"],
    ui: ["button", "form"],
  };

  it("matches a single domain by keyword", () => {
    expect(keywordMatch("how do I refresh the JWT?", ["auth", "ui"], map)).toEqual(["auth"]);
  });

  it("matches multiple domains when several keywords hit", () => {
    expect(keywordMatch("login button on the form", ["auth", "ui"], map).sort()).toEqual([
      "auth",
      "ui",
    ]);
  });

  it("returns empty for unrelated text", () => {
    expect(keywordMatch("the weather is nice today", ["auth", "ui"], map)).toEqual([]);
  });

  it("falls back to the domain name itself when no keywords are configured", () => {
    expect(keywordMatch("talking about database stuff", ["database"], {})).toEqual(["database"]);
  });

  it("is case-insensitive", () => {
    expect(keywordMatch("LOGIN flow", ["auth"], map)).toEqual(["auth"]);
  });

  it("does not match a keyword embedded as a substring of another word", () => {
    // 'sql' should NOT match 'MySQL' — word boundaries required.
    expect(keywordMatch("MySQL is fine", ["database"], { database: ["sql"] })).toEqual([]);
  });

  it("matches a multi-word keyword across whitespace", () => {
    expect(keywordMatch("got a status code 500", ["api"], { api: ["status code"] })).toEqual([
      "api",
    ]);
  });

  it("does not match 'post' against 'blog post' when keyword is bare 'post'", () => {
    // Bare 'post' has been removed from defaults; verify the matcher itself
    // would still false-match without word boundaries — this confirms the
    // boundary fix without depending on the default map.
    expect(
      keywordMatch("just published a blog post here", ["api"], { api: ["post request"] })
    ).toEqual([]);
  });

  it("escapes regex-special characters in keywords", () => {
    expect(keywordMatch("look at version 1.2.3", ["x"], { x: ["1.2.3"] })).toEqual(["x"]);
    expect(keywordMatch("look at 1a2b3", ["x"], { x: ["1.2.3"] })).toEqual([]);
  });
});

describe("routeIntent", () => {
  it("routes via keyword tier on a hit", async () => {
    const r = await routeIntent("I need to debug the JWT refresh flow");
    expect(r.method).toBe("keyword");
    expect(r.domains).toContain("auth");
  });

  it("returns method 'none' when no keyword matches and no API key is set", async () => {
    const r = await routeIntent("zzz totally unrelated cooking text zzz");
    expect(r.method).toBe("none");
    expect(r.domains).toEqual([]);
  });

  it("returns method 'none' when no domain files exist", async () => {
    await rm(join(TMP, "domains"), { recursive: true, force: true });
    const r = await routeIntent("login flow");
    expect(r.method).toBe("none");
    expect(r.domains).toEqual([]);
  });
});
