import { PULL_REQUEST_STATES, PullRequestState } from "../bitbucket-client.js";
import { MERGE_STRATEGIES, MergeStrategy } from "../params.js";
import { pullRequestOf, repoOf } from "../repo.js";
import { flag, ID, LIMIT, list, QUERY, REPO, pullRequestTool, text } from "./common.js";
import { defineTool, ToolDefinition } from "./types.js";

/** Reading pull requests, and their whole life: create, update, merge, decline. */

export const pullRequestTools: ToolDefinition[] = [
  defineTool<{ repo?: string; state?: PullRequestState[]; query?: string; limit?: number }>({
    name: "list_pull_requests",
    description:
      "List a repository's pull requests, most recently updated first. Only open ones " +
      "unless --state says otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        state: list("States to include (default OPEN)", { enum: PULL_REQUEST_STATES }),
        query: QUERY,
        limit: LIMIT,
      },
      positional: ["repo"],
    },
    run: (client, args) =>
      client.listPullRequests(repoOf(args), {
        states: args.state,
        query: args.query,
        limit: args.limit,
      }),
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
    "list_pull_request_activity",
    "List what happened on a pull request: updates, approvals, change requests and comments, " +
      "newest first.",
    (client, repo, id) => client.listPullRequestActivity(repo, id),
  ),

  defineTool<{
    repo?: string;
    title: string;
    source: string;
    destination?: string;
    description?: string;
    reviewers?: string[];
    closeSourceBranch?: boolean;
    draft?: boolean;
  }>({
    name: "create_pull_request",
    description:
      "Open a pull request from a branch. Without --destination it targets the repository's " +
      "main branch.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        title: text("Title of the pull request"),
        source: text("Source branch to merge from"),
        destination: text("Destination branch (default: the repository's main branch)"),
        description: text("Description, in Markdown"),
        reviewers: list("Reviewers as account ids or {uuid}s", { commaSeparated: true }),
        closeSourceBranch: flag("Delete the source branch when the pull request is merged"),
        draft: flag("Open it as a draft"),
      },
      required: ["title", "source"],
      positional: ["repo", "title", "source"],
    },
    run: (client, args) => client.createPullRequest(repoOf(args), args),
  }),

  defineTool<{
    repo?: string;
    id?: number;
    title?: string;
    description?: string;
    destination?: string;
    reviewers?: string[];
    closeSourceBranch?: boolean;
    draft?: boolean;
  }>({
    name: "update_pull_request",
    description:
      "Change an open pull request: its title, description, destination branch, reviewers or " +
      "draft state. Reviewers replace the current set.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        id: ID,
        title: text("New title"),
        description: text("New description, in Markdown"),
        destination: text("New destination branch"),
        reviewers: list("Reviewers as account ids or {uuid}s; replaces the current set", {
          commaSeparated: true,
        }),
        closeSourceBranch: flag("Delete the source branch when merged"),
        draft: flag("Mark as draft, or --no-draft to publish"),
      },
      positional: ["repo", "id"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.updatePullRequest(target.repo, target.id, args);
    },
  }),

  defineTool<{
    repo?: string;
    id?: number;
    strategy?: MergeStrategy;
    message?: string;
    closeSourceBranch?: boolean;
  }>({
    name: "merge_pull_request",
    description:
      "Merge a pull request. Bitbucket may answer with a task to poll when the merge takes " +
      "a while; read the pull request afterwards to see that it is MERGED.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        id: ID,
        strategy: {
          type: "string",
          enum: MERGE_STRATEGIES,
          description: "Merge strategy (default: the repository's)",
        },
        message: text("Commit message for the merge"),
        closeSourceBranch: flag("Delete the source branch after merging"),
      },
      positional: ["repo", "id"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.mergePullRequest(target.repo, target.id, args);
    },
  }),

  pullRequestTool(
    "decline_pull_request",
    "Decline a pull request, leaving it unmerged.",
    (client, repo, id) => client.declinePullRequest(repo, id),
  ),

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
