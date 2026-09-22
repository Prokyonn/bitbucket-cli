/**
 * npm postinstall hook: installs the agent skill into detected agent root
 * directories on a global install, so `npm i -g` is enough to make the skill
 * available. The skill ships inside the package — nothing is fetched.
 *
 * Best-effort by design: it never fails an install, never touches anything
 * outside existing agent directories, and stays quiet when there is nothing to
 * do. Opt out with BITBUCKET_NO_AGENT_SKILLS=1, or run `bitbucket setup
 * --no-agent-skills` for manual control.
 */

import { detectAgentRoots, installSkills, SKILL_NAME } from "./skills.js";

function shouldInstall(): boolean {
  if (process.env.BITBUCKET_NO_AGENT_SKILLS) return false;
  // Local/CI installs of the package as a dependency must not write to $HOME.
  if (process.env.CI) return false;
  return process.env.npm_config_global === "true";
}

try {
  if (shouldInstall()) {
    const roots = detectAgentRoots();
    for (const installation of installSkills(roots)) {
      if (installation.status !== "unchanged") {
        console.log(`${SKILL_NAME} skill ${installation.status}: ${installation.path}`);
      }
    }
    if (roots.length > 0) {
      console.log("Run 'bitbucket setup' to authenticate.");
    }
  }
} catch {
  // Never break an install over an optional convenience.
}
