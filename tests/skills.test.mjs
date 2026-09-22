import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { bundledSkillDir, detectAgentRoots, installSkill } from "../build/skills.js";

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "bitbucket-cli-"));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("detectAgentRoots", () => {
  it("finds only agent directories that exist, never creating one", () => {
    assert.deepEqual(detectAgentRoots(), []);

    mkdirSync(join(home, ".claude"));
    assert.deepEqual(detectAgentRoots(), [join(home, ".claude")]);
  });

  it("honours explicit roots whether or not they exist", () => {
    assert.deepEqual(detectAgentRoots([join(home, "elsewhere")]), [join(home, "elsewhere")]);
  });
});

describe("installSkill", () => {
  it("installs, then reports up to date, then updates a changed copy", () => {
    const root = join(home, ".claude");
    const skill = join(root, "skills", "bitbucket-cli", "SKILL.md");

    assert.equal(installSkill(root).status, "installed");
    assert.deepEqual(readFileSync(skill), readFileSync(join(bundledSkillDir(), "SKILL.md")));
    assert.equal(installSkill(root).status, "unchanged");

    writeFileSync(skill, "stale");
    assert.equal(installSkill(root).status, "updated");
    assert.notEqual(readFileSync(skill, "utf8"), "stale");
  });

  it("writes nothing on a dry run", () => {
    const root = join(home, ".claude");
    assert.equal(installSkill(root, { dryRun: true }).status, "installed");
    assert.equal(installSkill(root).status, "installed");
  });
});
