# Optional ctx-flow MCP server

Source: https://github.com/bansalbhunesh/ctx-flow

Build from a reviewed source checkout with Node.js 20.19+ or a supported newer LTS:

```sh
npm ci
npm run build
node bin/ctx-flow.js --help
```

From the user's project, scaffold missing context files with:

```sh
node /absolute/path/to/ctx-flow/bin/ctx-flow.js init .
```

For Claude Code, register a project-scoped stdio server:

```sh
claude mcp add --scope project --transport stdio ctx-flow -- node /absolute/path/to/ctx-flow/bin/ctx-flow.js mcp
```

Quote paths containing spaces. Claude Code stores project MCP entries in `.mcp.json`. Other clients need the same command and arguments in their own MCP configuration. Set `CTX_FLOW_CONTEXT_DIR` to the absolute project context directory if the client's process starts elsewhere. Never point it at the skill installation directory.

Verify initialization and the availability of `ctx_inject`, `ctx_update`, `ctx_reset`, and `ctx_write_fact` through the client. Registration makes tools available; the host must choose or be instructed to call them.

The optional `ANTHROPIC_API_KEY` enables external API calls. Classification sends the user message; extraction sends the selected notes and turn; compression sends pending turns and the previous summary. Keep secrets out of context. Without the key, file access and keyword routing work locally, and uncompressed history is retained. Do not create or collect a key merely to use the skill's local Markdown workflow.

Configuration is in `ctx-flow.config.json` or the file selected by `CTX_FLOW_CONFIG`. Fields are `contextDir`, `tokenThreshold`, `haikuModel`, and `keywordMap`. Relative `contextDir` paths are resolved from the config file. `CTX_FLOW_CONTEXT_DIR` overrides that setting. Keyword lists extend built-in lists.

The session file is `context/.session.json`. Keep it out of version control. Use separate context directories for independent concurrent sessions; multiple server processes sharing one directory are not coordinated. A failed summary retains pending turns, so context size can grow until compression succeeds or the user requests a reset. The server does not remove the host's existing conversation history.
