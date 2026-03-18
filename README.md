# obsidian-cli-mcp-server

A local MCP server that wraps the [official Obsidian CLI](https://obsidian.md/blog/obsidian-cli/) (v1.12+), giving LLM agents full access to 80+ vault operations through a single tool.

- **Zero network dependencies** — no API keys, no cloud services; everything runs locally
- **Single-tool design** — one `obsidian_exec` tool accepts any CLI command, so new Obsidian CLI features work instantly without updating the server
- **Safety-first** — dangerous commands (`eval`, `devtools`, etc.) are blocked at two layers; all execution uses `spawn` without shell interpretation, preventing command injection
- **Dual execution mode** — direct spawn for terminal environments + HTTP relay for Electron-hosted clients (Claude Desktop, Cowork)

## Prerequisites

- [Obsidian](https://obsidian.md/) **v1.12.4+** with CLI enabled
  (Settings → General → Command line interface)
- The `obsidian` binary in your `PATH` (or set `OBSIDIAN_CLI_PATH`)
- **Node.js ≥ 18**
- `expect` (pre-installed on macOS; needed for `search` / `search:context`)

## Quick Start

```bash
# Clone and build
git clone https://github.com/cks850711/obsidian-cli-mcp-server.git
cd obsidian-cli-mcp-server
npm install
npm run build
```

## Configuration

### Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "obsidian-cli": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-cli-mcp-server/dist/index.js"]
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "obsidian-cli": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-cli-mcp-server/dist/index.js"]
    }
  }
}
```

> **Note:** Claude Desktop is an Electron app, and spawning the Obsidian CLI (also Electron) from it causes a SingletonSocket IPC conflict. You must start the HTTP relay server from a terminal first — see [HTTP Relay](#http-relay) below.

## Available Tools

### `obsidian_exec`

Execute any Obsidian CLI sub-command and return its output.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | ✅ | CLI sub-command and arguments (without the leading `obsidian`) |
| `vault` | string | — | Target a specific vault by name |

**Examples:**

```
command="help"
command="read file=MyNote"
command="search query=\"meeting notes\" limit=10"
command="create name=NewNote content=\"Hello world\""
command="files folder=Projects ext=md"
command="tasks todo"
command="tags counts sort=count"
command="properties file=MyNote"
command="backlinks file=MyNote"
command="bookmarks"
```

For the full list of available CLI commands, run `command="help"`.

### `obsidian_blocked_commands`

Returns the list of CLI commands that are blocked by this server for safety reasons. Takes no parameters.

## HTTP Relay

When the MCP server runs inside an Electron process tree (e.g., Claude Desktop), the Obsidian CLI binary hangs due to Electron's SingletonSocket IPC mechanism. The relay server solves this by running in a separate terminal.

```bash
# Start the relay (keep this terminal open)
npm run relay
# Default: http://127.0.0.1:27182
```

The MCP server automatically tries the relay first, then falls back to direct spawn. No configuration needed — just start the relay before using the MCP server from Electron-based clients.

| Environment variable | Default | Description |
|---------------------|---------|-------------|
| `OBSIDIAN_RELAY_PORT` | `27182` | Relay server port |
| `OBSIDIAN_CLI_PATH` | `obsidian` | Path to the Obsidian CLI binary |

## Security

### Blocked Commands

The following commands are blocked by default to prevent unintended side effects:

| Command | Reason |
|---------|--------|
| `eval` | Arbitrary JavaScript execution inside Obsidian |
| `restart` | Restarts the Obsidian app |
| `devtools` | Toggles Electron DevTools |
| `dev:cdp` | Chrome DevTools Protocol — arbitrary method execution |
| `dev:css` | CSS inspection |
| `dev:debug` | Debugger attach/detach |
| `dev:dom` | DOM query |
| `dev:mobile` | Mobile emulation toggle |

The blocklist is enforced at **two layers** — both the MCP server (`cli.ts`) and the relay server (`relay-server.ts`) independently reject blocked commands. To customize, edit `src/constants.ts`.

### Command Injection Prevention

All commands are executed via Node.js `child_process.spawn` **without a shell** (`shell: false` by default). User input is parsed into an argv array by a custom parser (`parse-args.ts`) — not by `sh -c`. This means:

- Shell metacharacters (`;`, `|`, `$()`, `` ` ` ``, `&&`) are **not interpreted**
- The executable is always the fixed `obsidian` binary — it cannot be changed by user input
- No command substitution, variable expansion, or piping is possible

For `search` / `search:context` (which require a TTY), commands are wrapped with `expect`. Arguments are quoted using Tcl brace-quoting (`{...}`), which is fully literal with no substitution.

## Architecture

```
LLM (Claude)
  │
  │  MCP (stdio)
  ▼
┌──────────────────────┐
│  MCP Server          │
│  (index.ts)          │
│                      │
│  obsidian_exec tool  │
│  ┌────────────────┐  │
│  │ isBlocked()    │──│── Layer 1: block dangerous commands
│  │ parseArgs()    │──│── Parse without shell
│  └───────┬────────┘  │
└──────────┼───────────┘
           │
     ┌─────┴──────┐
     ▼             ▼
┌─────────┐  ┌───────────┐
│  Relay  │  │  Direct   │
│  Server │  │  Spawn    │
│ (HTTP)  │  │           │
│ :27182  │  │           │
└────┬────┘  └─────┬─────┘
     │             │
     ▼             ▼
   ┌─────────────────┐
   │  obsidian CLI   │
   │  (Electron)     │
   └─────────────────┘
```

## Development

```bash
npm run dev       # Watch mode (tsx)
npm run build     # Compile TypeScript
npm test          # Run parse-args unit tests
npm run relay     # Start HTTP relay server
```

## License

[MIT](LICENSE)
