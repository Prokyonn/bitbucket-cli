import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "build", "cli.js");

/** Runs the CLI in an empty directory, with no credentials anywhere. */
function bitbucket(args, { input, env = {}, cwd } = {}) {
  const dir = cwd ?? mkdtempSync(join(tmpdir(), "bitbucket-cli-"));
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), ...env },
    encoding: "utf8",
    input,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function dryRun(args, options) {
  const { code, stdout, stderr } = bitbucket([...args, "--dry-run", "--compact"], options);
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

/** A checkout whose origin is a Bitbucket repository. */
function checkout(remote = "git@bitbucket.org:my-workspace/my-repo.git") {
  const dir = mkdtempSync(join(tmpdir(), "bitbucket-cli-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

describe("discovery", () => {
  it("lists every tool", () => {
    const { code, stdout } = bitbucket(["list"]);
    assert.equal(code, 0);
    for (const name of [
      "get_current_user",
      "list_pull_requests",
      "get_pull_request",
      "get_pull_request_diff",
      "get_pull_request_diffstat",
      "list_pull_request_commits",
      "list_pull_request_comments",
      "add_pull_request_comment",
      "approve_pull_request",
      "unapprove_pull_request",
      "request_changes",
      "remove_request_changes",
    ]) {
      assert.match(stdout, new RegExp(`^  ${name} `, "m"));
    }
  });

  it("shows a tool's positional arguments and options", () => {
    const { code, stdout } = bitbucket(["help", "add_pull_request_comment"]);
    assert.equal(code, 0);
    assert.match(
      stdout,
      /^bitbucket add_pull_request_comment \[<repo>\] \[<id>\] <content> \[options\]/,
    );
    assert.match(stdout, /--startLine <number>/);
  });

  it("prints the package version", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(bitbucket(["--version"]).stdout.trim(), version);
  });
});

describe("arguments", () => {
  it("takes required arguments positionally, in schema order", () => {
    assert.deepEqual(dryRun(["get_pull_request", "my-workspace/my-repo", "42"]), {
      tool: "get_pull_request",
      args: { repo: "my-workspace/my-repo", id: 42 },
    });
  });

  it("takes options as flags, in camelCase or kebab-case", () => {
    const call = dryRun([
      "add_pull_request_comment",
      "my-workspace/my-repo",
      "42",
      "Extract this",
      "--path",
      "src/A.php",
      "--start-line=12",
      "--line",
      "20",
    ]);
    assert.deepEqual(call.args, {
      repo: "my-workspace/my-repo",
      id: 42,
      content: "Extract this",
      path: "src/A.php",
      startLine: 12,
      line: 20,
    });
  });

  it("splits a state list on commas, or collects a repeated flag", () => {
    assert.deepEqual(
      dryRun(["list_pull_requests", "my-workspace/my-repo", "--state", "OPEN,MERGED"]).args.state,
      ["OPEN", "MERGED"],
    );
    assert.deepEqual(
      dryRun([
        "list_pull_requests",
        "my-workspace/my-repo",
        "--state",
        "OPEN",
        "--state",
        "DECLINED",
      ]).args.state,
      ["OPEN", "DECLINED"],
    );
  });

  it("merges --json with the other arguments", () => {
    const content = 'Line one\n"quoted"';
    const call = dryRun([
      "add_pull_request_comment",
      "my-workspace/my-repo",
      "42",
      "--json",
      JSON.stringify({ content }),
    ]);
    assert.equal(call.args.content, content);
  });

  const usageErrors = [
    [["no_such_tool"], /Unknown tool 'no_such_tool'/],
    [["get_pull_request", "my-workspace/my-repo", "42", "extra"], /Too many positional arguments/],
    [["get_pull_request", "my-workspace/my-repo", "42", "--nope", "x"], /Unknown option '--nope'/],
    [["get_pull_request", "my-workspace/my-repo", "forty-two"], /expects a number/],
    [
      ["list_pull_requests", "my-workspace/my-repo", "--state", "open"],
      /expects one of: OPEN, MERGED/,
    ],
    [["list_pull_requests", "my-workspace/my-repo", "--limit"], /requires a value/],
    [["get_pull_request", "--json", "[1]"], /must be a JSON object/],
    [["run"], /Missing script file/],
  ];
  for (const [args, message] of usageErrors) {
    it(`exits with 2 for: ${args.join(" ")}`, () => {
      const { code, stderr } = bitbucket(args);
      assert.equal(code, 2);
      assert.match(stderr, message);
    });
  }

  it("exits with 2 when an argument cannot name a repository", () => {
    const { code, stderr } = bitbucket(["get_pull_request", "my-repo", "42", "--dry-run"]);
    assert.equal(code, 2);
    assert.match(stderr, /'my-repo' does not name a repository/);
  });

  it("asks for the pull request id when only a repository is given", () => {
    const { code, stderr } = bitbucket(["get_pull_request", "my-workspace/my-repo", "--dry-run"]);
    assert.equal(code, 2);
    assert.match(stderr, /No pull request id/);
  });

  it("takes a pull request URL in place of repository and id", () => {
    const call = dryRun([
      "get_pull_request",
      "https://bitbucket.org/my-workspace/my-repo/pull-requests/42",
    ]);
    assert.deepEqual(call.args, { repo: "my-workspace/my-repo", id: 42 });
  });

  it("refuses a URL and an id that disagree", () => {
    const { code, stderr } = bitbucket([
      "get_pull_request",
      "https://bitbucket.org/my-workspace/my-repo/pull-requests/42",
      "--id",
      "7",
      "--dry-run",
    ]);
    assert.equal(code, 2);
    assert.match(stderr, /URL names pull request 42, but 'id' says 7/);
  });

  it("keeps a path positional out of the repository slot", () => {
    const call = dryRun(["get_file", "src/A.php", "--ref", "main"], {
      env: { BITBUCKET_REPO: "my-workspace/my-repo" },
    });
    assert.deepEqual(call.args, { repo: "my-workspace/my-repo", path: "src/A.php", ref: "main" });
  });

  it("takes booleans as flags, and --no- turns them off", () => {
    assert.equal(
      dryRun(["merge_pull_request", "a/b", "42", "--closeSourceBranch"]).args.closeSourceBranch,
      true,
    );
    assert.equal(
      dryRun(["merge_pull_request", "a/b", "42", "--no-close-source-branch"]).args
        .closeSourceBranch,
      false,
    );
    assert.equal(
      dryRun(["merge_pull_request", "a/b", "42", "--closeSourceBranch=false"]).args
        .closeSourceBranch,
      false,
    );
  });

  it("splits a reviewer list on commas", () => {
    const call = dryRun([
      "create_pull_request",
      "a/b",
      "Title",
      "feature",
      "--reviewers",
      "{uuid-1},acc-2",
    ]);
    assert.deepEqual(call.args.reviewers, ["{uuid-1}", "acc-2"]);
  });
});

describe("the repository of a call", () => {
  it("comes from the checkout the command runs in", () => {
    const call = dryRun(["list_pull_requests"], { cwd: checkout() });
    assert.equal(call.args.repo, "my-workspace/my-repo");
  });

  it("reads an https remote too", () => {
    const call = dryRun(["get_pull_request", "42"], {
      cwd: checkout("https://prokyon@bitbucket.org/my-workspace/my-repo.git"),
    });
    assert.deepEqual(call.args, { repo: "my-workspace/my-repo", id: 42 });
  });

  it("prefers BITBUCKET_REPO over the checkout", () => {
    const call = dryRun(["list_pull_requests"], {
      cwd: checkout(),
      env: { BITBUCKET_REPO: "other-workspace/other-repo" },
    });
    assert.equal(call.args.repo, "other-workspace/other-repo");
  });

  it("prefers the argument over everything", () => {
    const call = dryRun(["list_pull_requests", "named/repo"], {
      cwd: checkout(),
      env: { BITBUCKET_REPO: "other-workspace/other-repo" },
    });
    assert.equal(call.args.repo, "named/repo");
  });

  it("explains itself outside a Bitbucket checkout", () => {
    const { code, stderr } = bitbucket(["list_pull_requests", "--dry-run"]);
    assert.equal(code, 2);
    assert.match(stderr, /No repository given/);
    assert.match(stderr, /BITBUCKET_REPO/);
  });
});

describe("credentials", () => {
  it("tells how to authenticate when none are found", () => {
    const { code, stderr } = bitbucket(["get_current_user"]);
    assert.equal(code, 1);
    assert.match(stderr, /No Bitbucket credentials found/);
    assert.match(stderr, /bitbucket setup/);
  });

  it("setup refuses to prompt without a terminal and saves nothing", () => {
    const { code, stderr } = bitbucket(["setup", "--no-agent-skills"], { input: "" });
    assert.equal(code, 1);
    assert.match(stderr, /not an interactive terminal/);
  });

  it("setup installs the skill into an explicit agent directory", () => {
    const root = join(mkdtempSync(join(tmpdir(), "bitbucket-cli-")), "agent");
    const { code, stdout } = bitbucket(["setup", "--no-auth", "--dir", root]);

    assert.equal(code, 0);
    assert.match(stdout, /bitbucket-cli installed/);
    assert.match(
      readFileSync(join(root, "skills", "bitbucket-cli", "SKILL.md"), "utf8"),
      /^---\nname: bitbucket-cli\n/,
    );
  });

  it("setup reads a piped token only with an email", () => {
    const missingEmail = bitbucket(["setup", "--token-stdin", "--no-agent-skills"], {
      input: "ATATT-token",
    });
    assert.equal(missingEmail.code, 1);
    assert.match(missingEmail.stderr, /--token-stdin needs --email/);

    const nothingPiped = bitbucket(
      ["setup", "--email", "me@example.com", "--token-stdin", "--no-agent-skills"],
      { input: "" },
    );
    assert.equal(nothingPiped.code, 1);
    assert.match(nothingPiped.stderr, /Nothing arrived on stdin/);
  });

  it("setup lists the token scopes in its help", () => {
    const { stdout } = bitbucket(["setup", "--help"]);
    for (const scope of [
      "read:user",
      "read:pullrequest",
      "write:pullrequest",
      "read:repository",
      "read:pipeline",
      "write:pipeline",
      "read:workspace",
    ]) {
      assert.match(stdout, new RegExp(`${scope}:bitbucket`));
    }
  });

  it("setup exits with 2 for an unknown option", () => {
    const { code, stderr } = bitbucket(["setup", "--api-key", "x"]);
    assert.equal(code, 2);
    assert.match(stderr, /Unknown option '--api-key' for 'setup'/);
  });
});

describe("run", () => {
  it("dry-runs a script from stdin without credentials", () => {
    const script = {
      name: "Review",
      steps: [
        {
          id: "summary",
          tool: "add_pull_request_comment",
          args: { repo: "my-workspace/my-repo", id: 42, content: "Summary" },
        },
        {
          tool: "add_pull_request_comment",
          args: {
            repo: "my-workspace/my-repo",
            id: 42,
            content: "Detail",
            parentId: "{{summary.id}}",
          },
        },
      ],
    };
    const { code, stdout, stderr } = bitbucket(["run", "-", "--dry-run"], {
      input: JSON.stringify(script),
    });

    assert.equal(code, 0, stderr);
    assert.match(stderr, /▶ Review\n\[1\/2\] add_pull_request_comment \(dry run\)/);
    const results = JSON.parse(stdout);
    assert.equal(results.length, 2);
    assert.equal(results[1].args.parentId, "{{summary.id}}");
  });

  it("exits with 2 for a script that cannot run as written", () => {
    const script = [
      { tool: "add_pull_request_comment", args: { repo: "a/b", id: 1, content: "x", lines: 3 } },
    ];
    const { code, stderr } = bitbucket(["run", "-", "--dry-run"], {
      input: JSON.stringify(script),
    });
    assert.equal(code, 2);
    assert.match(stderr, /unknown argument lines/);
  });
});
