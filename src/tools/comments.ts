import { pullRequestOf } from "../repo.js";
import { flag, ID, number, pullRequestTool, REPO, text } from "./common.js";
import { defineTool, ToolDefinition } from "./types.js";

/** The discussion on a pull request: comments, their replies, and tasks. */

const COMMENT_ID = number("ID of the comment");
const TASK_ID = number("ID of the task");

export const commentTools: ToolDefinition[] = [
  pullRequestTool(
    "list_pull_request_comments",
    "List a pull request's comments, oldest first: general and inline ones (see inline), " +
      "and replies (see parent.id). Deleted ones stay in the list, marked deleted.",
    (client, repo, id) => client.listPullRequestComments(repo, id),
  ),

  defineTool<{ repo?: string; id?: number; commentId: number }>({
    name: "get_pull_request_comment",
    description: "Get one comment of a pull request, with its resolution and its anchor.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID, commentId: COMMENT_ID },
      required: ["commentId"],
      positional: ["repo", "id", "commentId"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.getPullRequestComment(target.repo, target.id, args.commentId);
    },
  }),

  defineTool<{
    repo?: string;
    id?: number;
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
        content: text("The comment, in Markdown"),
        path: text("File to comment on, as in the diff"),
        line: number("Line in the new version of the file; the last line of a range"),
        startLine: number("First line of a range"),
        parentId: number("ID of the comment to reply to"),
      },
      required: ["content"],
      positional: ["repo", "id", "content"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.addPullRequestComment(target.repo, target.id, args);
    },
  }),

  defineTool<{ repo?: string; id?: number; commentId: number; content: string }>({
    name: "update_pull_request_comment",
    description: "Replace the text of one of your comments.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID, commentId: COMMENT_ID, content: text("The new text") },
      required: ["commentId", "content"],
      positional: ["repo", "id", "commentId", "content"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.updatePullRequestComment(target.repo, target.id, args.commentId, args.content);
    },
  }),

  defineTool<{ repo?: string; id?: number; commentId: number }>({
    name: "delete_pull_request_comment",
    description: "Delete one of your comments. It stays in the list, marked deleted.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID, commentId: COMMENT_ID },
      required: ["commentId"],
      positional: ["repo", "id", "commentId"],
    },
    run: async (client, args) => {
      const target = pullRequestOf(args);
      await client.deletePullRequestComment(target.repo, target.id, args.commentId);
      return { ok: true };
    },
  }),

  defineTool<{ repo?: string; id?: number; commentId: number }>({
    name: "resolve_pull_request_comment",
    description: "Mark a comment thread as resolved.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID, commentId: COMMENT_ID },
      required: ["commentId"],
      positional: ["repo", "id", "commentId"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.resolvePullRequestComment(target.repo, target.id, args.commentId);
    },
  }),

  defineTool<{ repo?: string; id?: number; commentId: number }>({
    name: "reopen_pull_request_comment",
    description: "Take back the resolution of a comment thread.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID, commentId: COMMENT_ID },
      required: ["commentId"],
      positional: ["repo", "id", "commentId"],
    },
    run: async (client, args) => {
      const target = pullRequestOf(args);
      await client.reopenPullRequestComment(target.repo, target.id, args.commentId);
      return { ok: true };
    },
  }),

  pullRequestTool(
    "list_pull_request_tasks",
    "List a pull request's tasks, the checklist items a reviewer leaves behind.",
    (client, repo, id) => client.listPullRequestTasks(repo, id),
  ),

  defineTool<{ repo?: string; id?: number; content: string; commentId?: number }>({
    name: "create_pull_request_task",
    description: "Add a task to a pull request, on its own or anchored to a comment.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        id: ID,
        content: text("What has to be done"),
        commentId: number("ID of the comment the task belongs to"),
      },
      required: ["content"],
      positional: ["repo", "id", "content"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.createPullRequestTask(target.repo, target.id, args);
    },
  }),

  defineTool<{ repo?: string; id?: number; taskId: number; content?: string; resolved?: boolean }>({
    name: "update_pull_request_task",
    description: "Change a task's text, or tick it off with --resolved (--no-resolved reopens it).",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        id: ID,
        taskId: TASK_ID,
        content: text("New text"),
        resolved: flag("Whether the task is done"),
      },
      required: ["taskId"],
      positional: ["repo", "id", "taskId"],
    },
    run: (client, args) => {
      const target = pullRequestOf(args);
      return client.updatePullRequestTask(target.repo, target.id, args.taskId, args);
    },
  }),

  defineTool<{ repo?: string; id?: number; taskId: number }>({
    name: "delete_pull_request_task",
    description: "Delete a task from a pull request.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, id: ID, taskId: TASK_ID },
      required: ["taskId"],
      positional: ["repo", "id", "taskId"],
    },
    run: async (client, args) => {
      const target = pullRequestOf(args);
      await client.deletePullRequestTask(target.repo, target.id, args.taskId);
      return { ok: true };
    },
  }),
];
