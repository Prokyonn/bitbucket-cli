import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { API_URL, BitbucketClient } from "../build/bitbucket-client.js";

/** Every call lands on the endpoint and method the API documents. */

const REPO = "my-workspace/my-repo";
const BASE = `${API_URL}/repositories/my-workspace/my-repo`;

let requests;
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body });
    return new Response(JSON.stringify({ values: [], mainbranch: { name: "main" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const client = new BitbucketClient({ email: "me@example.com", token: "secret" });

const calls = [
  ["listWorkspaces", [], `GET ${API_URL}/user/workspaces?pagelen=50`],
  ["listPullRequestActivity", [REPO, 42], `GET ${BASE}/pullrequests/42/activity?pagelen=50`],
  ["listPullRequestStatuses", [REPO, 42], `GET ${BASE}/pullrequests/42/statuses?pagelen=50`],
  ["createPullRequest", [REPO, { title: "t", source: "s" }], `POST ${BASE}/pullrequests`],
  ["updatePullRequest", [REPO, 42, { title: "t" }], `PUT ${BASE}/pullrequests/42`],
  ["mergePullRequest", [REPO, 42, {}], `POST ${BASE}/pullrequests/42/merge`],
  ["declinePullRequest", [REPO, 42], `POST ${BASE}/pullrequests/42/decline`],
  ["getPullRequestComment", [REPO, 42, 7], `GET ${BASE}/pullrequests/42/comments/7`],
  ["updatePullRequestComment", [REPO, 42, 7, "text"], `PUT ${BASE}/pullrequests/42/comments/7`],
  ["deletePullRequestComment", [REPO, 42, 7], `DELETE ${BASE}/pullrequests/42/comments/7`],
  ["resolvePullRequestComment", [REPO, 42, 7], `POST ${BASE}/pullrequests/42/comments/7/resolve`],
  ["reopenPullRequestComment", [REPO, 42, 7], `DELETE ${BASE}/pullrequests/42/comments/7/resolve`],
  ["listPullRequestTasks", [REPO, 42], `GET ${BASE}/pullrequests/42/tasks?pagelen=50`],
  ["createPullRequestTask", [REPO, 42, { content: "do" }], `POST ${BASE}/pullrequests/42/tasks`],
  [
    "updatePullRequestTask",
    [REPO, 42, 3, { resolved: true }],
    `PUT ${BASE}/pullrequests/42/tasks/3`,
  ],
  ["deletePullRequestTask", [REPO, 42, 3], `DELETE ${BASE}/pullrequests/42/tasks/3`],
  ["getRepository", [REPO], `GET ${BASE}`],
  ["getBranch", [REPO, "feature/x"], `GET ${BASE}/refs/branches/feature/x`],
  ["getCommit", [REPO, "abc123"], `GET ${BASE}/commit/abc123`],
  ["listCommitStatuses", [REPO, "abc123"], `GET ${BASE}/commit/abc123/statuses?pagelen=50`],
  ["getPipeline", [REPO, "{uuid-1}"], `GET ${BASE}/pipelines/%7Buuid-1%7D`],
  ["getPipeline", [REPO, "77"], `GET ${BASE}/pipelines/77`],
  ["listPipelineSteps", [REPO, "77"], `GET ${BASE}/pipelines/77/steps?pagelen=50`],
  ["getPipelineStepLog", [REPO, "77", "{step}"], `GET ${BASE}/pipelines/77/steps/%7Bstep%7D/log`],
  ["triggerPipeline", [REPO, { branch: "main" }], `POST ${BASE}/pipelines`],
  ["stopPipeline", [REPO, "77"], `POST ${BASE}/pipelines/77/stopPipeline`],
];

describe("endpoints", () => {
  for (const [method, args, expected] of calls) {
    it(`${method} calls ${expected.split(" ")[0]} ${expected.split("/").slice(-1)[0]}`, async () => {
      await client[method](...args);
      const request = requests.at(-1);
      assert.equal(`${request.method} ${request.url}`, expected);
    });
  }
});

describe("listing options", () => {
  it("filters pull requests with a Bitbucket query", async () => {
    await client.listPullRequests(REPO, { query: 'source.branch.name="feature-x"' });
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get("q"), 'source.branch.name="feature-x"');
  });

  it("filters pipelines by branch, newest first", async () => {
    await client.listPipelines(REPO, { branch: "main", limit: 5 });
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get("q"), 'target.ref_name="main"');
    assert.equal(url.searchParams.get("sort"), "-created_on");
    assert.equal(url.searchParams.get("pagelen"), "5");
  });

  it("refuses a branch and a query at once", async () => {
    await assert.rejects(client.listPipelines(REPO, { branch: "main", query: "x" }), /not both/);
  });

  it("lists commits of a revision, or of the whole repository", async () => {
    await client.listCommits(REPO, { revision: "feature/x" });
    assert.match(requests[0].url, new RegExp(`^${BASE}/commits/feature/x\\?`));

    await client.listCommits(REPO, {});
    assert.match(requests[1].url, new RegExp(`^${BASE}/commits\\?`));
  });

  it("lists a workspace's repositories", async () => {
    await client.listRepositories("my-workspace", { query: 'name~"api"' });
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, "/2.0/repositories/my-workspace");
    assert.equal(url.searchParams.get("q"), 'name~"api"');
  });
});

describe("getFile", () => {
  it("reads a path at the ref it is given", async () => {
    await client.getFile(REPO, "src/A.php", "main");
    assert.equal(requests[0].url, `${BASE}/src/main/src/A.php`);
    assert.equal(requests.length, 1);
  });

  it("asks the repository for its main branch when no ref is given", async () => {
    await client.getFile(REPO, "composer.json");
    assert.deepEqual(
      requests.map((request) => request.url),
      [BASE, `${BASE}/src/main/composer.json`],
    );
  });

  it("returns text for a file and JSON for a directory", async () => {
    globalThis.fetch = async () =>
      new Response("<?php\n", { status: 200, headers: { "Content-Type": "text/plain" } });
    assert.equal(await client.getFile(REPO, "src/A.php", "main"), "<?php\n");

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ values: [{ path: "src/A.php" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    assert.deepEqual(await client.getFile(REPO, "src", "main"), {
      values: [{ path: "src/A.php" }],
    });
  });
});
