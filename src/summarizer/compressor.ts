import Anthropic from "@anthropic-ai/sdk";
import type { StructuredSummary, Turn } from "../types.js";
import { loadConfig } from "../config.js";

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

  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback: StructuredSummary = {
      goals: existing?.goals ?? [],
      facts: [`${turns.length} turns compressed at turn ${turnNumber}`],
      decisions: existing?.decisions ?? [],
      constraints: existing?.constraints ?? [],
      openQuestions: existing?.openQuestions ?? [],
      compressedAt: turnNumber,
    };
    return {
      summary: fallback,
      tokensBefore,
      tokensAfter: estimateTokens(JSON.stringify(fallback)),
      savedTokens: tokensBefore - estimateTokens(JSON.stringify(fallback)),
    };
  }

  const client = new Anthropic();

  const response = await client.messages.create({
    model: cfg.haikuModel,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(turns, existing) }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";

  let parsed: Omit<StructuredSummary, "compressedAt">;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      goals: existing?.goals ?? [],
      facts: [...(existing?.facts ?? []), `Turn ${turnNumber}: parse error on summary`],
      decisions: existing?.decisions ?? [],
      constraints: existing?.constraints ?? [],
      openQuestions: existing?.openQuestions ?? [],
    };
  }

  const summary: StructuredSummary = {
    goals: parsed.goals ?? [],
    facts: parsed.facts ?? [],
    decisions: parsed.decisions ?? [],
    constraints: parsed.constraints ?? [],
    openQuestions: parsed.openQuestions ?? [],
    compressedAt: turnNumber,
  };

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
