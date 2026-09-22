---
name: bitbucket-cli
description: Work with Bitbucket Cloud from the command line with the bitbucket CLI, the way gh works for GitHub — pull requests (list, read, diff, create, update, merge, decline), reviews (inline comments, replies, resolving, tasks, approve or request changes), build statuses and pipelines with their step logs, and repository reads (branches, commits, files at a ref). Use when the user asks about a pull request, a build, a pipeline or a repository on bitbucket.org, and no Bitbucket MCP server is connected.
---

# Bitbucket from the command line

Drive Bitbucket Cloud through the `bitbucket` CLI, the way `gh` drives GitHub.
`bitbucket --version` tells whether it is installed, `bitbucket list` what it
can do.

Credentials come from `BITBUCKET_EMAIL` / `BITBUCKET_API_TOKEN` (environment or
a `.env` file in the working directory), falling back to the credentials stored
by `bitbucket setup`. If a command reports them missing, or fails with HTTP 401,
tell the user to run `bitbucket setup` themselves — it is interactive and asks
for the email and the token, hidden. Never run `bitbucket setup --token ...`
with a value the user pasted into chat, and never print credential values back.
An HTTP 403 that names a scope means the token lacks it: the user needs a new
token with the scopes `bitbucket setup --help` lists. An HTTP 404 for a
repository the user can clone usually means the token belongs to another of
their Atlassian accounts than the one with access; `bitbucket setup` names the
account's email, and `bitbucket setup --reauth` replaces the token.

## Key principles

- **Discover, don't guess.** `bitbucket list` shows every tool;
  `bitbucket help <tool>` shows its arguments and which are required.
- **The repository is usually implied.** Inside a checkout whose origin is on
  bitbucket.org, leave it out: `bitbucket list_pull_requests`. Otherwise pass
  `<workspace>/<slug>` first, or set `BITBUCKET_REPO`. A pull request URL
  stands in for the repository and the id together:
  `bitbucket get_pull_request https://bitbucket.org/ws/repo/pull-requests/42`.
- **A pull request is `[<repo>] <id>`**, so `bitbucket get_pull_request 42`
  works in the checkout of that repository.
- **Output is Bitbucket's JSON on stdout**, full of `links`. Pipe it through
  `jq` with `--compact` and keep only what you need. The diff is plain text.
- **Writes are seen by the team.** Comments, approvals and change requests
  notify people and cannot be taken back quietly. Draft them, show the user,
  and post only after an explicit yes. `--dry-run` prints the resolved call
  without touching Bitbucket.
- **Exit codes:** `0` success, `1` runtime or API failure, `2` usage error
  (unknown tool, bad flag, missing or malformed argument). Read stderr on
  failure; Bitbucket's own explanation is included.

## Reading a pull request

```bash
# Inside the checkout; elsewhere put my-workspace/my-repo first, or a PR URL
bitbucket list_pull_requests --compact \
  | jq '.[] | {id, title, author: .author.display_name, source: .source.branch.name}'

bitbucket get_pull_request 42 --compact | jq '{
  title, state, description,
  author: .author.display_name,
  source: .source.branch.name, destination: .destination.branch.name,
  head: .source.commit.hash,
  participants: [.participants[] | {name: .user.display_name, role, approved, state}]
}'

bitbucket get_pull_request_diffstat 42 --compact \
  | jq -r '.[] | "\(.status)\t+\(.lines_added) -\(.lines_removed)\t\(.new.path // .old.path)"'

bitbucket get_pull_request_diff 42 > pr-42.diff

bitbucket list_pull_request_comments 42 --compact | jq '.[] | select(.deleted | not)
  | {id, author: .user.display_name, path: .inline.path, line: .inline.to,
     reply_to: .parent.id, text: .content.raw}'
```

- `list_pull_requests` returns open pull requests, most recently updated first,
  at most 50: `--state OPEN,MERGED,DECLINED,SUPERSEDED` and `--limit` change that.
- A participant's `state` is `approved`, `changes_requested` or `null`. Match
  yourself by `uuid` or `account_id` from `get_current_user`.

## Commenting

```bash
# General comment
bitbucket add_pull_request_comment 42 "Looks good overall, two nits inline."

# Inline, on line 17 of the new version of the file
bitbucket add_pull_request_comment 42 "Missing null check" --path src/Controller.php --line 17

# Inline, on lines 12 to 17
bitbucket add_pull_request_comment 42 "Extract a method" --path src/Controller.php --start-line 12 --line 17

# Reply to comment 123
bitbucket add_pull_request_comment 42 "Fixed in the next push" --parent-id 123
```

Line numbers count in the pull request's version of the file, the `+` side of
the diff. For Markdown with newlines or quotes, write it to a file and pass it
with `--json` rather than fighting shell quoting:

```bash
bitbucket add_pull_request_comment 42 --json "$(jq -n --rawfile content comment.md '{$content}')"
```

## Reviews beyond commenting

