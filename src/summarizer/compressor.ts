import Anthropic from "@anthropic-ai/sdk";
import type { StructuredSummary, Turn } from "../types.js";
import { loadConfig } from "../config.js";
import { isSummary } from "../validation.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function turnsToTokens(turns: Turn[]): number {
  return turns.reduce((sum, t) => sum + estimateTokens(t.content), 0);
}

const SYSTEM_PROMPT = `You are a conversation memory compressor.
Extract structured information from a conversation and return ONLY valid JSON.
Be concise — each list item should be one sentence max.
Only include information explicitly stated. Never invent facts.`;

function buildUserPrompt(turns: Turn[], existing: StructuredSummary | null): string {
  const history = turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n");

  const existingBlock = existing
    ? `\nExisting summary to UPDATE (merge new info in, don't repeat):\n${JSON.stringify(existing, null, 2)}\n`
    : "";

  return `${existingBlock}
Conversation to compress:
${history}

Return JSON with this exact shape:
{
  "goals": [],
  "facts": [],
  "decisions": [],
  "constraints": [],
  "openQuestions": []
}`;
}

export interface CompressResult {
  summary: StructuredSummary;
  tokensBefore: number;
  tokensAfter: number;
  savedTokens: number;
}

/**
 * Compress a list of turns into a StructuredSummary.
 * Merges with existing summary if provided.
 * Returns null if below threshold and force is not set.
 */
export async function compress(
  turns: Turn[],
  existing: StructuredSummary | null,
  turnNumber: number,
  force = false
): Promise<CompressResult | null> {
  const cfg = await loadConfig();
  const tokensBefore = turnsToTokens(turns);

  if (!force && tokensBefore < cfg.tokenThreshold) {
    return null;
  }

  // Returning null keeps the original turns. A placeholder is not a summary.
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.create({
      model: cfg.haikuModel,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(turns, existing) }],
    });
  } catch {
    console.error("[ctx-flow] compression unavailable; retaining original history");
    return null;
  }

  const first = response.content[0];
  const raw = first?.type === "text" ? first.text.trim() : "{}";

  let summary: StructuredSummary;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = { ...parsed, compressedAt: turnNumber };
    if (!isSummary(candidate)) return null;
    summary = candidate;
  } catch {
    return null;
  }

  const tokensAfter = estimateTokens(JSON.stringify(summary));

  return {
    summary,
    tokensBefore,
    tokensAfter,
    savedTokens: tokensBefore - tokensAfter,
  };
}

/**
 * Render a StructuredSummary as a markdown string for prompt injection.
 */
export function renderSummary(summary: StructuredSummary): string {
  const sections: string[] = [`_Conversation compressed at turn ${summary.compressedAt}_`];

  if (summary.goals.length) sections.push(`**Goals:** ${summary.goals.join(" | ")}`);
  if (summary.facts.length) sections.push(`**Facts:** ${summary.facts.join(" | ")}`);
  if (summary.decisions.length) sections.push(`**Decisions:** ${summary.decisions.join(" | ")}`);
  if (summary.constraints.length)
    sections.push(`**Constraints:** ${summary.constraints.join(" | ")}`);
  if (summary.openQuestions.length) sections.push(`**Open:** ${summary.openQuestions.join(" | ")}`);

  return sections.join("\n");
}
