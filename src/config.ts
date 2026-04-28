import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

export interface Config {
  contextDir: string;
  tokenThreshold: number;
  haikuModel: string;
  keywordMap: Record<string, string[]>;
}

const DEFAULT_KEYWORD_MAP: Record<string, string[]> = {
  auth: [
    "login",
    "logout",
    "token",
    "jwt",
    "session",
    "password",
    "oauth",
    "refresh",
    "authenticate",
    "permission",
    "role",
  ],
  api: [
    "endpoint",
    "route",
    "request",
    "response",
    "rest api",
    "graphql",
    "http",
    "https",
    "axios",
    "get request",
    "post request",
    "put request",
    "delete request",
    "patch request",
    "status code",
    "webhook",
  ],
  ui: [
    "component",
    "button",
    "form",
    "modal",
    "layout",
    "style",
    "css",
    "tailwind",
    "render",
    "click",
    "input",
    "page",
  ],
  database: [
    "query",
    "table",
    "schema",
    "migration",
    "sql",
    "postgres",
    "mongo",
    "insert",
    "select",
    "index",
    "foreign key",
  ],
  testing: [
    "test",
    "spec",
    "mock",
    "assert",
    "jest",
    "vitest",
    "coverage",
    "unit",
    "integration",
    "e2e",
  ],
};

const DEFAULTS = {
  tokenThreshold: 4000,
  haikuModel: "claude-haiku-4-5-20251001",
};

let cached: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cached) return cached;

  const cwd = process.cwd();
  const configPath = process.env.CTX_FLOW_CONFIG ?? join(cwd, "ctx-flow.config.json");

  let user: Partial<Config> = {};
  if (existsSync(configPath)) {
    try {
      const raw = await readFile(configPath, "utf-8");
      user = JSON.parse(raw) as Partial<Config>;
    } catch (err) {
      console.error(`[ctx-flow] failed to parse ${configPath}:`, err);
    }
  }

  const contextDirRaw = process.env.CTX_FLOW_CONTEXT_DIR ?? user.contextDir ?? join(cwd, "context");

  cached = {
    contextDir: resolve(contextDirRaw),
    tokenThreshold: user.tokenThreshold ?? DEFAULTS.tokenThreshold,
    haikuModel: user.haikuModel ?? DEFAULTS.haikuModel,
    keywordMap: { ...DEFAULT_KEYWORD_MAP, ...(user.keywordMap ?? {}) },
  };

  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
