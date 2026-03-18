#!/usr/bin/env node
/**
 * Obsidian CLI Relay Server
 *
 * A tiny HTTP server that spawns the Obsidian CLI binary on behalf of
 * the MCP server. Must be started from a terminal (not Claude Desktop)
 * because the Obsidian Electron binary hangs when spawned by Claude
 * Desktop's process tree.
 *
 * Usage:
 *   npx tsx src/relay-server.ts          # development
 *   node dist/relay-server.js            # after build
 *
 * The server listens on 127.0.0.1:27182 (override with OBSIDIAN_RELAY_PORT).
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { BLOCKED_COMMANDS, EXEC_TIMEOUT_MS, DEFAULT_CLI_BINARY, RELAY_PORT } from "./constants.js";
import { parseCommandArgs, tclQuote } from "./parse-args.js";

const CLI_BINARY = process.env.OBSIDIAN_CLI_PATH ?? DEFAULT_CLI_BINARY;
const TTY_COMMANDS = new Set(["search", "search:context"]);

function isBlocked(command: string): boolean {
  const lower = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return BLOCKED_COMMANDS.some((b) => lower === b.toLowerCase());
}

function cleanTtyOutput(raw: string): string {
  return raw
    .replace(/\^D/g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

interface ExecResult { stdout: string; stderr: string; exitCode: number; }

function runCommand(command: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const trimmed = command.trim();
    const subcommand = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
    const needsTTY = TTY_COMMANDS.has(subcommand);

    let child;
    if (needsTTY) {
      const args = parseCommandArgs(trimmed);
      const tclArgs = args.map(tclQuote).join(" ");
      const expectScript = `spawn ${tclQuote(CLI_BINARY)} ${tclArgs}; expect eof`;
      child = spawn("expect", ["-c", expectScript], {
        timeout: EXEC_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      const args = parseCommandArgs(trimmed);
      child = spawn(CLI_BINARY, args, {
        timeout: EXEC_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout!.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr!.on("data", (c: Buffer) => stderrChunks.push(c));

    child.on("close", (code) => {
      let stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (needsTTY) {
        stdout = cleanTtyOutput(stdout);
        const i = stdout.indexOf("\n");
        if (i !== -1 && stdout.substring(0, i).includes("spawn")) {
          stdout = stdout.substring(i + 1);
        }
      }

      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: `Spawn error: ${err.message}`, exitCode: 1 });
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/exec") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    try {
      const { command } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      if (!command || typeof command !== "string") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing command" }));
        return;
      }

      const sub = command.trim().split(/\s+/)[0] ?? "";
      if (isBlocked(sub)) {
        res.writeHead(200);
        res.end(JSON.stringify({ stdout: "", stderr: `Command "${sub}" is blocked.`, exitCode: 1 }));
        return;
      }

      console.log(`[relay] ${command}`);
      const result = await runCommand(command);
      console.log(`[relay] exit=${result.exitCode} stdout=${result.stdout.length}chars`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(RELAY_PORT, "127.0.0.1", () => {
  console.log(`[relay] Obsidian CLI relay server listening on http://127.0.0.1:${RELAY_PORT}`);
  console.log(`[relay] CLI binary: ${CLI_BINARY}`);
  console.log(`[relay] Press Ctrl+C to stop`);
});
