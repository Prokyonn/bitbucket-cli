import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runScript, ScriptError, validateScript } from "../build/script.js";
import { UsageError } from "../build/errors.js";

const REPO = "my-workspace/my-repo";

/** Records the calls a script makes; the comment ids count up from 100. */
function fakeClient() {
  const calls = [];
  let nextId = 100;
  return {
    calls,
    async addPullRequestComment(repo, id, params) {
      calls.push(["comment", repo, id, params]);
      if (params.content === "fail") throw new Error("Bitbucket returned HTTP 400");
      return { id: nextId++ };
    },
    async requestChanges(repo, id) {
      calls.push(["request_changes", repo, id]);
      return { state: "changes_requested" };
    },
  };
}

function comment(content, extra = {}) {
  return { tool: "add_pull_request_comment", args: { repo: REPO, id: 42, content, ...extra } };
}

describe("validateScript", () => {
  const invalid = [
    [{ steps: "no" }, /must be a JSON array of steps/],
    [[{ tool: "delete_everything" }], /unknown tool 'delete_everything'/],
    [
      [{ ...comment("x"), args: { repo: REPO, id: 42, content: "x", lines: 3 } }],
      /unknown argument lines/,
    ],
    [[{ tool: "request_changes", args: { repo: REPO } }], /is missing id/],
    [
      [comment("x", { parentId: "{{later.id}}" }), { id: "later", ...comment("y") }],
      /no earlier step has id 'later'/,
    ],
    [
      [
        { id: "a", ...comment("x") },
        { id: "a", ...comment("y") },
      ],
      /Duplicate step id 'a'/,
    ],
  ];
  for (const [script, message] of invalid) {
    it(`refuses ${JSON.stringify(script).slice(0, 70)}`, () => {
      assert.throws(
        () => validateScript(script),
        (error) =>
          error instanceof ScriptError &&
          error instanceof UsageError &&
          message.test(error.message),
      );
    });
  }

  it("accepts a plain array of steps and an object with a name", () => {
    assert.equal(validateScript([comment("x")]).steps.length, 1);
    assert.equal(validateScript({ name: "Review", steps: [comment("x")] }).name, "Review");
  });
});

describe("runScript", () => {
  it("passes an earlier step's result on, keeping its type", async () => {
    const client = fakeClient();
    const script = validateScript([
      { id: "summary", ...comment("Summary") },
      comment("Detail on {{summary.id}}", { parentId: "{{summary.id}}" }),
    ]);

    const results = await runScript(client, script);

    const [kind, repo, id, params] = client.calls[1];
    assert.deepEqual([kind, repo, id], ["comment", REPO, 42]);
    assert.equal(params.content, "Detail on 100");
    assert.equal(params.parentId, 100);
    assert.deepEqual(
      results.map((step) => step.result),
      [{ id: 100 }, { id: 101 }],
    );
  });

  it("reads the environment", async () => {
    process.env.BITBUCKET_TEST_REPO = REPO;
    const client = fakeClient();
    await runScript(
      client,
      validateScript([
        { tool: "request_changes", args: { repo: "{{env.BITBUCKET_TEST_REPO}}", id: 42 } },
      ]),
    );
    assert.deepEqual(client.calls, [["request_changes", REPO, 42]]);
  });

  it("stops at a failing step and still returns what already ran", async () => {
    const client = fakeClient();
    const results = await runScript(
      client,
      validateScript([comment("first"), comment("fail"), comment("never")]),
    );

    assert.equal(client.calls.length, 2);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0].result, { id: 100 });
    assert.match(results[1].error, /HTTP 400/);
  });

  it("keeps going past a failing step with continueOnError", async () => {
    const client = fakeClient();
    const results = await runScript(client, validateScript([comment("fail"), comment("second")]), {
      continueOnError: true,
    });

    assert.equal(results.length, 2);
    assert.ok(results[0].error);
    assert.deepEqual(results[1].result, { id: 100 });
  });

  it("records an unset environment variable as the step's error", async () => {
    delete process.env.BITBUCKET_TEST_UNSET;
    const results = await runScript(
      fakeClient(),
      validateScript([
        { tool: "request_changes", args: { repo: "{{env.BITBUCKET_TEST_UNSET}}", id: 42 } },
      ]),
    );
    assert.match(results[0].error, /unset env var 'BITBUCKET_TEST_UNSET'/);
  });

  it("calls nothing on a dry run and leaves step references in place", async () => {
    const results = await runScript(
      null,
      validateScript([
        { id: "summary", ...comment("Summary") },
        comment("Reply", { parentId: "{{summary.id}}" }),
      ]),
      { dryRun: true },
    );

    assert.equal(results[1].args.parentId, "{{summary.id}}");
    assert.equal(results[0].result, undefined);
  });
});
