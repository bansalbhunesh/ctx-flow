import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = join(__dirname, "../../context");
const DOMAINS_DIR = join(CONTEXT_DIR, "domains");

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// ── File I/O ──────────────────────────────────────────────────────────────────

export async function readContextFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "";
  return readFile(filePath, "utf-8");
}

export async function writeContextFile(filePath: string, content: string): Promise<void> {
  if (!existsSync(DOMAINS_DIR)) mkdirSync(DOMAINS_DIR, { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

function domainPath(domain: string): string {
  return join(DOMAINS_DIR, `${domain}.md`);
}

function corePath(name: string): string {
  return join(CONTEXT_DIR, `${name}.md`);
}

// ── Append helpers ────────────────────────────────────────────────────────────

async function appendLines(filePath: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  const existing = await readContextFile(filePath);
  const newContent = existing.trimEnd() + "\n" + lines.map((l) => `- ${l}`).join("\n") + "\n";
  await writeContextFile(filePath, newContent);
}

// ── Extraction prompt ─────────────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

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

  // Load existing content so Haiku can avoid duplicates
  const existingContent: Record<string, string> = {};
  for (const domain of domains) {
    existingContent[domain] = await readContextFile(domainPath(domain));
  }
  existingContent["decisions"] = await readContextFile(corePath("decisions"));
  existingContent["goals"] = await readContextFile(corePath("goals"));
  existingContent["constraints"] = await readContextFile(corePath("constraints"));

  const client = new Anthropic();
  const res = await client.messages.create({
    model: HAIKU_MODEL,
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

  // Write domain updates
  for (const [domain, facts] of Object.entries(parsed.domain_updates ?? {})) {
    if (!Array.isArray(facts) || facts.length === 0) continue;
    await appendLines(domainPath(domain), facts);
    domainsUpdated.push(domain);
    factsAdded += facts.length;
  }

  // Write core file updates
  if (parsed.decisions?.length) {
    await appendLines(corePath("decisions"), parsed.decisions);
    domainsUpdated.push("decisions");
    factsAdded += parsed.decisions.length;
  }
  if (parsed.goals?.length) {
    await appendLines(corePath("goals"), parsed.goals);
    domainsUpdated.push("goals");
    factsAdded += parsed.goals.length;
  }
  if (parsed.constraints?.length) {
    await appendLines(corePath("constraints"), parsed.constraints);
    domainsUpdated.push("constraints");
    factsAdded += parsed.constraints.length;
  }

  return { domainsUpdated, factsAdded, skipped: false };
}

/**
 * Directly write a fact to a domain file (no API call).
 * Use when you already know the domain and fact.
 */
export async function writeFact(domain: string, fact: string): Promise<void> {
  await appendLines(domainPath(domain), [fact]);
}
