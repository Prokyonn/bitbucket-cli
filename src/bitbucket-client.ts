import { Credentials } from "./config.js";
import { UsageError } from "./errors.js";
import {
  CommentParams,
  commentBody,
  CreatePullRequestParams,
  createPullRequestBody,
  MergeParams,
  mergeBody,
  TaskParams,
  taskBody,
  TriggerPipelineParams,
  triggerPipelineBody,
  UpdatePullRequestParams,
  updatePullRequestBody,
} from "./params.js";
import { pathSegments, positiveInteger, requireText, segment } from "./validate.js";

/**
 * Client for the Bitbucket Cloud REST API 2.0, authenticated with an Atlassian
 * account email and API token over HTTP Basic auth. Responses are returned as
 * Bitbucket sends them; paginated lists are collected into one array.
 */

export const API_URL = "https://api.bitbucket.org/2.0";

const PAGE_LENGTH = 50;

export const PULL_REQUEST_STATES = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"] as const;

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export interface BitbucketUser {
  account_id: string;
  uuid: string;
  nickname: string;
  display_name: string;
}

export interface ListOptions {
  /** A Bitbucket filter expression, e.g. source.branch.name="feature-x". */
  query?: string;
  limit?: number;
}

export class BitbucketApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Page {
  values: unknown[];
  next?: string;
}

export class BitbucketClient {
  private readonly authorization: string;

  constructor(credentials: Credentials) {
    const pair = `${credentials.email}:${credentials.token}`;
    this.authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
  }

  async getCurrentUser(): Promise<BitbucketUser> {
    return (await this.getJson("/user")) as BitbucketUser;
  }

  // Pull requests

  async listPullRequests(
    repo: string,
    options: ListOptions & { states?: PullRequestState[] } = {},
  ): Promise<unknown[]> {
    const limit = positiveInteger(options.limit ?? PAGE_LENGTH, "limit");
    const query = new URLSearchParams({
      sort: "-updated_on",
      pagelen: String(Math.min(limit, PAGE_LENGTH)),
    });
    for (const state of options.states ?? []) {
      query.append("state", state);
    }
    if (options.query !== undefined) query.set("q", options.query);
    return this.getAllPages(`${repositoryPath(repo)}/pullrequests?${query}`, limit);
  }

  async getPullRequest(repo: string, id: number): Promise<unknown> {
    return this.getJson(pullRequestPath(repo, id));
  }

  /** Bitbucket answers with a redirect to the repository diff, which is plain text. */
  async getPullRequestDiff(repo: string, id: number): Promise<string> {
    return this.getText(`${pullRequestPath(repo, id)}/diff`);
  }

