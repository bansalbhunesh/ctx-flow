import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { routeIntent } from "./router/intent-router.js";
import { compress, renderSummary } from "./summarizer/compressor.js";
import { extractAndUpdate, writeFact } from "./context/file-manager.js";
import { loadConfig } from "./config.js";
import type { InjectionResult, SessionState, Turn, UpdatePayload } from "./types.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function sessionFilePath(): Promise<string> {
  const cfg = await loadConfig();
  return join(cfg.contextDir, ".session.json");
}

function emptySession(): SessionState {
  return { turnCount: 0, totalTokensUsed: 0, summaryExists: false, lastSummary: null };
}

async function loadSession(): Promise<SessionState> {
  const path = await sessionFilePath();
  if (!existsSync(path)) return emptySession();
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SessionState;
  } catch (err) {
    console.error(`[ctx-flow] could not read session at ${path}, starting fresh:`, err);
    return emptySession();
  }
}

async function saveSession(state: SessionState): Promise<void> {
  const cfg = await loadConfig();
  if (!existsSync(cfg.contextDir)) await mkdir(cfg.contextDir, { recursive: true });
  const path = await sessionFilePath();
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

async function loadFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "";
  return readFile(filePath, "utf-8");
}

/**
 * ctx_inject: called before every prompt.
 */
export async function handleInject(message: string): Promise<InjectionResult> {
  const cfg = await loadConfig();
  const filesLoaded: string[] = [];
  const parts: string[] = [];

  const coreFiles = ["goals.md", "constraints.md", "decisions.md"];
  for (const file of coreFiles) {
    const content = await loadFile(join(cfg.contextDir, file));
    if (content.trim()) {
      parts.push(`## ${file.replace(".md", "")}\n${content.trim()}`);
      filesLoaded.push(file);
    }
  }

  const { domains, method } = await routeIntent(message);
  for (const domain of domains) {
    const content = await loadFile(join(cfg.contextDir, "domains", `${domain}.md`));
    if (content.trim()) {
      parts.push(`## domain: ${domain}\n${content.trim()}`);
      filesLoaded.push(`domains/${domain}.md`);
    }
  }
  if (method !== "none") {
    filesLoaded.push(`[routed via ${method}]`);
  }

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

const turnBuffer: Turn[] = [];

export async function handleUpdate(payload: UpdatePayload): Promise<string> {
  const session = await loadSession();
  session.turnCount += 1;
  session.totalTokensUsed += estimateTokens(payload.message + payload.response);

  turnBuffer.push({ role: "user", content: payload.message });
  turnBuffer.push({ role: "assistant", content: payload.response });

  const fileUpdate = await extractAndUpdate(
    payload.message,
    payload.response,
    payload.detectedDomains
  );

  const result = await compress(turnBuffer, session.lastSummary, session.turnCount);

  let note = "";
  if (result) {
    session.summaryExists = true;
    session.lastSummary = result.summary;
    turnBuffer.length = 0;
    note = ` | Compressed: saved ~${result.savedTokens} tokens`;
  }

  const fileNote =
    fileUpdate.factsAdded > 0
      ? ` | +${fileUpdate.factsAdded} facts -> ${fileUpdate.domainsUpdated.join(", ")}`
      : "";

  await saveSession(session);
  return `Turn ${session.turnCount} | ~${session.totalTokensUsed} tokens used${note}${fileNote}`;
}

export async function handleReset(): Promise<string> {
  turnBuffer.length = 0;
  await saveSession(emptySession());
  return "Session reset. Context files preserved.";
}

function warnIfContextDirLooksWrong(dir: string): void {
  if (!existsSync(dir)) {
    console.error(
      `[ctx-flow] contextDir ${dir} does not exist. Run \`ctx-flow init\` to scaffold one.`
    );
    return;
  }
  const hasGoals = existsSync(join(dir, "goals.md"));
  const hasDomains = existsSync(join(dir, "domains"));
  if (!hasGoals && !hasDomains) {
    console.error(
      `[ctx-flow] contextDir ${dir} has no goals.md or domains/ — context injection will be empty.`
    );
  }
}

export function createServer(version = "1.1.0"): Server {
  const server = new Server({ name: "ctx-flow", version }, { capabilities: { tools: {} } });

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
        description: "Updates session state after a response. Call this after every LLM response.",
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
            domain: {
              type: "string",
              description: "Domain file to update (e.g. 'database', 'auth', 'ui')",
            },
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
      await writeFact(args?.domain as string, args?.fact as string);
      return {
        content: [{ type: "text", text: `Saved to ${args?.domain}: ${args?.fact}` }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

export async function startServer(): Promise<void> {
  const cfg = await loadConfig();
  warnIfContextDirLooksWrong(cfg.contextDir);
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ctx-flow MCP server running");
}
