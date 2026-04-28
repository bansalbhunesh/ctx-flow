import Anthropic from "@anthropic-ai/sdk";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { loadConfig } from "../config.js";

async function getAvailableDomains(): Promise<string[]> {
  const cfg = await loadConfig();
  const domainsDir = join(cfg.contextDir, "domains");
  if (!existsSync(domainsDir)) return [];
  const files = await readdir(domainsDir);
  return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
}

export function keywordMatch(
  message: string,
  domains: string[],
  keywordMap: Record<string, string[]>
): string[] {
  const lower = message.toLowerCase();
  const matched: string[] = [];

  for (const domain of domains) {
    const keywords = keywordMap[domain] ?? [domain];
    const hit = keywords.some((kw) => lower.includes(kw));
    if (hit) matched.push(domain);
  }

  return matched;
}

async function classifyWithHaiku(
  message: string,
  domains: string[],
  model: string
): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

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
    model,
    max_tokens: 64,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter((d): d is string => typeof d === "string" && domains.includes(d));
    }
  } catch {
    // Haiku returned malformed JSON — safe to ignore
  }

  return [];
}

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
  const cfg = await loadConfig();
  const availableDomains = await getAvailableDomains();

  if (availableDomains.length === 0) {
    return { domains: [], method: "none" };
  }

  const keywordDomains = keywordMatch(message, availableDomains, cfg.keywordMap);
  if (keywordDomains.length > 0) {
    return { domains: keywordDomains, method: "keyword" };
  }

  const haikuDomains = await classifyWithHaiku(message, availableDomains, cfg.haikuModel);
  if (haikuDomains.length > 0) {
    return { domains: haikuDomains, method: "haiku" };
  }

  return { domains: [], method: "none" };
}
