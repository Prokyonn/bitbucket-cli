import { UsageError } from "./errors.js";
import { positiveInteger, requireText } from "./validate.js";

/** The request bodies the Bitbucket API expects, built from flat tool arguments. */

export interface CommentParams {
  content: string;
  /** Makes the comment inline on this file. */
  path?: string;
  /** Line in the new version of the file; the last line of a range. */
  line?: number;
  /** First line of a range in the new version of the file. */
  startLine?: number;
  /** Makes the comment a reply to this comment. */
  parentId?: number;
}

export interface CreatePullRequestParams {
  title: string;
  source: string;
  destination?: string;
  description?: string;
  reviewers?: string[];
  closeSourceBranch?: boolean;
  draft?: boolean;
}

export interface UpdatePullRequestParams {
  title?: string;
  description?: string;
  destination?: string;
  reviewers?: string[];
  closeSourceBranch?: boolean;
  draft?: boolean;
}

export const MERGE_STRATEGIES = [
  "merge_commit",
  "squash",
  "fast_forward",
  "squash_fast_forward",
  "rebase_fast_forward",
  "rebase_merge",
] as const;

export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

export interface MergeParams {
  strategy?: MergeStrategy;
  message?: string;
  closeSourceBranch?: boolean;
}

export interface TaskParams {
  content?: string;
  /** Anchors a new task to a comment. */
  commentId?: number;
  resolved?: boolean;
}

export interface TriggerPipelineParams {
  branch?: string;
  commit?: string;
  /** Name of a custom pipeline in bitbucket-pipelines.yml. */
  pipeline?: string;
  /** KEY=VALUE pairs passed to the pipeline. */
  variables?: string[];
}

export function commentBody(params: CommentParams): Record<string, unknown> {
  const { content, path, line, startLine, parentId } = params;

  requireText(content, "content");
  if (line !== undefined && path === undefined) {
    throw new UsageError("'line' needs 'path': an inline comment names its file.");
  }
  if (startLine !== undefined && line === undefined) {
    throw new UsageError("'startLine' needs 'line', the last line of the range.");
  }
  if (parentId !== undefined && path !== undefined) {
    throw new UsageError("A reply sits where its parent does; drop 'path' when giving 'parentId'.");
  }

  const body: Record<string, unknown> = { content: { raw: content } };
  if (path !== undefined) {
    const inline: Record<string, unknown> = { path };
    if (line !== undefined) inline.to = positiveInteger(line, "line");
    if (startLine !== undefined) inline.start_to = positiveInteger(startLine, "startLine");
    body.inline = inline;
  }
  if (parentId !== undefined) {
    body.parent = { id: positiveInteger(parentId, "parentId") };
  }
  return body;
}

export function createPullRequestBody(params: CreatePullRequestParams): Record<string, unknown> {
  return {
    ...updatePullRequestBody(params),
    title: requireText(params.title, "title"),
    source: { branch: { name: requireText(params.source, "source") } },
  };
}

export function updatePullRequestBody(params: UpdatePullRequestParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.title !== undefined) body.title = requireText(params.title, "title");
  if (params.description !== undefined) body.description = params.description;
  if (params.destination !== undefined) {
    body.destination = { branch: { name: requireText(params.destination, "destination") } };
  }
  if (params.reviewers !== undefined) body.reviewers = params.reviewers.map(reviewer);
  if (params.closeSourceBranch !== undefined) body.close_source_branch = params.closeSourceBranch;
  if (params.draft !== undefined) body.draft = params.draft;
  return body;
}

export function mergeBody(params: MergeParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.strategy !== undefined) body.merge_strategy = params.strategy;
  if (params.message !== undefined) body.message = params.message;
  if (params.closeSourceBranch !== undefined) body.close_source_branch = params.closeSourceBranch;
  return body;
}

export function taskBody(
  params: TaskParams,
  { creating }: { creating: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (creating || params.content !== undefined) {
    body.content = { raw: requireText(params.content, "content") };
  }
  if (params.commentId !== undefined) {
    if (!creating) {
      throw new UsageError("'commentId' can only be given when creating a task.");
    }
    body.comment = { id: positiveInteger(params.commentId, "commentId") };
  }
  if (params.resolved !== undefined) {
    body.state = params.resolved ? "RESOLVED" : "UNRESOLVED";
  }
  return body;
}

/**
 * A pipeline is started for a branch, for a commit, or for both; a named custom
 * pipeline is picked with a selector.
 */
export function triggerPipelineBody(params: TriggerPipelineParams): Record<string, unknown> {
  const { branch, commit, pipeline, variables } = params;
  if (branch === undefined && commit === undefined) {
    throw new UsageError("Starting a pipeline needs 'branch', 'commit', or both.");
  }

  const target: Record<string, unknown> =
    branch === undefined
      ? { type: "pipeline_commit_target", commit: { type: "commit", hash: commit } }
      : {
          type: "pipeline_ref_target",
          ref_type: "branch",
          ref_name: branch,
          ...(commit === undefined ? {} : { commit: { type: "commit", hash: commit } }),
        };

  if (pipeline !== undefined) {
    target.selector = { type: "custom", pattern: requireText(pipeline, "pipeline") };
  }

  const body: Record<string, unknown> = { target };
  if (variables !== undefined && variables.length > 0) {
    body.variables = variables.map(pipelineVariable);
  }
  return body;
}

/** Reviewers are given as account ids or uuids; Bitbucket wants them wrapped. */
function reviewer(value: string): Record<string, string> {
  const id = requireText(value, "reviewers");
  return id.startsWith("{") ? { uuid: id } : { account_id: id };
}

function pipelineVariable(value: string): Record<string, unknown> {
  const equals = value.indexOf("=");
  if (equals <= 0) {
    throw new UsageError(`A pipeline variable must be KEY=VALUE (got '${value}').`);
  }
  return { key: value.slice(0, equals), value: value.slice(equals + 1) };
}
