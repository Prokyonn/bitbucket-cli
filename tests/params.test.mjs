import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UsageError } from "../build/errors.js";
import {
  createPullRequestBody,
  mergeBody,
  taskBody,
  triggerPipelineBody,
  updatePullRequestBody,
} from "../build/params.js";

describe("createPullRequestBody", () => {
  it("needs only a title and a source branch", () => {
    assert.deepEqual(createPullRequestBody({ title: "Fix login", source: "feature-x" }), {
      title: "Fix login",
      source: { branch: { name: "feature-x" } },
    });
  });

  it("carries destination, description, reviewers and the flags", () => {
    assert.deepEqual(
      createPullRequestBody({
        title: "Fix login",
        source: "feature-x",
        destination: "develop",
        description: "Why",
        reviewers: ["{uuid-1}", "account-2"],
        closeSourceBranch: true,
        draft: false,
      }),
      {
        title: "Fix login",
        source: { branch: { name: "feature-x" } },
        destination: { branch: { name: "develop" } },
        description: "Why",
        reviewers: [{ uuid: "{uuid-1}" }, { account_id: "account-2" }],
        close_source_branch: true,
        draft: false,
      },
    );
  });

  for (const params of [
    { title: "", source: "x" },
    { title: "t", source: " " },
  ]) {
    it(`refuses ${JSON.stringify(params)}`, () => {
      assert.throws(() => createPullRequestBody(params), UsageError);
    });
  }
});

describe("updatePullRequestBody", () => {
  it("sends only what was given", () => {
    assert.deepEqual(updatePullRequestBody({ title: "New" }), { title: "New" });
    assert.deepEqual(updatePullRequestBody({}), {});
  });

  it("keeps an empty description, which clears it", () => {
    assert.deepEqual(updatePullRequestBody({ description: "" }), { description: "" });
  });
});

describe("mergeBody", () => {
  it("passes the strategy through under Bitbucket's name", () => {
    assert.deepEqual(
      mergeBody({ strategy: "squash", message: "Merged", closeSourceBranch: true }),
      {
        merge_strategy: "squash",
        message: "Merged",
        close_source_branch: true,
      },
    );
    assert.deepEqual(mergeBody({}), {});
  });
});

describe("taskBody", () => {
  it("creates a task, optionally on a comment", () => {
    assert.deepEqual(taskBody({ content: "Add a test" }, { creating: true }), {
      content: { raw: "Add a test" },
    });
    assert.deepEqual(taskBody({ content: "Add a test", commentId: 7 }, { creating: true }), {
      content: { raw: "Add a test" },
      comment: { id: 7 },
    });
  });

  it("ticks a task off and reopens it", () => {
    assert.deepEqual(taskBody({ resolved: true }, { creating: false }), { state: "RESOLVED" });
    assert.deepEqual(taskBody({ resolved: false }, { creating: false }), { state: "UNRESOLVED" });
  });

  it("insists on content when creating, and refuses to move a task to a comment", () => {
    assert.throws(() => taskBody({}, { creating: true }), UsageError);
    assert.throws(() => taskBody({ commentId: 7 }, { creating: false }), UsageError);
  });
});

describe("triggerPipelineBody", () => {
  it("starts a branch pipeline", () => {
    assert.deepEqual(triggerPipelineBody({ branch: "main" }), {
      target: { type: "pipeline_ref_target", ref_type: "branch", ref_name: "main" },
    });
  });

  it("starts a commit on a branch, with a custom pipeline and variables", () => {
    assert.deepEqual(
      triggerPipelineBody({
        branch: "main",
        commit: "abc123",
        pipeline: "Deploy to production",
        variables: ["ENVIRONMENT=prod", "MESSAGE=hello=world"],
      }),
      {
        target: {
          type: "pipeline_ref_target",
          ref_type: "branch",
          ref_name: "main",
          commit: { type: "commit", hash: "abc123" },
          selector: { type: "custom", pattern: "Deploy to production" },
        },
        variables: [
          { key: "ENVIRONMENT", value: "prod" },
          { key: "MESSAGE", value: "hello=world" },
        ],
      },
    );
  });

  it("starts a commit on its own", () => {
    assert.deepEqual(triggerPipelineBody({ commit: "abc123" }), {
      target: { type: "pipeline_commit_target", commit: { type: "commit", hash: "abc123" } },
    });
  });

  it("needs a branch or a commit, and well-formed variables", () => {
    assert.throws(() => triggerPipelineBody({}), UsageError);
    assert.throws(() => triggerPipelineBody({ branch: "main", variables: ["NOPE"] }), UsageError);
  });
});
