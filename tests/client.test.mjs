import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { API_URL, BitbucketApiError, BitbucketClient } from "../build/bitbucket-client.js";
import { UsageError } from "../build/errors.js";

const PR = `${API_URL}/repositories/my-workspace/my-repo/pullrequests/42`;

let requests;
let responses;
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  responses = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request to ${url}`);
    return next;
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply(body, status = 200) {
  responses.push(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const client = new BitbucketClient({ email: "me@example.com", token: "ATATT-secret" });

describe("requests", () => {
  it("authenticates with Basic auth from email and token", async () => {
    reply({ nickname: "me" });
    await client.getCurrentUser();

    assert.equal(requests[0].url, `${API_URL}/user`);
    assert.equal(requests[0].method, "GET");
    const expected = Buffer.from("me@example.com:ATATT-secret").toString("base64");
    assert.equal(requests[0].headers.Authorization, `Basic ${expected}`);
  });

  it("addresses a pull request by workspace/slug and id", async () => {
    reply({ id: 42 });
    assert.deepEqual(await client.getPullRequest("my-workspace/my-repo", 42), { id: 42 });
    assert.equal(requests[0].url, PR);
  });

  it("encodes the repository parts", async () => {
    reply({});
    await client.getPullRequest("my workspace/my?repo", 1);
    assert.equal(
      requests[0].url,
      `${API_URL}/repositories/my%20workspace/my%3Frepo/pullrequests/1`,
    );
  });

  it("accepts an id given as a digit string, as script placeholders produce", async () => {
    reply({});
    await client.getPullRequest("my-workspace/my-repo", "42");
    assert.equal(requests[0].url, PR);
  });

  for (const repo of ["my-repo", "a/b/c", "/my-repo", "my-workspace/"]) {
    it(`rejects the repo '${repo}' before any request`, async () => {
      await assert.rejects(client.getPullRequest(repo, 1), UsageError);
      assert.equal(requests.length, 0);
    });
  }

  for (const id of [0, -1, 1.5, "abc", "42/../x"]) {
    it(`rejects the id '${id}' before any request`, async () => {
      await assert.rejects(client.getPullRequest("my-workspace/my-repo", id), UsageError);
      assert.equal(requests.length, 0);
    });
  }

  it("asks for the diff as any content type and returns it unchanged", async () => {
    const diff = "diff --git a/x b/x\n+added\n";
    responses.push(new Response(diff, { status: 200, headers: { "Content-Type": "text/plain" } }));

    assert.equal(await client.getPullRequestDiff("my-workspace/my-repo", 42), diff);
    assert.equal(requests[0].url, `${PR}/diff`);
    assert.equal(requests[0].headers.Accept, "*/*");
  });

  it("approves with a POST and unapproves with a DELETE", async () => {
    reply({ approved: true });
    reply(null, 204);

    assert.deepEqual(await client.approvePullRequest("my-workspace/my-repo", 42), {
      approved: true,
    });
    assert.equal(await client.unapprovePullRequest("my-workspace/my-repo", 42), undefined);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      [`POST ${PR}/approve`, `DELETE ${PR}/approve`],
    );
  });

  it("requests changes with a POST and withdraws them with a DELETE", async () => {
    reply({ state: "changes_requested" });
    reply(null, 204);

    await client.requestChanges("my-workspace/my-repo", 42);
    await client.removeRequestChanges("my-workspace/my-repo", 42);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      [`POST ${PR}/request-changes`, `DELETE ${PR}/request-changes`],
    );
  });
});

describe("pagination", () => {
  it("follows next links and collects every page", async () => {
    reply({ values: [1, 2], next: `${PR}/comments?page=2` });
    reply({ values: [3] });

    assert.deepEqual(await client.listPullRequestComments("my-workspace/my-repo", 42), [1, 2, 3]);
    assert.deepEqual(
      requests.map((request) => request.url),
      [`${PR}/comments?pagelen=50`, `${PR}/comments?page=2`],
    );
  });

  it("filters pull requests by state, newest update first, and stops at the limit", async () => {
    reply({
      values: [1, 2],
      next: `${API_URL}/repositories/my-workspace/my-repo/pullrequests?page=2`,
    });

    const pullRequests = await client.listPullRequests("my-workspace/my-repo", {
      states: ["OPEN", "MERGED"],
      limit: 2,
    });

    assert.deepEqual(pullRequests, [1, 2]);
    assert.equal(requests.length, 1);
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, "/2.0/repositories/my-workspace/my-repo/pullrequests");
    assert.deepEqual(url.searchParams.getAll("state"), ["OPEN", "MERGED"]);
    assert.equal(url.searchParams.get("sort"), "-updated_on");
    assert.equal(url.searchParams.get("pagelen"), "2");
  });

  it("never sends the credentials to a next link outside the API", async () => {
    reply({ values: [1], next: "https://evil.example.com/steal" });

    await assert.rejects(
      client.listPullRequestCommits("my-workspace/my-repo", 42),
      /Refusing to follow a link outside/,
    );
    assert.equal(requests.length, 1);
  });
});

describe("comments", () => {
  async function bodyOf(params) {
    reply({ id: 1 });
    await client.addPullRequestComment("my-workspace/my-repo", 42, params);
    const request = requests.at(-1);
    assert.equal(request.method, "POST");
    assert.equal(request.url, `${PR}/comments`);
    assert.equal(request.headers["Content-Type"], "application/json");
    return JSON.parse(request.body);
  }

  it("posts a general comment", async () => {
    assert.deepEqual(await bodyOf({ content: "Looks good" }), { content: { raw: "Looks good" } });
  });

  it("posts an inline comment on a line of the new file", async () => {
    assert.deepEqual(await bodyOf({ content: "Typo", path: "src/A.php", line: 12 }), {
      content: { raw: "Typo" },
      inline: { path: "src/A.php", to: 12 },
    });
  });

  it("posts an inline comment on a range", async () => {
    assert.deepEqual(
      await bodyOf({ content: "Extract", path: "src/A.php", line: 20, startLine: 12 }),
      {
        content: { raw: "Extract" },
        inline: { path: "src/A.php", to: 20, start_to: 12 },
      },
    );
  });

  it("posts a comment on a whole file", async () => {
    assert.deepEqual(await bodyOf({ content: "Split this", path: "src/A.php" }), {
      content: { raw: "Split this" },
      inline: { path: "src/A.php" },
    });
  });

  it("posts a reply", async () => {
    assert.deepEqual(await bodyOf({ content: "Done", parentId: 7 }), {
      content: { raw: "Done" },
      parent: { id: 7 },
    });
  });

  const invalid = [
    [{ content: " " }, /must not be empty/],
    [{ content: "x", line: 3 }, /'line' needs 'path'/],
    [{ content: "x", path: "a", startLine: 3 }, /'startLine' needs 'line'/],
    [{ content: "x", path: "a", parentId: 7 }, /drop 'path'/],
    [{ content: "x", path: "a", line: 0 }, /'line' must be a positive whole number/],
  ];
  for (const [params, message] of invalid) {
    it(`refuses ${JSON.stringify(params)} before any request`, async () => {
      await assert.rejects(
        client.addPullRequestComment("my-workspace/my-repo", 42, params),
        (error) => error instanceof UsageError && message.test(error.message),
      );
      assert.equal(requests.length, 0);
    });
  }
});

describe("errors", () => {
  it("reports Bitbucket's message and detail with the status", async () => {
    reply(
      {
        type: "error",
        error: {
          message: "Your credentials lack one or more required privilege scopes.",
          detail: {
            required: ["read:repository:bitbucket"],
            granted: ["read:pullrequest:bitbucket"],
          },
        },
      },
      403,
    );

    await assert.rejects(client.getPullRequestDiff("my-workspace/my-repo", 42), (error) => {
      assert.ok(error instanceof BitbucketApiError);
      assert.equal(error.status, 403);
      assert.match(
        error.message,
        /HTTP 403 for GET \/repositories\/my-workspace\/my-repo\/pullrequests\/42\/diff/,
      );
      assert.match(error.message, /lack one or more required privilege scopes/);
      assert.match(error.message, /read:repository:bitbucket/);
      return true;
    });
  });

  it("falls back to the status text when the body is not JSON", async () => {
    responses.push(new Response("<html>", { status: 401, statusText: "Unauthorized" }));

    await assert.rejects(client.getCurrentUser(), (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.message, "Bitbucket returned HTTP 401 for GET /user: Unauthorized");
      return true;
    });
  });
});
