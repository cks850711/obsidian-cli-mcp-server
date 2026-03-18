/**
 * Command string → argv array parser.
 *
 * Replaces the previous `sh -c` approach which caused shell interpretation
 * of backticks (command substitution) and `$` (variable expansion) inside
 * content values.
 *
 * The parser handles double-quoted and single-quoted regions, stripping
 * quotes while preserving everything inside literally — including backticks,
 * `$`, spaces, etc.
 */

/**
 * Parse a command string into an argv-style array.
 *
 * Examples:
 *   "help"                        → ["help"]
 *   'read file=MyNote'            → ["read", "file=MyNote"]
 *   'create name="My Note"'       → ["create", "name=My Note"]
 *   'create content="```py\n```"' → ["create", "content=```py\n```"]
 */
export function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === '"') {
      // Double-quoted region: take everything literally until closing "
      // Only \" (escaped quote) is special inside.
      i++; // skip opening "
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < command.length && command[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          current += command[i];
          i++;
        }
      }
      i++; // skip closing "
    } else if (ch === "'") {
      // Single-quoted region: everything literal, no escapes
      i++; // skip opening '
      while (i < command.length && command[i] !== "'") {
        current += command[i];
        i++;
      }
      i++; // skip closing '
    } else if (ch === " " || ch === "\t") {
      // Whitespace: end current token
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      i++;
    } else {
      // Regular character
      current += ch;
      i++;
    }
  }

  // Push last token
  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * Quote a string for safe use in a Tcl `expect` script.
 *
 * Tcl curly-brace quoting `{...}` treats all content literally (no
 * variable/command substitution), which is exactly what we need.
 * The only caveat is unbalanced braces — in that case we fall back
 * to Tcl double-quote quoting with proper escapes.
 */
export function tclQuote(s: string): string {
  // Check for unbalanced braces
  let depth = 0;
  let balanced = true;
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) { balanced = false; break; }
  }
  if (depth !== 0) balanced = false;

  if (balanced) {
    // Curly-brace quoting: everything inside is literal
    return `{${s}}`;
  }

  // Fallback: Tcl double-quote quoting
  // Must escape: \ " $ [ ]
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");
  return `"${escaped}"`;
}
