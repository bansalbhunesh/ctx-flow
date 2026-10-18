import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { isDomain, isRecord, isStringArray } from "./validation.js";

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

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const configPath = process.env.CTX_FLOW_CONFIG ?? join(cwd, "ctx-flow.config.json");

  let user: Partial<Config> = {};
  if (existsSync(configPath)) {
    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("Config must be a JSON object");
      if (
        parsed.contextDir !== undefined &&
        (typeof parsed.contextDir !== "string" || !parsed.contextDir.trim())
      )
        throw new Error("contextDir must be a nonempty string");
      if (
        parsed.tokenThreshold !== undefined &&
        (!Number.isSafeInteger(parsed.tokenThreshold) || (parsed.tokenThreshold as number) <= 0)
      )
        throw new Error("tokenThreshold must be a positive integer");
      if (
        parsed.haikuModel !== undefined &&
        (typeof parsed.haikuModel !== "string" || !parsed.haikuModel.trim())
      )
        throw new Error("haikuModel must be a nonempty string");
      if (
        parsed.keywordMap !== undefined &&
        (!isRecord(parsed.keywordMap) ||
          !Object.entries(parsed.keywordMap).every(
            ([domain, words]) =>
              isDomain(domain) &&
              isStringArray(words) &&
              words.every((word) => word.trim().length > 0)
          ))
      )
        throw new Error("keywordMap must map valid domains to nonempty keywords");
      user = parsed as Partial<Config>;
    } catch (err) {
      console.error(`[ctx-flow] failed to parse ${configPath}:`, err);
    }
  }

  const contextDirRaw = process.env.CTX_FLOW_CONTEXT_DIR
    ? resolve(cwd, process.env.CTX_FLOW_CONTEXT_DIR)
    : user.contextDir
      ? resolve(dirname(resolve(configPath)), user.contextDir)
      : join(cwd, "context");

  const keywordMap = Object.fromEntries(
    Object.entries(DEFAULT_KEYWORD_MAP).map(([domain, words]) => [domain, [...words]])
  );
  for (const [domain, words] of Object.entries(user.keywordMap ?? {})) {
    keywordMap[domain] = [
      ...new Set([...(Object.hasOwn(keywordMap, domain) ? keywordMap[domain] : []), ...words]),
    ];
  }

  cached = {
    contextDir: resolve(contextDirRaw),
    tokenThreshold: user.tokenThreshold ?? DEFAULTS.tokenThreshold,
    haikuModel: user.haikuModel ?? DEFAULTS.haikuModel,
    keywordMap,
  };

  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
