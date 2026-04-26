import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { routeIntent } from "./router/intent-router.js";
import { compress, renderSummary } from "./summarizer/compressor.js";
import { extractAndUpdate } from "./context/file-manager.js";
import type { InjectionResult, SessionState, Turn, UpdatePayload } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = join(__dirname, "../context");
const SESSION_FILE = join(__dirname, "../context/.session.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function loadSession(): Promise<SessionState> {
  if (!existsSync(SESSION_FILE)) {
    return { turnCount: 0, totalTokensUsed: 0, summaryExists: false, lastSummary: null };
  }
  const raw = await readFile(SESSION_FILE, "utf-8");
  return JSON.parse(raw) as SessionState;
}

async function saveSession(state: SessionState): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2), "utf-8");
}

async function loadFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "";
  return readFile(filePath, "utf-8");
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

/**
 * ctx_inject: called before every prompt.
 * Detects domains from the message, loads relevant files,
 * returns assembled context string.
 */
async function handleInject(message: string): Promise<InjectionResult> {
  const filesLoaded: string[] = [];
  const parts: string[] = [];

  // Always load: goals + constraints + decisions
  const coreFiles = ["goals.md", "constraints.md", "decisions.md"];
  for (const file of coreFiles) {
    const content = await loadFile(join(CONTEXT_DIR, file));
    if (content.trim()) {
      parts.push(`## ${file.replace(".md", "")}\n${content.trim()}`);
      filesLoaded.push(file);
    }
  }

  // Domain detection: intent router (keyword → Haiku fallback)
  const { domains, method } = await routeIntent(message);
  for (const domain of domains) {
    const content = await loadFile(join(CONTEXT_DIR, "domains", `${domain}.md`));
    if (content.trim()) {
      parts.push(`## domain: ${domain}\n${content.trim()}`);
      filesLoaded.push(`domains/${domain}.md`);
    }
  }
  if (method !== "none") {
    filesLoaded.push(`[routed via ${method}]`);
  }

  // Append structured summary if exists
  const session = await loadSession();
  if (session.summaryExists && session.lastSummary) {
    parts.push(`## conversation summary\n${renderSummary(session.lastSummary)}`);
  }

  const context = parts.join("\n\n---\n\n");
  return {
    context,
    filesLoaded,
    tokenEstimate: estimateTokens(context),
  };
}

/**
 * ctx_update: called after every response.
 * Extracts new facts/decisions from the exchange and appends to files.
 */
// In-memory turn buffer — holds raw turns since last compression
const turnBuffer: Turn[] = [];

async function handleUpdate(payload: UpdatePayload): Promise<string> {
  const session = await loadSession();
  session.turnCount += 1;
  session.totalTokensUsed += estimateTokens(payload.message + payload.response);

  turnBuffer.push({ role: "user", content: payload.message });
  turnBuffer.push({ role: "assistant", content: payload.response });

  // Auto-update context files with new facts from this turn
  const fileUpdate = await extractAndUpdate(
    payload.message,
    payload.response,
    payload.detectedDomains
  );

  // Trigger compressor when buffer exceeds threshold
  const result = await compress(
    turnBuffer,
    session.lastSummary,
    session.turnCount
  );

  let note = "";
  if (result) {
    session.summaryExists = true;
    session.lastSummary = result.summary;
    turnBuffer.length = 0; // clear buffer after compression
    note = ` | Compressed: saved ~${result.savedTokens} tokens`;
  }

  const fileNote = fileUpdate.factsAdded > 0
    ? ` | +${fileUpdate.factsAdded} facts → ${fileUpdate.domainsUpdated.join(", ")}`
    : "";

  await saveSession(session);
  return `Turn ${session.turnCount} | ~${session.totalTokensUsed} tokens used${note}${fileNote}`;
}

/**
 * ctx_reset: clears session state, keeps permanent context files.
 */
async function handleReset(): Promise<string> {
  turnBuffer.length = 0;
  const fresh: SessionState = {
    turnCount: 0,
    totalTokensUsed: 0,
    summaryExists: false,
    lastSummary: null,
  };
  await saveSession(fresh);
  return "Session reset. Context files preserved.";
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "ctx-flow", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ctx_inject",
      description:
        "Returns relevant context to prepend to a prompt. Call this before every LLM request.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The incoming user message",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "ctx_update",
      description:
        "Updates session state after a response. Call this after every LLM response.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The user message" },
          response: { type: "string", description: "The LLM response" },
          detectedDomains: {
            type: "array",
            items: { type: "string" },
            description: "Domains detected in this turn",
          },
        },
        required: ["message", "response", "detectedDomains"],
      },
    },
    {
      name: "ctx_reset",
      description:
        "Resets the current session. Context files (goals, constraints, decisions) are preserved.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "ctx_write_fact",
      description:
        "Directly write a new fact to a domain context file. Use when a user states something that should be remembered (e.g. 'we switched to MongoDB').",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Domain file to update (e.g. 'database', 'auth', 'ui')" },
          fact: { type: "string", description: "The fact to record" },
        },
        required: ["domain", "fact"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "ctx_inject") {
    const result = await handleInject(args?.message as string);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === "ctx_update") {
    const payload: UpdatePayload = {
      message: args?.message as string,
      response: args?.response as string,
      detectedDomains: (args?.detectedDomains as string[]) ?? [],
    };
    const msg = await handleUpdate(payload);
    return { content: [{ type: "text", text: msg }] };
  }

  if (name === "ctx_reset") {
    const msg = await handleReset();
    return { content: [{ type: "text", text: msg }] };
  }

  if (name === "ctx_write_fact") {
    const { writeFact } = await import("./context/file-manager.js");
    await writeFact(args?.domain as string, args?.fact as string);
    return { content: [{ type: "text", text: `Saved to ${args?.domain}: ${args?.fact}` }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ctx-flow MCP server running");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
