# bitbucket-cli

Read and review Bitbucket Cloud pull requests from the command line: list them, read one with
its diff, commits and comments, comment inline or in reply, approve or request changes. Built for
agent sessions that have no Bitbucket MCP server connected, after the model of
[trello-mcp](https://github.com/wachterjohannes/trello-mcp)'s `trello` CLI.

## Install

```bash
npm install -g github:Prokyonn/bitbucket-cli
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

`BITBUCKET_EMAIL` and `BITBUCKET_API_TOKEN`, in the environment or a `.env` file in the working
directory, take precedence over the stored file.

## Usage

```bash
bitbucket list                                        # every tool
bitbucket help add_pull_request_comment               # a tool's arguments
bitbucket list_pull_requests my-workspace/my-repo --compact
bitbucket get_pull_request my-workspace/my-repo 42
bitbucket get_pull_request_diff my-workspace/my-repo 42
bitbucket add_pull_request_comment my-workspace/my-repo 42 "Typo" --path src/A.php --line 12
bitbucket approve_pull_request my-workspace/my-repo 42
bitbucket run review.json --dry-run                   # several calls as one checked script
```

Required arguments are positional, everything else is a flag; `--json '<object>'` passes arguments
as JSON, `--dry-run` prints the call instead of making it. Results are Bitbucket's JSON on stdout,
the diff plain text. Exit codes: `0` success, `1` runtime or API failure, `2` usage error.
[`skills/bitbucket-cli/SKILL.md`](skills/bitbucket-cli/SKILL.md) covers reviewing with it in
detail.

## Development

```bash
npm install
npm test               # builds, then runs the tests with node --test
npm run format:check
npm link               # puts this checkout's bitbucket on the PATH
```
