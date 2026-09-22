import { execFileSync } from "child_process";
import { UsageError } from "./errors.js";

/**
 * Where a call acts: the repository, and for pull request tools its id.
 *
 * A tool takes `workspace/slug`, a bitbucket.org URL, or nothing at all — then
 * BITBUCKET_REPO and the git remote of the working directory answer for it, the
 * way `gh` reads the checkout it runs in.
 */

const REPO = /^[^/\s]+\/[^/\s]+$/;
const PULL_REQUEST_URL = /^https?:\/\/bitbucket\.org\/([^/\s]+)\/([^/\s]+)\/pull-requests\/(\d+)/;
const REPOSITORY_URL = /^https?:\/\/bitbucket\.org\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
const REMOTE = /bitbucket\.org[:/]([^/\s]+)\/(\S+?)(?:\.git)?$/;

export interface PullRequestTarget {
  repo: string;
  id: number;
}

/** The repository a call acts on, from its `repo` argument or the surroundings. */
export function repoOf(args: { repo?: unknown }): string {
  const given = args.repo;
  if (typeof given === "string" && given.trim().length > 0) {
    return fromValue(given.trim(), "repo");
  }

  const configured = process.env.BITBUCKET_REPO;
  if (configured) {
    return fromValue(configured.trim(), "BITBUCKET_REPO");
  }

  const checkout = repoFromGitRemote();
  if (checkout) return checkout;

  throw new UsageError(
    "No repository given. Pass workspace/slug or a pull request URL, set BITBUCKET_REPO, " +
      "or run this inside a checkout whose origin is on bitbucket.org.",
  );
}

/** The pull request a call acts on; its id may come from a URL in `repo`. */
export function pullRequestOf(args: { repo?: unknown; id?: unknown }): PullRequestTarget {
  const repo = repoOf(args);
  const fromUrl = typeof args.repo === "string" ? idFromUrl(args.repo.trim()) : undefined;

  if (fromUrl !== undefined && args.id !== undefined && Number(args.id) !== fromUrl) {
    throw new UsageError(
      `The URL names pull request ${fromUrl}, but 'id' says ${String(args.id)}. Give one of them.`,
    );
  }

  const id = args.id ?? fromUrl;
  if (id === undefined) {
    throw new UsageError(
      "No pull request id. Pass it after the repository, or give its URL instead.",
    );
  }
  return { repo, id: id as number };
}

/** True for a token that can name a repository, so the CLI knows what a positional is. */
export function looksLikeRepo(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return REPO.test(trimmed) || REPOSITORY_URL.test(trimmed) || PULL_REQUEST_URL.test(trimmed);
}

/** True for a URL that carries a pull request id, so the CLI knows not to expect one. */
export function namesPullRequest(value: unknown): boolean {
  return typeof value === "string" && PULL_REQUEST_URL.test(value.trim());
}

function fromValue(value: string, source: string): string {
  const pullRequest = PULL_REQUEST_URL.exec(value);
  if (pullRequest) return `${pullRequest[1]}/${pullRequest[2]}`;

  const repository = REPOSITORY_URL.exec(value);
  if (repository) return `${repository[1]}/${repository[2]}`;

  if (REPO.test(value)) return value;

  throw new UsageError(`${source} must be workspace/slug or a bitbucket.org URL (got '${value}').`);
}

function idFromUrl(value: string): number | undefined {
  const match = PULL_REQUEST_URL.exec(value);
  return match ? Number(match[3]) : undefined;
}

function repoFromGitRemote(): string | null {
  for (const remote of ["origin", "upstream"]) {
    const url = git(["config", "--get", `remote.${remote}.url`]);
    const match = url && REMOTE.exec(url);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // No git, no repository, no such remote: the caller falls back or explains.
    return null;
  }
}
