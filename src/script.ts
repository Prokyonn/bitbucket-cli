import { readFile } from "fs/promises";
import { BitbucketClient } from "./bitbucket-client.js";
import { errorMessage, UsageError } from "./errors.js";
import { getTool, tools } from "./tools.js";

/**
 * Script runner: executes a list of tool calls from a JSON file, top to bottom.
 *
 * Steps may reference the output of earlier steps (and the environment) through
 * `{{...}}` placeholders:
 *
 *   { "id": "summary", "tool": "add_pull_request_comment", "args": { "repo": "{{env.REPO}}", "id": 42, "content": "Review" } },
 *   { "tool": "add_pull_request_comment", "args": { "repo": "{{env.REPO}}", "id": 42, "content": "Detail", "parentId": "{{summary.id}}" } }
 *
 * A placeholder that makes up the whole string resolves to the raw value
 * (keeping numbers, booleans and arrays intact); an embedded one is
 * interpolated as text.
 */

export interface ScriptStep {
  /** Optional name so later steps can reference this step's result. */
  id?: string;
  tool: string;
  args?: Record<string, unknown>;
  /** Optional human-readable label shown in the progress output. */
  description?: string;
}

export interface Script {
  name?: string;
  steps: ScriptStep[];
}

export interface StepResult {
  index: number;
  id?: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface RunScriptOptions {
  dryRun?: boolean;
  continueOnError?: boolean;
  onStepStart?: (step: ScriptStep, index: number) => void;
  onStepFinish?: (result: StepResult) => void;
}

/** A script that cannot run as written; like any usage error, it exits with 2. */
export class ScriptError extends UsageError {}

export async function loadScript(filePath: string): Promise<Script> {
  let raw: string;
  try {
    raw = filePath === "-" ? await readStdin() : await readFile(filePath, "utf8");
  } catch (error) {
    throw new ScriptError(`Cannot read script file '${filePath}': ${errorMessage(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ScriptError(`Script '${filePath}' is not valid JSON: ${errorMessage(error)}`);
  }

  return validateScript(parsed, filePath);
}

/**
 * Everything that can be checked without calling Bitbucket is checked here, so a
 * broken script fails before its first comment is posted.
 */
export function validateScript(parsed: unknown, source = "script"): Script {
  const steps = Array.isArray(parsed) ? parsed : (parsed as Script | null)?.steps;

  if (!Array.isArray(steps)) {
    throw new ScriptError(
      `Script '${source}' must be a JSON array of steps, or an object with a "steps" array.`,
    );
  }

  const seenIds = new Set<string>();
  steps.forEach((step: ScriptStep, index: number) => {
    const label = `Step ${index + 1}`;
    if (!step || typeof step !== "object") {
      throw new ScriptError(`${label} of '${source}' must be an object.`);
    }
    if (typeof step.tool !== "string" || step.tool.length === 0) {
      throw new ScriptError(`${label} of '${source}' is missing a "tool" name.`);
    }
    const tool = getTool(step.tool);
    if (!tool) {
      throw new ScriptError(
        `${label} of '${source}' refers to unknown tool '${step.tool}'.\nAvailable tools: ${tools
          .map((candidate) => candidate.name)
          .join(", ")}`,
      );
    }
    if (step.args !== undefined && (typeof step.args !== "object" || Array.isArray(step.args))) {
      throw new ScriptError(`${label} of '${source}' has non-object "args".`);
    }

    const args = step.args ?? {};
    const known = Object.keys(tool.inputSchema.properties);
    const unknown = Object.keys(args).filter((key) => !known.includes(key));
    if (unknown.length > 0) {
      throw new ScriptError(
        `${label} of '${source}' (${step.tool}) has unknown argument${unknown.length > 1 ? "s" : ""} ` +
          `${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
      );
    }
    const missing = (tool.inputSchema.required ?? []).filter((key) => !(key in args));
    if (missing.length > 0) {
      throw new ScriptError(
        `${label} of '${source}' (${step.tool}) is missing ${missing.join(", ")}.`,
      );
    }

    // Placeholders can only point at steps that already ran (or the environment),
    // so typos and forward references are caught before anything hits the API.
    for (const path of collectPlaceholders(args)) {
      const segments = path.split(".").filter((segment) => segment.length > 0);
      if (segments[0] === "env") continue;
      const stepId = segments[0] === "steps" ? segments[1] : segments[0];
      if (!stepId || !seenIds.has(stepId)) {
        throw new ScriptError(
          `${label} of '${source}' references '{{${path}}}', but no earlier step has id '${stepId}'.`,
        );
      }
    }

    if (step.id !== undefined) {
      if (typeof step.id !== "string" || step.id.length === 0) {
        throw new ScriptError(`${label} of '${source}' has an invalid "id".`);
      }
      if (seenIds.has(step.id)) {
        throw new ScriptError(`Duplicate step id '${step.id}' in '${source}'.`);
      }
      seenIds.add(step.id);
    }
  });