  async getPullRequestDiffstat(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/diffstat`);
  }

  async listPullRequestCommits(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/commits?pagelen=${PAGE_LENGTH}`);
  }

  async listPullRequestActivity(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/activity?pagelen=${PAGE_LENGTH}`);
  }

  /** The build statuses reported for the pull request's head commit. */
  async listPullRequestStatuses(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/statuses?pagelen=${PAGE_LENGTH}`);
  }

  async createPullRequest(repo: string, params: CreatePullRequestParams): Promise<unknown> {
    return this.send("POST", `${repositoryPath(repo)}/pullrequests`, createPullRequestBody(params));
  }

  async updatePullRequest(
    repo: string,
    id: number,
    params: UpdatePullRequestParams,
  ): Promise<unknown> {
    return this.send("PUT", pullRequestPath(repo, id), updatePullRequestBody(params));
  }

  /** Bitbucket may answer 202 with a task to poll when the merge takes a while. */
  async mergePullRequest(repo: string, id: number, params: MergeParams): Promise<unknown> {
    return this.send("POST", `${pullRequestPath(repo, id)}/merge`, mergeBody(params));
  }

  async declinePullRequest(repo: string, id: number): Promise<unknown> {
    return this.send("POST", `${pullRequestPath(repo, id)}/decline`);
  }

  async approvePullRequest(repo: string, id: number): Promise<unknown> {
    return this.send("POST", `${pullRequestPath(repo, id)}/approve`);
  }

  async unapprovePullRequest(repo: string, id: number): Promise<void> {
    await this.request("DELETE", `${pullRequestPath(repo, id)}/approve`);
  }

  async requestChanges(repo: string, id: number): Promise<unknown> {
    return this.send("POST", `${pullRequestPath(repo, id)}/request-changes`);
  }

  async removeRequestChanges(repo: string, id: number): Promise<void> {
    await this.request("DELETE", `${pullRequestPath(repo, id)}/request-changes`);
  }

  // Comments and tasks

  async listPullRequestComments(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/comments?pagelen=${PAGE_LENGTH}`);
  }

  async getPullRequestComment(repo: string, id: number, commentId: number): Promise<unknown> {
    return this.getJson(commentPath(repo, id, commentId));
  }

  async addPullRequestComment(repo: string, id: number, params: CommentParams): Promise<unknown> {
    return this.send("POST", `${pullRequestPath(repo, id)}/comments`, commentBody(params));
  }

  async updatePullRequestComment(
    repo: string,
    id: number,
    commentId: number,
    content: string,
  ): Promise<unknown> {
    return this.send("PUT", commentPath(repo, id, commentId), {
      content: { raw: requireText(content, "content") },
    });
  }

  async deletePullRequestComment(repo: string, id: number, commentId: number): Promise<void> {
    await this.request("DELETE", commentPath(repo, id, commentId));
  }

  async resolvePullRequestComment(repo: string, id: number, commentId: number): Promise<unknown> {
    return this.send("POST", `${commentPath(repo, id, commentId)}/resolve`);
  }

  async reopenPullRequestComment(repo: string, id: number, commentId: number): Promise<void> {
    await this.request("DELETE", `${commentPath(repo, id, commentId)}/resolve`);
  }

  async listPullRequestTasks(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/tasks?pagelen=${PAGE_LENGTH}`);
  }

  async createPullRequestTask(repo: string, id: number, params: TaskParams): Promise<unknown> {
    return this.send(
      "POST",
      `${pullRequestPath(repo, id)}/tasks`,
      taskBody(params, { creating: true }),
    );
  }

  async updatePullRequestTask(
    repo: string,
    id: number,
    taskId: number,
    params: TaskParams,
  ): Promise<unknown> {
    return this.send("PUT", taskPath(repo, id, taskId), taskBody(params, { creating: false }));
  }

  async deletePullRequestTask(repo: string, id: number, taskId: number): Promise<void> {
    await this.request("DELETE", taskPath(repo, id, taskId));
  }

  // Repository, branches, commits and files

  async getRepository(repo: string): Promise<unknown> {
    return this.getJson(repositoryPath(repo));
  }

  async listRepositories(workspace: string, options: ListOptions = {}): Promise<unknown[]> {
    const { query, limit } = this.pageQuery(options, "-updated_on");
    return this.getAllPages(`/repositories/${segment(workspace, "workspace")}?${query}`, limit);
  }

  async listBranches(repo: string, options: ListOptions = {}): Promise<unknown[]> {
    const { query, limit } = this.pageQuery(options, "-target.date");
    return this.getAllPages(`${repositoryPath(repo)}/refs/branches?${query}`, limit);
  }

  async getBranch(repo: string, name: string): Promise<unknown> {
    return this.getJson(`${repositoryPath(repo)}/refs/branches/${pathSegments(name, "name")}`);
  }

  async listCommits(
    repo: string,
    options: ListOptions & { revision?: string } = {},
  ): Promise<unknown[]> {
    const { query, limit } = this.pageQuery(options);
    const revision =
      options.revision === undefined ? "" : `/${pathSegments(options.revision, "revision")}`;
    return this.getAllPages(`${repositoryPath(repo)}/commits${revision}?${query}`, limit);
  }

  async getCommit(repo: string, commit: string): Promise<unknown> {
    return this.getJson(`${repositoryPath(repo)}/commit/${segment(commit, "commit")}`);
  }

  async listCommitStatuses(repo: string, commit: string): Promise<unknown[]> {
    return this.getAllPages(
      `${repositoryPath(repo)}/commit/${segment(commit, "commit")}/statuses?pagelen=${PAGE_LENGTH}`,
    );
  }

  /**
   * A file's contents as text, or the listing of a directory. Without a ref the
   * repository's main branch is used, which costs one extra request.
   */
  async getFile(repo: string, path: string, ref?: string): Promise<unknown> {
    const revision = ref ?? (await this.mainBranch(repo));
    const target = `${repositoryPath(repo)}/src/${pathSegments(revision, "ref")}/${pathSegments(path, "path")}`;
    const response = await this.request("GET", target);
    return (response.headers.get("content-type") ?? "").includes("json")
      ? response.json()
      : response.text();
  }

  // Pipelines

  async listPipelines(
    repo: string,
    options: ListOptions & { branch?: string } = {},
  ): Promise<unknown[]> {
    const { query, limit } = this.pageQuery(options, "-created_on");
    if (options.branch !== undefined) {
      if (options.query !== undefined) {
        throw new UsageError("Give 'branch' or 'query', not both: both filter the same field.");
      }
      query.set("q", `target.ref_name="${requireText(options.branch, "branch")}"`);
    }
    return this.getAllPages(`${repositoryPath(repo)}/pipelines?${query}`, limit);
  }

  async getPipeline(repo: string, pipeline: string): Promise<unknown> {
    return this.getJson(pipelinePath(repo, pipeline));
  }

  async listPipelineSteps(repo: string, pipeline: string): Promise<unknown[]> {
    return this.getAllPages(`${pipelinePath(repo, pipeline)}/steps?pagelen=${PAGE_LENGTH}`);
  }

  async getPipelineStepLog(repo: string, pipeline: string, step: string): Promise<string> {
    return this.getText(`${pipelinePath(repo, pipeline)}/steps/${segment(step, "step")}/log`);
  }

  async triggerPipeline(repo: string, params: TriggerPipelineParams): Promise<unknown> {
    return this.send("POST", `${repositoryPath(repo)}/pipelines`, triggerPipelineBody(params));
  }

  async stopPipeline(repo: string, pipeline: string): Promise<unknown> {
    return this.send("POST", `${pipelinePath(repo, pipeline)}/stopPipeline`);
  }

  private async mainBranch(repo: string): Promise<string> {
    const repository = (await this.getRepository(repo)) as { mainbranch?: { name?: string } };
    const name = repository.mainbranch?.name;
    if (!name) {
      throw new UsageError(`${repo} has no main branch; pass 'ref' to say which one to read.`);
    }
    return name;
  }

  private pageQuery(
    options: ListOptions,
    sort?: string,
  ): { query: URLSearchParams; limit: number } {
    const limit = positiveInteger(options.limit ?? PAGE_LENGTH, "limit");
    const query = new URLSearchParams({ pagelen: String(Math.min(limit, PAGE_LENGTH)) });
    if (sort !== undefined) query.set("sort", sort);
    if (options.query !== undefined) query.set("q", options.query);
    return { query, limit };
  }

  private async getJson(target: string): Promise<unknown> {
    return (await this.request("GET", target)).json();
  }

  /**
   * Diffs and pipeline logs come as text; the log endpoint answers 406 to a
   * request for text/plain, so both ask for anything.
   */
  private async getText(target: string): Promise<string> {
    return (await this.request("GET", target, { accept: "*/*" })).text();
  }

  private async send(method: string, target: string, body?: unknown): Promise<unknown> {
    const response = await this.request(method, target, { body: body ?? {} });
    return response.status === 204 ? { ok: true } : response.json();
  }

  private async getAllPages(target: string, limit = Infinity): Promise<unknown[]> {
    const values: unknown[] = [];
    let next: string | undefined = target;
    while (next !== undefined && values.length < limit) {
      const page = (await this.getJson(next)) as Page;
      values.push(...page.values);
      next = page.next;
    }
    return values.slice(0, limit);
  }

  private async request(
    method: string,
    target: string,
    options: { body?: unknown; accept?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: options.accept ?? "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(resolveUrl(target), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      throw await apiError(method, target, response);
    }
    return response;
  }
}

