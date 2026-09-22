#!/usr/bin/env node

import { readFile } from "fs/promises";
import { dirname, resolve as resolvePath } from "path";
import { fileURLToPath } from "url";
import { BitbucketApiError, BitbucketClient } from "./bitbucket-client.js";
import { loadCredentials } from "./config.js";
import { errorMessage, UsageError } from "./errors.js";
import { loadScript, runScript, StepResult } from "./script.js";
import { runSetup, setupHelp, SetupOptions } from "./setup.js";
import { getTool, JsonSchemaProperty, ToolDefinition, tools } from "./tools.js";

/**
 * Command line interface for the Bitbucket tools: every tool is callable by name,
 * either as a single call or as a step of a JSON script.
 */

async function main(argv: string[]): Promise<number> {
  const args = [...argv];

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    if (args[0] === "help" && args[1]) {
      console.log(toolHelp(requireTool(args[1])));
      return 0;
    }
    console.log(generalHelp());
    return 0;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(await readVersion());
    return 0;
  }

  const command = args.shift() as string;

  if (command === "list" || command === "tools") {
    console.log(toolList());
    return 0;
  }

  if (command === "run") {
    return await runScriptCommand(args);
  }

  if (command === "setup") {
    return await setupCommand(args);
  }

  if (command.startsWith("-")) {
    throw new UsageError(`Unknown option '${command}'. Run 'bitbucket --help'.`);
  }

  return await runToolCommand(command, args);
}

async function runToolCommand(name: string, argv: string[]): Promise<number> {
  const tool = requireTool(name);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(toolHelp(tool));
    return 0;
  }

  const { flags, toolArgs } = parseToolArgs(tool, argv);
  validateRequired(tool, toolArgs);

  if (flags.dryRun) {
    console.log(stringify({ tool: tool.name, args: toolArgs }, flags.compact));
    return 0;
  }

  const result = await tool.run(createClient(), toolArgs);
  if (typeof result === "string") {
    // A diff is text; printing it as a JSON string would only make it unreadable.
    process.stdout.write(result);
  } else {
    console.log(stringify(result, flags.compact));
  }
  return 0;
}

async function runScriptCommand(argv: string[]): Promise<number> {
  const flags = { compact: false, dryRun: false, quiet: false, continueOnError: false };
  let file: string | undefined;

  for (const arg of argv) {
    switch (arg) {
      case "--compact":
        flags.compact = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--quiet":
      case "-q":
        flags.quiet = true;
        break;
      case "--continue-on-error":
        flags.continueOnError = true;
        break;
      case "--help":
      case "-h":
        console.log(runHelp());
        return 0;
      default:
        if (arg.startsWith("-") && arg !== "-") {
          throw new UsageError(`Unknown option '${arg}' for 'run'. See 'bitbucket run --help'.`);
        }
        if (file !== undefined) {
          throw new UsageError("Only one script file can be given.");
        }
        file = arg;
    }
  }

  if (!file) {
    throw new UsageError("Missing script file. Usage: bitbucket run <script.json>");
  }

  const script = await loadScript(file === "-" ? "-" : resolvePath(file));
  const client = flags.dryRun ? null : createClient();

  const log = (message: string) => {
    if (!flags.quiet) console.error(message);
  };

  if (script.name) log(`▶ ${script.name}`);

  const results: StepResult[] = await runScript(client, script, {
    dryRun: flags.dryRun,
    continueOnError: flags.continueOnError,
    onStepStart: (step, index) => {
      const label = step.description ?? step.tool;
      log(`[${index + 1}/${script.steps.length}] ${label}${flags.dryRun ? " (dry run)" : ""}`);
    },
    onStepFinish: (result) => {
      if (result.error) log(`    ✖ ${result.error}`);
    },
  });

  console.log(stringify(results, flags.compact));
  return results.some((step) => step.error) ? 1 : 0;
}

async function setupCommand(argv: string[]): Promise<number> {
  const options: SetupOptions = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        console.log(setupHelp());
        return 0;
      case "--reauth":
        options.reauth = true;
        break;
      case "--no-auth":
        options.skipAuth = true;
        break;
      case "--no-agent-skills":
        options.skipSkills = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--email":
      case "--token":
      case "--dir": {
        const value = argv[++index];
        if (value === undefined) {
          throw new UsageError(`Option '${arg}' requires a value.`);
        }
        if (arg === "--email") options.email = value;
        else if (arg === "--token") options.token = value;
        else options.dirs = [...(options.dirs ?? []), value];
        break;
      }
      default:
        throw new UsageError(`Unknown option '${arg}' for 'setup'. See 'bitbucket setup --help'.`);
    }
  }

  return await runSetup(options);
}

interface GlobalFlags {
  compact: boolean;
  dryRun: boolean;
}

