# obsidian-cli-mcp-server

> [!NOTE]
> **Archived (2026-10).** This project is no longer maintained, and this repository is read-only.
>
> It was built while the official Obsidian CLI could not be called from Electron-hosted agents. Spawning the CLI from inside Claude Desktop hung on a SingletonSocket IPC conflict between the two Electron processes, so this server routed calls through an HTTP relay started outside the app, with `expect` supplying a pseudo-TTY and launchd starting the relay on demand.
>
> My setup now runs agents from a terminal (Claude Code), where the `obsidian` binary can be called directly. That makes the MCP layer, the relay, and the launchd agent unnecessary, so I retired them. The code stays as it was at v0.2.0. It should still work if you need an MCP wrapper for an Electron-hosted client.

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

### Auto-Start on Demand (macOS)

Keeping a terminal window open just to host the relay is inconvenient — especially for sandboxed clients (VMs, containers) that can reach the relay over HTTP but cannot start a process on the host.

The included launchd agent solves this: **touching a trigger file starts the relay**. Any client that can write to the repository directory can bring the relay up without a human opening a terminal.

#### Install

```bash
bash scripts/install-relay-agent.sh
```

That is the whole setup — no paths to fill in, no config to edit. The script derives the repository location from its own position on disk, generates the `.plist` accordingly, and loads it with `launchctl`. Re-running it is safe (it reloads in place).

The generated agent lives at `~/Library/LaunchAgents/com.obsidian-cli-mcp-server.relay.plist` and is **not** stored in the repository, so no absolute paths are ever committed.

To remove it:

```bash
bash scripts/install-relay-agent.sh --uninstall
```

#### What it does

Touching the trigger file causes launchd to run `scripts/start-relay.sh`, which:

1. Exits immediately if the relay is already listening (repeated triggers are harmless)
2. Refuses to start if the port is occupied by something else, rather than fighting over it
3. Locates the `obsidian` binary — env var → `PATH` → common install paths → Spotlight — since it lives inside the app bundle and is *not* on launchd's default `PATH`
4. Launches Obsidian if it is not already running (the CLI needs a live instance to talk to)
5. Starts the relay in the foreground, letting launchd own the process

The relay runs with no controlling terminal and no window; its output goes to `logs/relay.log`.

```
Client                       Host (macOS)
──────                       ────────────
relay not responding
      │
      ▼
touch .relay-trigger ──────► launchd notices mtime change
                                    │
                                    ▼
                             start-relay.sh
                               ├─ ensure Obsidian is running
                               └─ start relay on :27182
      │                             │
      ▼                             ▼
retry after ~5s ───────────► relay ──► Obsidian ──► vault
```

#### Triggering it

```bash
touch /path/to/obsidian-cli-mcp-server/.relay-trigger
```

Then wait ~5 seconds and retry. Notes:

- Use `touch`. Creating or deleting the file is unnecessary, and some sandboxes permit `touch` while blocking `unlink`.
- launchd throttles a job to once per 10 seconds — spamming the trigger does nothing.
- The agent is deliberately configured **without** `RunAtLoad` and `KeepAlive`, so the relay starts only when triggered. Add both keys to the generated plist if you would rather have it start at login and restart automatically on crash.

#### Tell your agent about it

Installing the agent is only half of it. Unless the LLM client knows the trigger exists, it will still report "the relay is down" and wait for a human — which is exactly the problem this was meant to remove.

Put the recovery procedure somewhere the client loads **on every session**, not in a doc it has to go looking for: the failure needs to be self-healing at the moment it happens. For Claude Code that means `CLAUDE.md`; other clients have their own equivalent (system prompt, rules file, agent instructions).

Something like:

```markdown
### If the Obsidian relay is not responding

Do not ask me to start it. Recover it yourself:

1. `touch <repo>/.relay-trigger`
2. Wait 5–10 seconds, then retry the command.

A launchd agent on the host watches that file and starts the relay
automatically. Use `touch` — do not create or delete the file. launchd
throttles to once per 10 seconds, so space out retries. Only report back
if two attempts fail, and include the command and error output.
```

Replace `<repo>` with the absolute path to this repository as seen *from the client* — for sandboxed clients that is the path inside the sandbox, not on the host.

#### Troubleshooting

```bash
tail -20 logs/relay.log                                  # what happened
launchctl list | grep obsidian-cli-mcp-server            # is the agent loaded
```

| Symptom | Cause |
|---|---|
| `spawn obsidian ENOENT` | Obsidian not installed, or in a non-standard location — set `OBSIDIAN_CLI_PATH` |
| Relay starts but commands fail | Obsidian's CLI is disabled — enable it in Settings → General → Command line interface |
| Nothing happens on touch | Agent not loaded; re-run the install script |

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
