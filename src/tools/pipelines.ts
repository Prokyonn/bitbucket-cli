import { TriggerPipelineParams } from "../params.js";
import { repoOf } from "../repo.js";
import { LIMIT, list, QUERY, REPO, pullRequestTool, text } from "./common.js";
import { defineTool, ToolDefinition } from "./types.js";

/** What CI says: build statuses, and the pipelines behind them. */

const PIPELINE = text("Pipeline build number or {uuid}");

export const pipelineTools: ToolDefinition[] = [
  pullRequestTool(
    "list_pull_request_statuses",
    "List the build statuses of a pull request's head commit: the CI verdict on it.",
    (client, repo, id) => client.listPullRequestStatuses(repo, id),
  ),

  defineTool<{ repo?: string; commit: string }>({
    name: "list_commit_statuses",
    description: "List the build statuses reported for a commit.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, commit: text("Commit hash") },
      required: ["commit"],
      positional: ["repo", "commit"],
    },
    run: (client, args) => client.listCommitStatuses(repoOf(args), args.commit),
  }),

  defineTool<{ repo?: string; branch?: string; query?: string; limit?: number }>({
    name: "list_pipelines",
    description: "List pipeline runs, newest first, optionally only those of one branch.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        branch: text("Only pipelines of this branch"),
        query: QUERY,
        limit: LIMIT,
      },
      positional: ["repo", "branch"],
    },
    run: (client, args) => client.listPipelines(repoOf(args), args),
  }),

  defineTool<{ repo?: string; pipeline: string }>({
    name: "get_pipeline",
    description: "Get one pipeline run: its state, trigger, target and duration.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, pipeline: PIPELINE },
      required: ["pipeline"],
      positional: ["repo", "pipeline"],
    },
    run: (client, args) => client.getPipeline(repoOf(args), args.pipeline),
  }),

  defineTool<{ repo?: string; pipeline: string }>({
    name: "list_pipeline_steps",
    description: "List a pipeline run's steps with their state; each step's uuid opens its log.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, pipeline: PIPELINE },
      required: ["pipeline"],
      positional: ["repo", "pipeline"],
    },
    run: (client, args) => client.listPipelineSteps(repoOf(args), args.pipeline),
  }),

  defineTool<{ repo?: string; pipeline: string; step: string }>({
    name: "get_pipeline_step_log",
    description:
      "Get a pipeline step's log as plain text. Logs get long — pipe them through tail or grep.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, pipeline: PIPELINE, step: text("Step {uuid}") },
      required: ["pipeline", "step"],
      positional: ["repo", "pipeline", "step"],
    },
    run: (client, args) => client.getPipelineStepLog(repoOf(args), args.pipeline, args.step),
  }),

  defineTool<TriggerPipelineParams & { repo?: string }>({
    name: "trigger_pipeline",
    description:
      "Start a pipeline for a branch, for a commit, or for both. --pipeline names a custom " +
      "pipeline from bitbucket-pipelines.yml.",
    inputSchema: {
      type: "object",
      properties: {
        repo: REPO,
        branch: text("Branch to run for"),
        commit: text("Commit to check out"),
        pipeline: text("Name of a custom pipeline in bitbucket-pipelines.yml"),
        variables: list("Variables as KEY=VALUE; repeat the flag for several"),
      },
      positional: ["repo", "branch"],
    },
    run: (client, args) => client.triggerPipeline(repoOf(args), args),
  }),

  defineTool<{ repo?: string; pipeline: string }>({
    name: "stop_pipeline",
    description: "Stop a running pipeline.",
    inputSchema: {
      type: "object",
      properties: { repo: REPO, pipeline: PIPELINE },
      required: ["pipeline"],
      positional: ["repo", "pipeline"],
    },
    run: (client, args) => client.stopPipeline(repoOf(args), args.pipeline),
  }),
];
