import { BitbucketClient } from "../bitbucket-client.js";
import { pullRequestOf, repoOf } from "../repo.js";
import { defineTool, JsonSchemaProperty, ToolDefinition } from "./types.js";

/** Argument shapes and tool shapes that repeat across the groups. */

export const REPO: JsonSchemaProperty = {
  type: "string",
  description:
    "Repository as workspace/slug or a bitbucket.org URL " +
    "(default: the checkout here, or BITBUCKET_REPO)",
};

export const ID: JsonSchemaProperty = {
  type: "number",
  description: "Pull request ID; a pull request URL in 'repo' carries it too",
};

export const LIMIT: JsonSchemaProperty = {
  type: "number",
  description: "Most entries to return (default 50)",
};

export const QUERY: JsonSchemaProperty = {
  type: "string",
  description: 'Bitbucket filter expression, e.g. source.branch.name="feature-x"',
};

export function text(description: string): JsonSchemaProperty {
  return { type: "string", description };
}

export function number(description: string): JsonSchemaProperty {
  return { type: "number", description };
}

export function flag(description: string): JsonSchemaProperty {
  return { type: "boolean", description };
}

export function list(
  description: string,
  options: { enum?: readonly string[]; commaSeparated?: boolean } = {},
): JsonSchemaProperty {
  return {
    type: "array",
    items: { type: "string", enum: options.enum },
    commaSeparated: options.commaSeparated,
    description,
  };
}

/** A tool that acts on a pull request and takes nothing else. */
export function pullRequestTool(
  name: string,
  description: string,
  run: (client: BitbucketClient, repo: string, id: number) => Promise<unknown>,
): ToolDefinition {
  return defineTool<{ repo?: string; id?: number }>({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID },
      positional: ["repo", "id"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return run(client, target.repo, target.id);
    },
  });
}

/** A tool that acts on a repository and takes nothing else. */
export function repositoryTool(
  name: string,
  description: string,
  run: (client: BitbucketClient, repo: string) => Promise<unknown>,
): ToolDefinition {
  return defineTool<{ repo?: string }>({
    name,
    description,
    inputSchema: { type: "object", properties: { repo: REPO }, positional: ["repo"] },
    run: (client, args) => run(client, repoOf(args)),
  });
}
