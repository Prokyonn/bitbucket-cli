# bitbucket-cli

Work with Bitbucket Cloud from the command line, the way `gh` works for GitHub: pull requests
(list, read, diff, create, update, merge, decline), reviews (inline comments, replies, resolving,
tasks, approve or request changes), build statuses and pipelines with their step logs, and
repository reads (branches, commits, files at a ref). Built for agent sessions that have no
Bitbucket MCP server connected, after the model of
[trello-mcp](https://github.com/wachterjohannes/trello-mcp)'s `trello` CLI.

## Install

```bash
npm install -g @prokyon1/bitbucket-cli
bitbucket setup
```

A global install also copies the agent skill into `~/.claude/skills/bitbucket-cli` (and
`~/.agents`, when present); `bitbucket setup` refreshes it. `BITBUCKET_NO_AGENT_SKILLS=1` skips it.

## Credentials

`bitbucket setup` asks for your Atlassian account email and an API token, hidden, checks them
against Bitbucket and stores them in `~/.config/bitbucket-cli/credentials.json`, readable only by
you. Create the token at <https://id.atlassian.com/manage-profile/security/api-tokens> with scopes,
for the Bitbucket app:

- `read:user:bitbucket`
- `read:pullrequest:bitbucket`
- `write:pullrequest:bitbucket`
- `read:repository:bitbucket`, because a pull request's diff redirects to the repository diff
- `read:pipeline:bitbucket` and `write:pipeline:bitbucket` for pipelines, their logs, and
  starting or stopping a run
- `read:workspace:bitbucket` to list workspaces and their members

Scopes cannot be added to a token afterwards; a missing one shows up as HTTP 403 naming it.
`BITBUCKET_EMAIL` and `BITBUCKET_API_TOKEN`, in the environment or a `.env` file in the working
directory, take precedence over the stored file.

## Usage

```bash
bitbucket list                                        # every tool
bitbucket help add_pull_request_comment               # a tool's arguments

# Inside a checkout of the repository, it needs no repository argument
bitbucket list_pull_requests --compact
bitbucket get_pull_request 42
bitbucket get_pull_request_diff 42
bitbucket add_pull_request_comment 42 "Typo" --path src/A.php --line 12
bitbucket approve_pull_request 42
bitbucket list_pull_request_statuses 42                # what CI says
bitbucket get_pipeline_step_log 77 '{step-uuid}' | tail -50

# Elsewhere, name the repository first or paste a pull request URL
bitbucket list_pull_requests my-workspace/my-repo --state MERGED --limit 10
bitbucket get_pull_request https://bitbucket.org/my-workspace/my-repo/pull-requests/42

bitbucket run review.json --dry-run                   # several calls as one checked script
```

The repository comes from the argument, else `BITBUCKET_REPO`, else the origin remote of the
working directory. Arguments in angle brackets are positional, everything else is a flag;
`--json '<object>'` passes arguments as JSON, `--dry-run` prints the call instead of making it.
Results are Bitbucket's JSON on stdout, diffs and pipeline logs plain text. Exit codes: `0`
success, `1` runtime or API failure, `2` usage error.
[`skills/bitbucket-cli/SKILL.md`](skills/bitbucket-cli/SKILL.md) covers reviewing with it in
detail.

## Development

```bash
npm install
npm test               # builds, then runs the tests with node --test
npm run format:check
npm link               # puts this checkout's bitbucket on the PATH
```
