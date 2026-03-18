/**
 * Obsidian CLI MCP Server - Constants
 *
 * Blocked commands, timeout settings, and other configuration.
 * Edit BLOCKED_COMMANDS to customize which CLI commands are disallowed.
 */

/** Commands that are blocked by default for safety reasons. */
export const BLOCKED_COMMANDS: readonly string[] = [
  "eval",          // Arbitrary JavaScript execution
  "restart",       // Restart the Obsidian app
  "devtools",      // Toggle Electron dev tools
  "dev:cdp",       // Chrome DevTools Protocol - arbitrary method execution
  "dev:css",       // CSS inspection
  "dev:debug",     // Debugger attach/detach
  "dev:dom",       // DOM query
  "dev:mobile",    // Mobile emulation toggle
] as const;

/** Maximum response size in characters before truncation. */
export const CHARACTER_LIMIT = 50000;

/** Timeout for CLI command execution in milliseconds. */
export const EXEC_TIMEOUT_MS = 30000;

/** The obsidian binary name. Override with OBSIDIAN_CLI_PATH env var. */
export const DEFAULT_CLI_BINARY = "obsidian";

/** Port for the local relay HTTP server. Override with OBSIDIAN_RELAY_PORT env var. */
export const RELAY_PORT = Number(process.env.OBSIDIAN_RELAY_PORT) || 27182;