  const name = Array.isArray(parsed) ? undefined : (parsed as Script).name;
  return { name, steps: steps as ScriptStep[] };
}

/**
 * Runs the steps in order. A failing step ends the run (unless continueOnError),
 * and the results so far are returned either way, so the caller knows which
 * steps already reached Bitbucket.
 */
export async function runScript(
  client: BitbucketClient | null,
  script: Script,
  options: RunScriptOptions = {},
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const context: Record<string, unknown> = {};

  for (const [index, step] of script.steps.entries()) {
    options.onStepStart?.(step, index);
    const stepResult: StepResult = { index, id: step.id, tool: step.tool, args: step.args ?? {} };

    try {
      // A dry run has no step results to substitute, so unresolved references are
      // left in place rather than failing the run.
      stepResult.args = resolvePlaceholders(step.args ?? {}, context, {
        lenient: options.dryRun === true,
      }) as Record<string, unknown>;

      if (!options.dryRun) {
        stepResult.result = await getTool(step.tool)!.run(client!, stepResult.args);
        if (step.id) {
          context[step.id] = stepResult.result;
        }
      }
    } catch (error) {
      stepResult.error = errorMessage(error);
    }

    results.push(stepResult);
    options.onStepFinish?.(stepResult);
    if (stepResult.error && !options.continueOnError) break;
  }

  return results;
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

interface ResolveOptions {
  lenient?: boolean;
}

function collectPlaceholders(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLACEHOLDER)) {
      found.push(match[1]);
    }
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectPlaceholders(entry, found));
  } else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) =>
      collectPlaceholders(entry, found),
    );
  }
  return found;
}

function resolvePlaceholders(
  value: unknown,
  context: Record<string, unknown>,
  options: ResolveOptions = {},
): unknown {
  if (typeof value === "string") {
    return resolveString(value, context, options);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolvePlaceholders(entry, context, options));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        resolvePlaceholders(entry, context, options),
      ]),
    );
  }
  return value;
}

function resolveString(
  value: string,
  context: Record<string, unknown>,
  options: ResolveOptions,
): unknown {
  const whole = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (whole) {
    return lookup(whole[1], context, options);
  }

  return value.replace(PLACEHOLDER, (match, path: string) => {
    const resolved = lookup(path, context, options);
    if (resolved === match) return match;
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

function lookup(path: string, context: Record<string, unknown>, options: ResolveOptions): unknown {
  const segments = path.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new ScriptError(`Empty placeholder '{{${path}}}'.`);
  }

  if (segments[0] === "env") {
    const name = segments[1];
    const value = name ? process.env[name] : undefined;
    if (value === undefined) {
      throw new ScriptError(`Placeholder '{{${path}}}' refers to unset env var '${name}'.`);
    }
    return value;
  }

  // Both `{{steps.<id>...}}` and the shorter `{{<id>...}}` are accepted.
  const rest = segments[0] === "steps" ? segments.slice(1) : segments;
  const [stepId, ...propertyPath] = rest;

  if (!(stepId in context)) {
    if (options.lenient) return `{{${path}}}`;
    throw new ScriptError(
      `Placeholder '{{${path}}}' refers to step '${stepId}', which has no result yet. ` +
        `Give the earlier step an "id" and make sure it runs first.`,
    );
  }

  let current: unknown = context[stepId];
  for (const segment of propertyPath) {
    if (current === null || current === undefined) {
      throw new ScriptError(`Placeholder '{{${path}}}' resolved to a missing value.`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined) {
    throw new ScriptError(`Placeholder '{{${path}}}' resolved to undefined.`);
  }

  return current;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
