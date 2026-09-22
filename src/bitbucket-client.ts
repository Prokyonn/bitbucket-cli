import { Credentials } from "./config.js";
import { UsageError } from "./errors.js";

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

  async listPullRequests(
    repo: string,
    options: { states?: PullRequestState[]; limit?: number } = {},
  ): Promise<unknown[]> {
    const limit = positiveInteger(options.limit ?? PAGE_LENGTH, "limit");
    const query = new URLSearchParams({
      sort: "-updated_on",
      pagelen: String(Math.min(limit, PAGE_LENGTH)),
    });
    for (const state of options.states ?? []) {
      query.append("state", state);
    }
    return this.getAllPages(`${repositoryPath(repo)}/pullrequests?${query}`, limit);
  }

  async getPullRequest(repo: string, id: number): Promise<unknown> {
    return this.getJson(pullRequestPath(repo, id));
  }

  /** Bitbucket answers with a redirect to the repository diff, which is plain text. */
  async getPullRequestDiff(repo: string, id: number): Promise<string> {
    const response = await this.request("GET", `${pullRequestPath(repo, id)}/diff`, {
      accept: "text/plain",
    });
    return response.text();
  }

  async getPullRequestDiffstat(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/diffstat`);
  }

  async listPullRequestCommits(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/commits?pagelen=${PAGE_LENGTH}`);
  }

  async listPullRequestComments(repo: string, id: number): Promise<unknown[]> {
    return this.getAllPages(`${pullRequestPath(repo, id)}/comments?pagelen=${PAGE_LENGTH}`);
  }

  async addPullRequestComment(repo: string, id: number, params: CommentParams): Promise<unknown> {
    return this.send("POST", `${pullRequestPath(repo, id)}/comments`, commentBody(params));
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

  private async getJson(target: string): Promise<unknown> {
    return (await this.request("GET", target)).json();
  }

  private async send(method: string, target: string, body?: unknown): Promise<unknown> {
    return (await this.request(method, target, { body })).json();
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

/** Accepts numbers and digit strings alike, since script placeholders resolve to strings. */
function positiveInteger(value: unknown, name: string): number {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new UsageError(`'${name}' must be a positive whole number (got '${String(value)}').`);
  }
  return Number(value);
}

function commentBody(params: CommentParams): Record<string, unknown> {
  const { content, path, line, startLine, parentId } = params;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new UsageError("'content' must not be empty.");
  }
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
