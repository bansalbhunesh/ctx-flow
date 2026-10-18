import Anthropic from "@anthropic-ai/sdk";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { loadConfig } from "../config.js";
import { contextPath } from "../context/paths.js";
import { isDomain } from "../validation.js";

async function getAvailableDomains(): Promise<string[]> {
  const domainsDir = await contextPath("domains");
  if (!existsSync(domainsDir)) return [];
  const files = await readdir(domainsDir, { withFileTypes: true });
  return files
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => f.name.slice(0, -3))
    .filter(isDomain);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function keywordMatch(
  message: string,
  domains: string[],
  keywordMap: Record<string, string[]>
): string[] {
  const matched: string[] = [];

  for (const domain of domains) {
    const keywords = Object.hasOwn(keywordMap, domain) ? keywordMap[domain] : [domain];
    const hit = keywords.some((kw) => {
      const pattern = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
      return pattern.test(message);
    });
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

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.error("[ctx-flow] Haiku classifier request failed:", err);
    return [];
  }

  const first = response.content[0];
  const text = first?.type === "text" ? first.text.trim() : "[]";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return [
        ...new Set(parsed.filter((d): d is string => typeof d === "string" && domains.includes(d))),
      ].slice(0, 2);
    }
  } catch {
    console.error("[ctx-flow] Haiku classifier returned non-JSON response:", text);
  }

  return [];
}

export interface RouterResult {
  domains: string[];
  method: "keyword" | "haiku" | "none";
}

/**
 * Route a message to relevant domain(s).
 * Tier 1: keyword match (free, instant, word-boundary aware)
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
