import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const TEMPLATES: Record<string, string> = {
  "goals.md": "# Project Goals\n\n- \n",
  "constraints.md": "# Constraints\n\n- \n",
  "decisions.md": "# Decisions\n\n- \n",
  "domains/auth.md": "# Auth Domain\n\n- \n",
  "domains/api.md": "# API Domain\n\n- \n",
  "domains/ui.md": "# UI Domain\n\n- \n",
  "domains/database.md": "# Database Domain\n\n- \n",
};

async function readPackageVersion(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

function helpText(version: string): string {
  return `ctx-flow v${version}

Intent-aware context injection MCP plugin for Claude Code.

Usage:
  ctx-flow [command] [options]

Commands:
  mcp                     Start the MCP server (default if no command given)
  init [dir]              Scaffold context/ directory in the given dir (default: cwd)
  --version, -v           Print the installed version
  --help, -h              Print this help

Environment:
  ANTHROPIC_API_KEY       Required for Haiku-powered routing/extraction/summarization
  CTX_FLOW_CONFIG         Path to a config file (default: ./ctx-flow.config.json)
  CTX_FLOW_CONTEXT_DIR    Override the context directory

See https://github.com/bansalbhunesh/ctx-flow for full documentation.
`;
}

export async function init(targetDir: string): Promise<{ created: number; skipped: number }> {
  const root = join(targetDir, "context");
  const domains = join(root, "domains");
  if (!existsSync(domains)) await mkdir(domains, { recursive: true });

  let created = 0;
  let skipped = 0;
  for (const [rel, content] of Object.entries(TEMPLATES)) {
    const path = join(root, rel);
    if (existsSync(path)) {
      skipped++;
      continue;
    }
    await writeFile(path, content, "utf-8");
    created++;
  }
  return { created, skipped };
}

export async function run(argv: string[]): Promise<void> {
  const cmd = argv[0];

  if (cmd === "--version" || cmd === "-v") {
    console.log(await readPackageVersion());
    return;
  }

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(helpText(await readPackageVersion()));
    return;
  }

  if (cmd === "init") {
    const target = argv[1] ?? process.cwd();
    const { created, skipped } = await init(target);
    console.log(`Scaffolded context/ in ${target}`);
    console.log(`  ${created} files created, ${skipped} skipped (already existed)`);
    return;
  }

  if (cmd === "mcp" || cmd === undefined) {
    const { startServer } = await import("./index.js");
    await startServer();
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  console.error(helpText(await readPackageVersion()));
  process.exit(1);
}

// Auto-run when invoked directly (e.g. `node dist/cli.js`). The bin shim
// imports run() and calls it itself, so this only fires for direct invocation.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
