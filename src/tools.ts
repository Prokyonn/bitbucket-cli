import { BitbucketClient, PULL_REQUEST_STATES, PullRequestState } from "./bitbucket-client.js";

/**
 * Single source of truth for the Bitbucket tools: the CLI (`src/cli.ts`) and the
 * script runner (`src/script.ts`) both call them by name. The shape (name,
 * description, JSON schema) is the one an MCP server would expose.
 */

export interface JsonSchemaProperty {
  type?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  description?: string;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition<TArgs = Record<string, any>> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  run: (client: BitbucketClient, args: TArgs) => Promise<unknown>;
}

function defineTool<TArgs>(definition: ToolDefinition<TArgs>): ToolDefinition {
  return definition as ToolDefinition;
}

const REPO: JsonSchemaProperty = {
  type: "string",
  description: "Repository as workspace/slug, e.g. my-workspace/my-repo",
};

const ID: JsonSchemaProperty = {
  type: "number",
  description: "Pull request ID, the number at the end of its URL",
};

/** A tool that takes nothing but the pull request it acts on. */
function pullRequestTool(
  name: string,
  description: string,
  run: (client: BitbucketClient, repo: string, id: number) => Promise<unknown>,
): ToolDefinition {
  return defineTool<{ repo: string; id: number }>({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID },
      required: ["repo", "id"],
    },
    run: (client, args) => run(client, args.repo, args.id),
  });
}

export const tools: ToolDefinition[] = [
  defineTool<Record<string, never>>({
    name: "get_current_user",
    description:
      "Get the Bitbucket account the credentials belong to. Its uuid and account_id identify " +
      "you among a pull request's participants and comment authors.",
    inputSchema: { type: "object", properties: {} },
    run: (client) => client.getCurrentUser(),
  }),

  defineTool<{ repo: string; state?: PullRequestState[]; limit?: number }>({
    name: "list_pull_requests",
    description:
      "List a repository's pull requests, most recently updated first. Only open ones " +
      "unless --state says otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        state: {
          type: "array",
          items: { type: "string", enum: PULL_REQUEST_STATES },
          description: "States to include (default OPEN)",
        },
        limit: { type: "number", description: "Most pull requests to return (default 50)" },
      },
      required: ["repo"],
    },
    run: (client, args) =>
      client.listPullRequests(args.repo, { states: args.state, limit: args.limit }),
  }),

  pullRequestTool(
    "get_pull_request",
    "Get a pull request: title, description, state, author, source and destination branch " +
      "with their commits, and the participants with their approvals and change requests.",
    (client, repo, id) => client.getPullRequest(repo, id),
  ),

  pullRequestTool(
    "get_pull_request_diff",
    "Get a pull request's changes as a unified diff, printed as plain text.",
    (client, repo, id) => client.getPullRequestDiff(repo, id),
  ),

  pullRequestTool(
    "get_pull_request_diffstat",
    "List the files a pull request changes, with their status and the lines added and removed.",
    (client, repo, id) => client.getPullRequestDiffstat(repo, id),
  ),

  pullRequestTool(
    "list_pull_request_commits",
    "List the commits a pull request would merge.",
    (client, repo, id) => client.listPullRequestCommits(repo, id),
  ),

  pullRequestTool(
    "list_pull_request_comments",
    "List a pull request's comments, oldest first: general and inline ones (see inline), " +
      "and replies (see parent.id).",
    (client, repo, id) => client.listPullRequestComments(repo, id),
  ),

  defineTool<{
    repo: string;
    id: number;
    content: string;
    path?: string;
    line?: number;
    startLine?: number;
    parentId?: number;
  }>({
    name: "add_pull_request_comment",
    description:
      "Comment on a pull request. Without --path the comment is general; with --path and " +
      "--line it sits on that line of the new version of the file (--startLine makes it a " +
      "range); with --parentId it replies to that comment.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        id: ID,
        content: { type: "string", description: "The comment, in Markdown" },
        path: { type: "string", description: "File to comment on, as in the diff" },
        line: {
          type: "number",
          description: "Line in the new version of the file; the last line of a range",
        },
        startLine: { type: "number", description: "First line of a range" },
        parentId: { type: "number", description: "ID of the comment to reply to" },
      },
      required: ["repo", "id", "content"],
    },
    run: (client, args) =>
      client.addPullRequestComment(args.repo, args.id, {
        content: args.content,
        path: args.path,
        line: args.line,
        startLine: args.startLine,
        parentId: args.parentId,
      }),
  }),

  pullRequestTool(
    "approve_pull_request",
    "Approve a pull request as the authenticated user.",
    (client, repo, id) => client.approvePullRequest(repo, id),
  ),

  pullRequestTool(
    "unapprove_pull_request",
    "Withdraw your approval of a pull request.",
    async (client, repo, id) => {
      await client.unapprovePullRequest(repo, id);
      return { ok: true };
    },
  ),

  pullRequestTool(
    "request_changes",
    "Request changes on a pull request as the authenticated user.",
    (client, repo, id) => client.requestChanges(repo, id),
  ),

  pullRequestTool(
    "remove_request_changes",
    "Withdraw your request for changes on a pull request.",
    async (client, repo, id) => {
      await client.removeRequestChanges(repo, id);
      return { ok: true };
    },
  ),
];

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition | undefined {
  return toolsByName.get(name);
}
