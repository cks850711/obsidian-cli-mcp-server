import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommandArgs, tclQuote } from "./parse-args.js";

describe("parseCommandArgs", () => {
  it("single word", () => {
    assert.deepEqual(parseCommandArgs("help"), ["help"]);
  });

  it("multiple bare words", () => {
    assert.deepEqual(parseCommandArgs("tasks todo"), ["tasks", "todo"]);
  });

  it("key=value without quotes", () => {
    assert.deepEqual(parseCommandArgs("read file=MyNote"), ["read", "file=MyNote"]);
  });

  it("key=value with double quotes", () => {
    assert.deepEqual(
      parseCommandArgs('create name="My Note" overwrite'),
      ["create", "name=My Note", "overwrite"]
    );
  });

  it("key=value with single quotes", () => {
    assert.deepEqual(
      parseCommandArgs("create name='My Note' overwrite"),
      ["create", "name=My Note", "overwrite"]
    );
  });

  it("preserves \\n literals for CLI to interpret", () => {
    assert.deepEqual(
      parseCommandArgs('append file=Test content="line1\\nline2"'),
      ["append", "file=Test", "content=line1\\nline2"]
    );
  });

  it("preserves backticks (the main bug case)", () => {
    assert.deepEqual(
      parseCommandArgs('create name="test" content="Before\\n```python\\nprint(\'hello\')\\n```\\nAfter" overwrite'),
      ["create", "name=test", "content=Before\\n```python\\nprint('hello')\\n```\\nAfter", "overwrite"]
    );
  });

  it("preserves $ signs", () => {
    assert.deepEqual(
      parseCommandArgs('create name="test" content="Price is $100"'),
      ["create", "name=test", "content=Price is $100"]
    );
  });

  it("preserves $(cmd) without interpreting", () => {
    assert.deepEqual(
      parseCommandArgs('create name="test" content="$(whoami)"'),
      ["create", "name=test", "content=$(whoami)"]
    );
  });

  it("escaped double quote inside double quotes", () => {
    assert.deepEqual(
      parseCommandArgs('create content="He said \\"hello\\""'),
      ["create", 'content=He said "hello"']
    );
  });

  it("empty quoted value", () => {
    assert.deepEqual(
      parseCommandArgs('property:set name=tag value=""'),
      ["property:set", "name=tag", "value="]
    );
  });

  it("multiple spaces between tokens", () => {
    assert.deepEqual(
      parseCommandArgs("tasks   todo   verbose"),
      ["tasks", "todo", "verbose"]
    );
  });

  it("leading and trailing spaces", () => {
    assert.deepEqual(
      parseCommandArgs("  help  "),
      ["help"]
    );
  });

  it("complex real-world: search with quoted query", () => {
    assert.deepEqual(
      parseCommandArgs('search query="meeting notes" limit=10'),
      ["search", "query=meeting notes", "limit=10"]
    );
  });

  it("mixed single and double quotes", () => {
    assert.deepEqual(
      parseCommandArgs(`create name='test' content="hello world"`),
      ["create", "name=test", "content=hello world"]
    );
  });

  it("empty string returns empty array", () => {
    assert.deepEqual(parseCommandArgs(""), []);
    assert.deepEqual(parseCommandArgs("   "), []);
  });
});

describe("tclQuote", () => {
  it("simple string uses curly braces", () => {
    assert.equal(tclQuote("hello"), "{hello}");
  });

  it("string with spaces uses curly braces", () => {
    assert.equal(tclQuote("hello world"), "{hello world}");
  });

  it("string with backticks uses curly braces (safe)", () => {
    assert.equal(tclQuote("```python```"), "{```python```}");
  });

  it("string with $ uses curly braces (safe)", () => {
    assert.equal(tclQuote("$HOME"), "{$HOME}");
  });

  it("string with balanced braces uses curly braces", () => {
    assert.equal(tclQuote("a{b}c"), "{a{b}c}");
  });

  it("string with unbalanced braces falls back to double quotes", () => {
    const result = tclQuote("a}b");
    assert.ok(result.startsWith('"') && result.endsWith('"'));
    assert.ok(!result.includes("unescaped"));
  });

  it("fallback escapes special Tcl chars", () => {
    // unbalanced brace forces fallback
    const result = tclQuote('a}b$c[d]e"f\\g');
    assert.equal(result, '"a}b\\$c\\[d\\]e\\"f\\\\g"');
  });
});