`update_pull_request_comment` and `delete_pull_request_comment` fix or remove
your own comments; `resolve_pull_request_comment` and
`reopen_pull_request_comment` close and reopen a thread. Tasks are Bitbucket's
review checklist: `list_pull_request_tasks`, `create_pull_request_task`
(`--commentId` anchors it to a comment), `update_pull_request_task --resolved`,
`delete_pull_request_task`.

## Builds and pipelines

```bash
# Did CI pass on this pull request?
bitbucket list_pull_request_statuses 42 --compact | jq '.[] | {key, state, url}'

# The runs of a branch, then one run's steps and the log of a failed step
bitbucket list_pipelines --branch main --limit 5 --compact \
  | jq '.[] | {build: .build_number, state: .state.name, result: .state.result.name}'
bitbucket list_pipeline_steps 77 --compact | jq '.[] | {uuid, name, state: .state.name}'
bitbucket get_pipeline_step_log 77 '{step-uuid}' | tail -50
```

Step logs are long; always narrow them with `tail`, `grep` or `sed`.
`trigger_pipeline` starts a run (`--branch`, `--commit`, `--pipeline` for a
custom one, `--variables KEY=VALUE`) and `stop_pipeline` stops one. Starting a
build spends the workspace's build minutes and may deploy — ask first.

## Repository, branches and files

`get_repository`, `list_repositories`, `list_branches`, `get_branch`,
`list_commits`, `get_commit`, and `get_file <path> --ref <branch|tag|commit>`,
which prints a file as text and lists a directory as JSON. Reading
`composer.json` or `package.json` at a pull request's head is how you learn what
a project is without cloning it.

## Changing a pull request

`create_pull_request "<title>" <source-branch>` opens one (`--destination`,
`--description`, `--reviewers`, `--draft`); `update_pull_request` changes title,
description, destination, reviewers or draft state — **reviewers replace the
current set, so read them first**; `merge_pull_request --strategy squash`
merges; `decline_pull_request` closes it unmerged. Merging, declining and
starting pipelines are the actions people cannot undo quietly: confirm each with
the user before running it.

## Verdicts

`approve_pull_request` / `unapprove_pull_request` and `request_changes` /
`remove_request_changes`, each taking `[<repo>] <id>`. Bitbucket has no review
object: a review is its comments plus one verdict, each a call of its own.

## Posting a whole review: use a script

A review of several comments and a verdict is one JSON script. It is checked
before the first call — unknown tools, unknown or missing arguments, forward
references — so a typo cannot turn an inline comment into a general one halfway
through.

```json
{
  "name": "Review of #42",
  "steps": [
    {
      "tool": "add_pull_request_comment",
      "args": {
        "repo": "my-workspace/my-repo",
        "id": 42,
        "path": "src/Controller.php",
        "line": 17,
        "content": "Missing null check"
      }
    },
    {
      "tool": "add_pull_request_comment",
      "args": { "repo": "my-workspace/my-repo", "id": 42, "content": "One blocker inline, otherwise fine." }
    },
    { "tool": "request_changes", "args": { "repo": "my-workspace/my-repo", "id": 42 } }
  ]
}
```

```bash
bitbucket run review.json --dry-run   # check and preview, no API calls
bitbucket run review.json             # post
```

- The run stops at the first failing step; the step results so far still go to
  stdout and the exit code is 1. **The steps before the failure are posted.**
  Never re-run the whole script after a failure — it would post them twice.
  Fix the failing step and run only it and the ones after it.
- `{{stepId.path}}` reads an earlier step's result (give that step an `"id"`),
  e.g. `"parentId": "{{summary.id}}"`; `{{env.NAME}}` reads the environment.
- Progress goes to stderr, the array of step results to stdout.

## Tools by task

| Task | Tools |
|------|-------|
| Who am I | `get_current_user` |
| Find pull requests | `list_pull_requests` (`--state`, `--query`, `--limit`) |
| Read one | `get_pull_request`, `get_pull_request_diffstat`, `get_pull_request_diff`, `list_pull_request_commits`, `list_pull_request_activity` |
| Discussion | `list_pull_request_comments`, `get_pull_request_comment`, `add_pull_request_comment`, `update_pull_request_comment`, `delete_pull_request_comment`, `resolve_pull_request_comment`, `reopen_pull_request_comment` |
| Review checklist | `list_pull_request_tasks`, `create_pull_request_task`, `update_pull_request_task`, `delete_pull_request_task` |
| Verdict | `approve_pull_request`, `unapprove_pull_request`, `request_changes`, `remove_request_changes` |
| Life of a pull request | `create_pull_request`, `update_pull_request`, `merge_pull_request`, `decline_pull_request` |
| CI | `list_pull_request_statuses`, `list_commit_statuses`, `list_pipelines`, `get_pipeline`, `list_pipeline_steps`, `get_pipeline_step_log`, `trigger_pipeline`, `stop_pipeline` |
| Repository | `get_repository`, `list_repositories`, `list_branches`, `get_branch`, `list_commits`, `get_commit`, `get_file` |

A pull request waiting for *your* review has no endpoint of its own: list each
repository's open pull requests and filter by `participants` or `reviewers`
against your `uuid` from `get_current_user`.
