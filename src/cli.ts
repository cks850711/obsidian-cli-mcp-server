/**
 * Obsidian CLI wrapper.
 *
 * Two execution strategies:
 * 1. HTTP relay (preferred) — sends command to a local relay server
 *    that spawns the obsidian binary. Works in all environments including
 *    Claude Desktop / Cowork where direct spawn hangs.
 * 2. Direct spawn (fallback) — spawns the binary directly. Only works
 *    from terminal-launched processes (e.g. Claude Code).
 *
 * search/search:context use `expect` for pseudo-TTY (direct spawn only).
 */

import { spawn } from "node:child_process";
import { request } from "node:http";
import { BLOCKED_COMMANDS, EXEC_TIMEOUT_MS, DEFAULT_CLI_BINARY, RELAY_PORT } from "./constants.js";
import { parseCommandArgs, tclQuote } from "./parse-args.js";

const CLI_BINARY = process.env.OBSIDIAN_CLI_PATH ?? DEFAULT_CLI_BINARY;
const TTY_COMMANDS = new Set(["search", "search:context"]);

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function isBlocked(command: string): boolean {
  const lower = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return BLOCKED_COMMANDS.some((blocked) => lower === blocked.toLowerCase());
}

function cleanTtyOutput(raw: string): string {
  return raw
    .replace(/\^D/g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

// ── HTTP relay ───────────────────────────────────────────────

function execViaRelay(command: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command });
    const req = request(
      {
        hostname: "127.0.0.1",
        port: RELAY_PORT,
        path: "/exec",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: EXEC_TIMEOUT_MS + 2000, // give relay a bit more time than the CLI timeout
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            resolve({ stdout: data.stdout ?? "", stderr: data.stderr ?? "", exitCode: data.exitCode ?? 1 });
          } catch {
            reject(new Error("Invalid JSON from relay"));
          }
        });
      }
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("Relay timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Direct spawn (fallback) ──────────────────────────────────

function execWithExpect(command: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const args = parseCommandArgs(command);
    const tclArgs = args.map(tclQuote).join(" ");
    const expectScript = `spawn ${tclQuote(CLI_BINARY)} ${tclArgs}; expect eof`;

    const child = spawn("expect", ["-c", expectScript], {
      timeout: EXEC_TIMEOUT_MS,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout!.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr!.on("data", (c: Buffer) => stderrChunks.push(c));

    child.on("close", (code) => {
      let stdout = cleanTtyOutput(Buffer.concat(stdoutChunks).toString("utf-8"));
      const i = stdout.indexOf("\n");
      if (i !== -1 && stdout.substring(0, i).includes("spawn")) {
        stdout = stdout.substring(i + 1);
      }
      resolve({ stdout, stderr: cleanTtyOutput(Buffer.concat(stderrChunks).toString("utf-8")), exitCode: code ?? 1 });
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: `Spawn error: ${err.message}`, exitCode: 1 });
    });
  });
}

function execDirectSpawn(command: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const args = parseCommandArgs(command);
    const child = spawn(CLI_BINARY, args, {
      timeout: EXEC_TIMEOUT_MS,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout!.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr!.on("data", (c: Buffer) => stderrChunks.push(c));

    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: `Spawn error: ${err.message}`, exitCode: 1 });
    });
  });
}

function execDirectLocal(command: string): Promise<CliResult> {
  const trimmed = command.trim();
  const subcommand = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (TTY_COMMANDS.has(subcommand)) {
    return execWithExpect(trimmed);
  }
  return execDirectSpawn(trimmed);
}

// ── Public API ───────────────────────────────────────────────

export async function execObsidian(rawCommand: string): Promise<CliResult> {
  const trimmed = rawCommand.trim();

  if (!trimmed) {
    return { stdout: "", stderr: "Error: Empty command.", exitCode: 1 };
  }

  const subcommand = trimmed.split(/\s+/)[0] ?? "";
  if (isBlocked(subcommand)) {
    return {
      stdout: "",
      stderr: `Error: Command "${subcommand}" is blocked for safety. Edit constants.ts BLOCKED_COMMANDS to change this.`,
      exitCode: 1,
    };
  }

  // Try HTTP relay first, fall back to direct spawn
  try {
    return await execViaRelay(trimmed);
  } catch {
    // Relay not running — fall back to direct spawn (works in Claude Code)
    return execDirectLocal(trimmed);
  }
}
