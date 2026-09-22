import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import {
  credentialsPath,
  loadCredentials,
  readStoredCredentials,
  writeStoredCredentials,
} from "../build/config.js";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "bitbucket-cli-"));
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  process.chdir(dir);
  delete process.env.BITBUCKET_EMAIL;
  delete process.env.BITBUCKET_API_TOKEN;
});

describe("stored credentials", () => {
  it("are written readable only by the owner", () => {
    const path = writeStoredCredentials({ email: "me@example.com", token: "stored" });

    assert.equal(path, credentialsPath());
    assert.equal(path, join(process.env.XDG_CONFIG_HOME, "bitbucket-cli", "credentials.json"));
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      email: "me@example.com",
      token: "stored",
    });
  });

  it("tighten the permissions of an existing file", () => {
    const path = writeStoredCredentials({ email: "me@example.com", token: "first" });
    writeFileSync(path, "{}", { mode: 0o644 });
    writeStoredCredentials({ email: "me@example.com", token: "second" });

    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("count as missing when the file is corrupt", () => {
    const path = writeStoredCredentials({ email: "me@example.com", token: "stored" });
    writeFileSync(path, "not json");

    assert.equal(readStoredCredentials(), null);
  });
});

describe("loadCredentials", () => {
  it("returns null when nothing is configured", () => {
    assert.equal(loadCredentials(), null);
  });

  it("falls back to the stored file", () => {
    writeStoredCredentials({ email: "me@example.com", token: "stored" });
    assert.deepEqual(loadCredentials(), { email: "me@example.com", token: "stored" });
  });

  it("prefers the environment over the stored file", () => {
    writeStoredCredentials({ email: "me@example.com", token: "stored" });
    process.env.BITBUCKET_EMAIL = "env@example.com";
    process.env.BITBUCKET_API_TOKEN = "from-env";

    assert.deepEqual(loadCredentials(), { email: "env@example.com", token: "from-env" });
  });

  it("reads a .env file in the working directory, the environment winning over it", () => {
    writeFileSync(".env", "BITBUCKET_EMAIL=dotenv@example.com\nBITBUCKET_API_TOKEN=from-dotenv\n");
    assert.deepEqual(loadCredentials(), { email: "dotenv@example.com", token: "from-dotenv" });

    process.env.BITBUCKET_API_TOKEN = "from-env";
    assert.deepEqual(loadCredentials(), { email: "dotenv@example.com", token: "from-env" });
  });

  it("ignores an incomplete environment", () => {
    writeStoredCredentials({ email: "me@example.com", token: "stored" });
    process.env.BITBUCKET_API_TOKEN = "from-env";

    assert.deepEqual(loadCredentials(), { email: "me@example.com", token: "stored" });
  });
});
