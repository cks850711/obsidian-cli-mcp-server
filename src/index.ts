#!/usr/bin/env node
/**
 * Obsidian CLI MCP Server
 *
 * A local-only MCP server that wraps the official Obsidian CLI.
 * - Zero third-party network dependencies (no axios, no fetch)
 * - Configurable command blocklist (see constants.ts)
 * - stdio transport for local use with Claude Desktop / Claude Code
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execObsidian } from "./cli.js";
import { CHARACTER_LIMIT, BLOCKED_COMMANDS } from "./constants.js";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "obsidian-cli-mcp-server",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: obsidian_exec  (using the old .tool() API which is proven to work)
// ---------------------------------------------------------------------------

server.tool(
  "obsidian_exec",
  `Execute any official Obsidian CLI command and return its output.

This tool wraps the \`obsidian\` CLI binary installed on the host machine.
Pass the sub-command and arguments as a single string (without the leading \`obsidian\` binary name).

Blocked commands (configurable): ${BLOCKED_COMMANDS.join(", ")}

Common examples:
  command="search query=\\"meeting notes\\" limit=10"
  command="read file=MyNote"
  command="tasks todo"
  command="tags counts sort=count"
  command="create name=NewNote content=\\"Hello world\\""
  command="properties file=MyNote"
  command="backlinks file=MyNote"
  command="files folder=Projects ext=md"
  command="bookmarks"
  command="help search"

For a full list of commands, use: command="help"

Args:
  - command (string, required): The CLI sub-command and arguments
  - vault (string, optional): Target vault name

Returns:
  The raw stdout from the CLI. If the command fails, stderr and exit code are included.`,
  {
    command: z
      .string()
      .min(1, "Command must not be empty")
      .describe(
        'The Obsidian CLI command to execute, e.g. "search query=hello limit=5" or "read file=MyNote". ' +
        "Do NOT include the leading `obsidian` binary name — just the sub-command and its arguments."
      ),
    vault: z
      .string()
      .optional()
      .describe("Target a specific vault by name. Omit to use the active vault."),
  },
  async (params) => {
    try {
      // Append vault= if specified
      let fullCommand = params.command;
      if (params.vault) {
        fullCommand += ` vault="${params.vault}"`;
      }

      const result = await execObsidian(fullCommand);

      // Build response text — always combine stdout + stderr
      // because some CLI commands write output to stderr
      const parts: string[] = [];
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(result.stderr);
      if (result.exitCode !== 0) parts.push(`\nExit code: ${result.exitCode}`);
      let text = parts.join("\n");

      // Truncate if too long
      if (text.length > CHARACTER_LIMIT) {
        text =
          text.slice(0, CHARACTER_LIMIT) +
          `\n\n[Truncated — output exceeded ${CHARACTER_LIMIT} characters. Use limit= or filters to narrow results.]`;
      }

      return {
        content: [{ type: "text" as const, text: text || "(no output)" }],
        ...(result.exitCode !== 0 ? { isError: true } : {}),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error executing Obsidian CLI: ${message}\n\nMake sure:\n1. Obsidian is running\n2. CLI is enabled in Settings → General → Command line interface\n3. The \`obsidian\` binary is in your PATH (or set OBSIDIAN_CLI_PATH env var)`,
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: obsidian_blocked_commands
// ---------------------------------------------------------------------------

server.tool(
  "obsidian_blocked_commands",
  "Returns the list of Obsidian CLI commands that are blocked by this MCP server for safety reasons.",
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: `Blocked commands:\n${BLOCKED_COMMANDS.map((c) => `  - ${c}`).join("\n")}\n\nTo modify, edit src/constants.ts and rebuild.`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("obsidian-cli-mcp-server v0.1.1 running via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
