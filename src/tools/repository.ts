import { repoOf } from "../repo.js";
import { LIMIT, QUERY, REPO, repositoryTool, text } from "./common.js";
import { defineTool, ToolDefinition } from "./types.js";

/** The repository itself: its branches, commits and files. */

export const repositoryTools: ToolDefinition[] = [
  repositoryTool(
    "get_repository",
    "Get a repository: its main branch, project, size and whether it is private.",
    (client, repo) => client.getRepository(repo),
  ),

  defineTool<{ workspace?: string; query?: string; limit?: number }>({
    name: "list_repositories",
    description:
      "List a workspace's repositories, most recently updated first. Without a workspace, " +
      "the one of the checkout here.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: text("Workspace slug (default: the one of the repository here)"),
        query: QUERY,
        limit: LIMIT,
      },
      positional: ["workspace"],
    },
    run: (client, args) => {
      const workspace = args.workspace ?? repoOf({}).split("/")[0];
      return client.listRepositories(workspace, args);
    },
  }),

  defineTool<{ repo?: string; query?: string; limit?: number }>({
    name: "list_branches",
    description: "List a repository's branches, the most recently committed first.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, query: QUERY, limit: LIMIT },
      positional: ["repo"],
    },
    run: (client, args) => client.listBranches(repoOf(args), args),
  }),

  defineTool<{ repo?: string; name: string }>({
    name: "get_branch",
    description: "Get one branch with the commit it points at.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, name: text("Branch name") },
      required: ["name"],
      positional: ["repo", "name"],
    },
    run: (client, args) => client.getBranch(repoOf(args), args.name),
  }),

  defineTool<{ repo?: string; revision?: string; limit?: number }>({
    name: "list_commits",
    description:
      "List commits, newest first, from a branch, tag or commit — or from the main branch " +
      "when no revision is given.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        revision: text("Branch, tag or commit to start from"),
        limit: LIMIT,
      },
      positional: ["repo", "revision"],
    },
    run: (client, args) => client.listCommits(repoOf(args), args),
  }),

  defineTool<{ repo?: string; commit: string }>({
    name: "get_commit",
    description: "Get one commit: its message, author, date and parents.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, commit: text("Commit hash") },
      required: ["commit"],
      positional: ["repo", "commit"],
    },
    run: (client, args) => client.getCommit(repoOf(args), args.commit),
  }),

  defineTool<{ repo?: string; path: string; ref?: string }>({
    name: "get_file",
    description:
      "Read a file at a branch, tag or commit, printed as plain text. A directory path " +
      "lists its entries instead. Without --ref the repository's main branch is read.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        path: text("Path in the repository, e.g. composer.json"),
        ref: text("Branch, tag or commit (default: the main branch)"),
      },
      required: ["path"],
      positional: ["repo", "path"],
    },
    run: (client, args) => client.getFile(repoOf(args), args.path, args.ref),
  }),
];
