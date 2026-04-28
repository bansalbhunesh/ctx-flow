import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { loadConfig } from "../config.js";

export async function readContextFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "";
  return readFile(filePath, "utf-8");
}

export async function writeContextFile(filePath: string, content: string): Promise<void> {
  const cfg = await loadConfig();
  const domainsDir = join(cfg.contextDir, "domains");
  if (!existsSync(domainsDir)) await mkdir(domainsDir, { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function domainPath(domain: string): Promise<string> {
  const cfg = await loadConfig();
  return join(cfg.contextDir, "domains", `${domain}.md`);
}

async function corePath(name: string): Promise<string> {
  const cfg = await loadConfig();
  return join(cfg.contextDir, `${name}.md`);
}

async function appendLines(filePath: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  const existing = await readContextFile(filePath);
  const seen = new Set(
    existing
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim())
  );
  const fresh = lines.filter((l) => !seen.has(l.trim()));
  if (fresh.length === 0) return;
  const newContent = existing.trimEnd() + "\n" + fresh.map((l) => `- ${l}`).join("\n") + "\n";
  await writeContextFile(filePath, newContent);
}

const EXTRACT_SYSTEM = `You are a fact extractor for a context memory system.
Given a conversation turn, extract NEW facts that should be saved to context files.
Only extract facts explicitly stated — never infer or invent.
Return ONLY valid JSON. If nothing new, return empty arrays.`;

function buildExtractPrompt(
  message: string,
  response: string,
  domains: string[],
  existingContent: Record<string, string>
): string {
  const existing = Object.entries(existingContent)
    .map(([k, v]) => `[${k}]\n${v}`)
    .join("\n\n");

  return `Existing context (do NOT re-extract what is already here):
${existing || "none"}

New conversation turn:
USER: ${message}
ASSISTANT: ${response}

Active domains: ${domains.join(", ") || "none"}

Extract NEW facts and return JSON with this exact shape:
{
  "domain_updates": {
    "<domain_name>": ["new fact 1", "new fact 2"]
  },
  "decisions": ["any new decisions made"],
  "goals": ["any new goals stated"],
  "constraints": ["any new constraints mentioned"]
}

Rules:
- Only include facts not already in existing context
- domain_updates keys must match one of the active domains (or "general")
- Return {} for any section with nothing new`;
}

export interface UpdateResult {
  domainsUpdated: string[];
  factsAdded: number;
  skipped: boolean;
}

/**
 * Extract new facts from a conversation turn and write them to context files.
 * Uses Haiku to diff against existing content — no duplicates written.
 */
export async function extractAndUpdate(
  message: string,
  response: string,
  domains: string[]
): Promise<UpdateResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { domainsUpdated: [], factsAdded: 0, skipped: true };
  }

  const cfg = await loadConfig();

  const existingContent: Record<string, string> = {};
  for (const domain of domains) {
    existingContent[domain] = await readContextFile(await domainPath(domain));
  }
  existingContent["decisions"] = await readContextFile(await corePath("decisions"));
  existingContent["goals"] = await readContextFile(await corePath("goals"));
  existingContent["constraints"] = await readContextFile(await corePath("constraints"));

  const client = new Anthropic();
  const res = await client.messages.create({
    model: cfg.haikuModel,
    max_tokens: 512,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: buildExtractPrompt(message, response, domains, existingContent),
      },
    ],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text.trim() : "{}";

  let parsed: {
    domain_updates?: Record<string, string[]>;
    decisions?: string[];
    goals?: string[];
    constraints?: string[];
  };

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { domainsUpdated: [], factsAdded: 0, skipped: true };
  }

  const domainsUpdated: string[] = [];
  let factsAdded = 0;

  for (const [domain, facts] of Object.entries(parsed.domain_updates ?? {})) {
    if (!Array.isArray(facts) || facts.length === 0) continue;
    await appendLines(await domainPath(domain), facts);
    domainsUpdated.push(domain);
    factsAdded += facts.length;
  }

  if (parsed.decisions?.length) {
    await appendLines(await corePath("decisions"), parsed.decisions);
    domainsUpdated.push("decisions");
    factsAdded += parsed.decisions.length;
  }
  if (parsed.goals?.length) {
    await appendLines(await corePath("goals"), parsed.goals);
    domainsUpdated.push("goals");
    factsAdded += parsed.goals.length;
  }
  if (parsed.constraints?.length) {
    await appendLines(await corePath("constraints"), parsed.constraints);
    domainsUpdated.push("constraints");
    factsAdded += parsed.constraints.length;
  }

  return { domainsUpdated, factsAdded, skipped: false };
}

/**
 * Directly write a fact to a domain file (no API call).
 */
export async function writeFact(domain: string, fact: string): Promise<void> {
  await appendLines(await domainPath(domain), [fact]);
}
