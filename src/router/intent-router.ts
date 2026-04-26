import Anthropic from "@anthropic-ai/sdk";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = join(__dirname, "../../context/domains");

// ── Keyword map ───────────────────────────────────────────────────────────────
// Add keywords for each domain you create in context/domains/
const KEYWORD_MAP: Record<string, string[]> = {
  auth: ["login", "logout", "token", "jwt", "session", "password", "oauth", "refresh", "authenticate", "permission", "role"],
  api: ["endpoint", "route", "request", "response", "rest", "http", "fetch", "axios", "post", "get", "delete", "patch", "status code"],
  ui: ["component", "button", "form", "modal", "layout", "style", "css", "tailwind", "render", "click", "input", "page"],
  database: ["query", "table", "schema", "migration", "sql", "postgres", "mongo", "insert", "select", "index", "foreign key"],
  testing: ["test", "spec", "mock", "assert", "jest", "vitest", "coverage", "unit", "integration", "e2e"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAvailableDomains(): Promise<string[]> {
  if (!existsSync(CONTEXT_DIR)) return [];
  const files = await readdir(CONTEXT_DIR);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(".md", ""));
}

function keywordMatch(message: string, domains: string[]): string[] {
  const lower = message.toLowerCase();
  const matched: string[] = [];

  for (const domain of domains) {
    const keywords = KEYWORD_MAP[domain] ?? [domain];
    const hit = keywords.some((kw) => lower.includes(kw));
    if (hit) matched.push(domain);
  }

  return matched;
}

// ── Haiku classifier (fires only when keywords miss) ──────────────────────────

async function classifyWithHaiku(
  message: string,
  domains: string[]
): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    // No key available — return empty so we fall back to core files only
    return [];
  }

  const client = new Anthropic();

  const prompt = `You are a domain classifier. Given a user message, return which domains are relevant.

Available domains: ${domains.join(", ")}

Rules:
- Return ONLY a JSON array of domain names from the available list
- Return [] if no domain is clearly relevant
- Return at most 2 domains
- No explanation, just the array

Message: "${message}"`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 64,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "[]";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Validate — only return domains that actually exist
      return parsed.filter((d): d is string =>
        typeof d === "string" && domains.includes(d)
      );
    }
  } catch {
    // Haiku returned malformed JSON — safe to ignore
  }

  return [];
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RouterResult {
  domains: string[];
  method: "keyword" | "haiku" | "none";
}

/**
 * Route a message to relevant domain(s).
 * Tier 1: keyword match (free, instant)
 * Tier 2: Claude Haiku (only when keywords produce no match)
 */
export async function routeIntent(message: string): Promise<RouterResult> {
  const availableDomains = await getAvailableDomains();

  if (availableDomains.length === 0) {
    return { domains: [], method: "none" };
  }

  // Tier 1: fast keyword match
  const keywordDomains = keywordMatch(message, availableDomains);
  if (keywordDomains.length > 0) {
    return { domains: keywordDomains, method: "keyword" };
  }

  // Tier 2: Haiku fallback (only on miss)
  const haikuDomains = await classifyWithHaiku(message, availableDomains);
  if (haikuDomains.length > 0) {
    return { domains: haikuDomains, method: "haiku" };
  }

  return { domains: [], method: "none" };
}
