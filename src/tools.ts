import { commentTools } from "./tools/comments.js";
import { defineTool, ToolDefinition } from "./tools/types.js";
import { pipelineTools } from "./tools/pipelines.js";
import { pullRequestTools } from "./tools/pull-requests.js";
import { repositoryTools } from "./tools/repository.js";

export { JsonSchemaProperty, ToolDefinition, ToolInputSchema } from "./tools/types.js";

/**
 * Single source of truth for the Bitbucket tools: the CLI (`src/cli.ts`) and the
 * script runner (`src/script.ts`) both call them by name. The groups are listed
 * in the order the tool list shows them.
 */

const accountTools: ToolDefinition[] = [
  defineTool<Record<string, never>>({
    name: "get_current_user",
    description:
      "Get the Bitbucket account the credentials belong to. Its uuid and account_id identify " +
      "you among a pull request's participants and comment authors.",
    inputSchema: { type: "object", properties: {} },
    run: (client) => client.getCurrentUser(),
  }),

  defineTool<Record<string, never>>({
    name: "list_workspaces",
    description:
      "List the workspaces you belong to, with whether you administrate them. Their slugs are " +
      "the first half of every repository name.",
    inputSchema: { type: "object", properties: {} },
    run: (client) => client.listWorkspaces(),
  }),
];

export const tools: ToolDefinition[] = [
  ...accountTools,
  ...pullRequestTools,
  ...commentTools,
  ...repositoryTools,
  ...pipelineTools,
];

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition | undefined {
  return toolsByName.get(name);
}
