import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Installs the bundled agent skill into detected agent root directories, so an
 * agent knows how to drive this CLI. The skill ships inside the package — no
 * network access is involved.
 */

export const SKILL_NAME = "bitbucket-cli";

export type InstallStatus = "installed" | "updated" | "unchanged";

export interface SkillInstallation {
  root: string;
  path: string;
  status: InstallStatus;
  files: string[];
}

/** Directory of the skill bundled with this package. */
export function bundledSkillDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "skills", SKILL_NAME);
}

/**
 * Agent root directories that already exist on this machine — `~/.claude` and
 * `~/.agents`, plus CLAUDE_CONFIG_DIR when set. Roots are never created
 * implicitly; pass extras explicitly to install somewhere else.
 */
export function detectAgentRoots(extra: string[] = []): string[] {
  const candidates = [
    process.env.CLAUDE_CONFIG_DIR,
    join(homedir(), ".claude"),
    join(homedir(), ".agents"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const roots = new Set<string>();
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (existsSync(path) && statSync(path).isDirectory()) {
      roots.add(path);
    }
  }
  // Explicit roots are honoured whether or not they exist yet.
  for (const candidate of extra) {
    roots.add(resolve(candidate));
  }
  return [...roots];
}

export function installSkill(root: string, options: { dryRun?: boolean } = {}): SkillInstallation {
  const source = bundledSkillDir();
  if (!existsSync(source)) {
    throw new Error(`Bundled skill not found at ${source}`);
  }

  const target = join(root, "skills", SKILL_NAME);
  const files = listFiles(source);
  const existed = existsSync(target);
  let changed = false;

  for (const file of files) {
    const from = join(source, file);
    const to = join(target, file);
    const contents = readFileSync(from);

    if (!existsSync(to) || !readFileSync(to).equals(contents)) {
      changed = true;
      if (!options.dryRun) {
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, contents);
      }
    }
  }

  const status: InstallStatus = !existed ? "installed" : changed ? "updated" : "unchanged";
  return { root, path: target, status, files };
}

export function installSkills(
  roots: string[],
  options: { dryRun?: boolean } = {},
): SkillInstallation[] {
  return roots.map((root) => installSkill(root, options));
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path, base) : [relative(base, path)];
  });
}