function parseToolArgs(
  tool: ToolDefinition,
  argv: string[],
): { flags: GlobalFlags; toolArgs: Record<string, unknown> } {
  const flags: GlobalFlags = { compact: false, dryRun: false };
  const properties = tool.inputSchema.properties;
  const toolArgs: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (token === "--compact") {
      flags.compact = true;
      continue;
    }
    if (token === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (token === "--json" || token.startsWith("--json=")) {
      const raw = token.startsWith("--json=") ? token.slice("--json=".length) : argv[++index];
      if (raw === undefined) {
        throw new UsageError("--json requires a JSON object argument.");
      }
      Object.assign(toolArgs, parseJsonArgs(raw));
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const equals = token.indexOf("=");
    const rawName = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const key = resolveKey(rawName, properties);
    if (!key) {
      throw new UsageError(unknownOptionMessage(tool, token));
    }

    const value = equals === -1 ? argv[++index] : token.slice(equals + 1);
    if (value === undefined) {
      throw new UsageError(`Option '--${rawName}' requires a value.`);
    }

    const property = properties[key];
    if (property.type === "array") {
      const existing = (toolArgs[key] as unknown[] | undefined) ?? [];
      toolArgs[key] = [...existing, ...splitArrayValue(key, value, property)];
      continue;
    }

    toolArgs[key] = coerce(value, property, rawName);
  }

  assignPositionals(tool, positionals, toolArgs);

  return { flags, toolArgs };
}

/**
 * Required arguments may also be passed positionally, in schema order:
 *   bitbucket add_pull_request_comment <repo> <id> "<content>"
 */
function assignPositionals(
  tool: ToolDefinition,
  positionals: string[],
  toolArgs: Record<string, unknown>,
): void {
  if (positionals.length === 0) return;

  const open = (tool.inputSchema.required ?? []).filter((key) => !(key in toolArgs));

  if (positionals.length > open.length) {
    throw new UsageError(
      `Too many positional arguments for '${tool.name}'. ` +
        `Expected at most ${open.length} (${open.join(", ") || "none"}), got ${positionals.length}. ` +
        `Optional arguments must be passed as --flags.`,
    );
  }

  positionals.forEach((value, index) => {
    const key = open[index];
    const property = tool.inputSchema.properties[key];
    toolArgs[key] =
      property.type === "array"
        ? splitArrayValue(key, value, property)
        : coerce(value, property, key);
  });
}

function validateRequired(tool: ToolDefinition, toolArgs: Record<string, unknown>): void {
  const missing = (tool.inputSchema.required ?? []).filter((key) => !(key in toolArgs));
  if (missing.length > 0) {
    throw new UsageError(
      `Missing required argument${missing.length > 1 ? "s" : ""} for '${tool.name}': ` +
        `${missing.map((key) => `--${key}`).join(", ")}\n\n${toolHelp(tool)}`,
    );
  }
}

function parseJsonArgs(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`--json value is not valid JSON: ${errorMessage(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("--json value must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Matches a flag name against the schema, accepting kebab-case spellings. */
function resolveKey(
  rawName: string,
  properties: Record<string, JsonSchemaProperty>,
): string | undefined {
  if (rawName in properties) return rawName;

  const camel = rawName.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
  if (camel in properties) return camel;

  const lowered = rawName.toLowerCase().replace(/-/g, "");
  return Object.keys(properties).find((key) => key.toLowerCase() === lowered);
}

/** Enum lists are comma-separated (their values never contain commas); anything else repeats. */
function splitArrayValue(key: string, value: string, property: JsonSchemaProperty): unknown[] {
  const itemSchema = property.items ?? { type: "string" };
  const items = itemSchema.enum ? value.split(",").map((entry) => entry.trim()) : [value];
  return items.filter((item) => item.length > 0).map((item) => coerce(item, itemSchema, key));
}

function coerce(value: string, property: JsonSchemaProperty, flagName: string): unknown {
  if (property.type === "number") {
    const parsed = Number(value);
    if (value.trim() === "" || Number.isNaN(parsed)) {
      throw new UsageError(`Option '--${flagName}' expects a number, got '${value}'.`);
    }
    return parsed;
  }

  if (property.enum && !property.enum.includes(value)) {
    throw new UsageError(
      `Option '--${flagName}' expects one of: ${property.enum.join(", ")} (got '${value}').`,
    );
  }

  return value;
}

function requireTool(name: string): ToolDefinition {
  const tool = getTool(name);
  if (!tool) {
    const suggestions = tools
      .map((candidate) => candidate.name)
      .filter((candidate) => candidate.includes(name) || name.includes(candidate));
    const hint = suggestions.length > 0 ? `\n\nDid you mean: ${suggestions.join(", ")}?` : "";
    throw new UsageError(
      `Unknown tool '${name}'.${hint}\n\nRun 'bitbucket list' to see all ${tools.length} tools.`,
    );
  }
  return tool;
}

function unknownOptionMessage(tool: ToolDefinition, token: string): string {
  const known = Object.keys(tool.inputSchema.properties)
    .map((key) => `--${key}`)
    .join(", ");
  return `Unknown option '${token}' for '${tool.name}'.\nKnown options: ${known || "none"}`;
}

function createClient(): BitbucketClient {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error(
      "No Bitbucket credentials found.\n\n" +
        "Run 'bitbucket setup' to authenticate, or set BITBUCKET_EMAIL and\n" +
        "BITBUCKET_API_TOKEN in the environment or a .env file in this directory.",
    );
  }
  return new BitbucketClient(credentials);
}

function stringify(value: unknown, compact: boolean): string {
  return compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
}

function describeType(property: JsonSchemaProperty): string {
  if (property.enum) {
    return property.enum.join("|");
  }
  if (property.type === "array") {
    return `${describeType(property.items ?? { type: "string" })}[]`;
  }
  return property.type ?? "string";
}

function toolList(): string {
  const width = Math.max(...tools.map((tool) => tool.name.length));
  const lines = tools.map(
    (tool) => `  ${tool.name.padEnd(width)}  ${firstSentence(tool.description)}`,
  );
  return `Available tools (${tools.length}):\n\n${lines.join("\n")}`;
}

function firstSentence(description: string): string {
  const sentence = description.split(/\.\s/)[0].replace(/\.$/, "");
  return sentence.length > 100 ? `${sentence.slice(0, 97)}...` : sentence;
}

function toolHelp(tool: ToolDefinition): string {
  const { properties, required = [] } = tool.inputSchema;
  const keys = Object.keys(properties);
  const signatures = keys.map((key) => `  --${key} <${describeType(properties[key])}>`);
  const width = Math.max(0, ...signatures.map((signature) => signature.length));

  const lines = keys.map((key, index) => {
    const marker = required.includes(key) ? "[required] " : "";
    return `${signatures[index].padEnd(width)}  ${marker}${properties[key].description ?? ""}`;
  });

  const positional = required.length > 0 ? ` <${required.join("> <")}>` : "";

  return [
    `bitbucket ${tool.name}${positional} [options]`,
    "",
    tool.description,
    "",
    ...(lines.length > 0 ? ["Arguments:", ...lines, ""] : []),
    ...(required.length > 0
      ? ["Required arguments may be passed positionally, in the order shown above."]
      : []),
    "Other options: --json '<object>', --dry-run, --compact",
  ].join("\n");
}

function runHelp(): string {
  return [
    "bitbucket run <script.json> [options]",
    "",
    "Run a JSON script of tool calls, top to bottom. Use '-' to read from stdin.",
    "",
    "Options:",
    "  --dry-run              Check and print the steps without calling Bitbucket",
    "  --continue-on-error    Keep going after a failing step",
    "  --quiet, -q            Suppress progress output on stderr",
    "  --compact              Print the result JSON on a single line",
    "",
    "Script format:",
    "  {",
    '    "name": "Review",',
    '    "steps": [',
    '      { "tool": "add_pull_request_comment", "args": { "repo": "{{env.REPO}}", "id": 42,',
    '        "content": "Missing null check", "path": "src/Controller.php", "line": 17 } },',
    '      { "tool": "request_changes", "args": { "repo": "{{env.REPO}}", "id": 42 } }',
    "    ]",
    "  }",
    "",
    'A step with an "id" can be referenced by later steps as {{id.path.to.value}}.',
    "Environment variables are available as {{env.NAME}}.",
    "A failing step ends the run; the results so far are still printed, and the exit code is 1.",
  ].join("\n");
}

function generalHelp(): string {
  return [
    "bitbucket — read and review Bitbucket Cloud pull requests from the command line",
    "",
    "Usage:",
    "  bitbucket setup                 Authenticate and install the agent skill",
    "  bitbucket <tool> [args...]      Run a single tool",
    "  bitbucket run <script.json>     Run a script of tool calls",
    "  bitbucket list                  List all available tools",
    "  bitbucket help <tool>           Show a tool's arguments",
    "",
    "Examples:",
    "  bitbucket list_pull_requests my-workspace/my-repo --compact",
    "  bitbucket get_pull_request my-workspace/my-repo 42",
    "  bitbucket get_pull_request_diff my-workspace/my-repo 42",
    "  bitbucket add_pull_request_comment my-workspace/my-repo 42 'Typo' --path src/A.php --line 12",
    "  bitbucket run review.json --dry-run",
    "",
    "Options:",
    "  --json '<object>'      Pass arguments as a JSON object (merged with flags)",
    "  --dry-run              Print the resolved call instead of executing it",
    "  --compact              Print result JSON on a single line",
    "  --help, -h             Show this help (or a tool's help)",
    "  --version, -v          Print the package version",
    "",
    "Credentials come from 'bitbucket setup', or from BITBUCKET_EMAIL and",
    "BITBUCKET_API_TOKEN in the environment or a .env file (which take precedence).",
    "",
    `Run 'bitbucket list' to see all ${tools.length} tools.`,
  ].join("\n");
}

async function readVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(resolvePath(here, "../package.json"), "utf8");
  return JSON.parse(raw).version as string;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(errorMessage(error));
    if (error instanceof BitbucketApiError && error.status === 401) {
      console.error("The email or API token was rejected. Run 'bitbucket setup --reauth'.");
    }
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