/** API paths, or the absolute `next` links of paginated responses, which must stay on the API. */
function resolveUrl(target: string): string {
  if (target.startsWith("/")) return `${API_URL}${target}`;
  if (target.startsWith(`${API_URL}/`)) return target;
  throw new Error(`Refusing to follow a link outside ${API_URL}: ${target}`);
}

function repositoryPath(repo: string): string {
  const parts = typeof repo === "string" ? repo.split("/") : [];
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new UsageError(
      `'repo' must be workspace/slug, e.g. my-workspace/my-repo (got '${String(repo)}').`,
    );
  }
  return `/repositories/${parts.map(encodeURIComponent).join("/")}`;
}

function pullRequestPath(repo: string, id: number): string {
  return `${repositoryPath(repo)}/pullrequests/${positiveInteger(id, "id")}`;
}

function commentPath(repo: string, id: number, commentId: number): string {
  return `${pullRequestPath(repo, id)}/comments/${positiveInteger(commentId, "commentId")}`;
}

function taskPath(repo: string, id: number, taskId: number): string {
  return `${pullRequestPath(repo, id)}/tasks/${positiveInteger(taskId, "taskId")}`;
}

/** A pipeline is addressed by its build number or its {uuid}. */
function pipelinePath(repo: string, pipeline: string): string {
  return `${repositoryPath(repo)}/pipelines/${segment(pipeline, "pipeline")}`;
}

/** Bitbucket explains most failures in `error.message` and `error.detail`, e.g. missing scopes. */
async function apiError(
  method: string,
  target: string,
  response: Response,
): Promise<BitbucketApiError> {
  let reason = response.statusText;
  try {
    const error = JSON.parse(await response.text())?.error;
    if (typeof error?.message === "string") {
      const detail = error.detail;
      reason =
        detail === undefined || detail === null || detail === ""
          ? error.message
          : `${error.message} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
    }
  } catch {
    // Not a JSON error body: the status text has to do.
  }

  const where = target.startsWith(API_URL) ? target.slice(API_URL.length) : target;
  return new BitbucketApiError(
    `Bitbucket returned HTTP ${response.status} for ${method} ${where}: ${reason}`,
    response.status,
  );
}
