import { createInterface, Interface } from "readline";
import { BitbucketApiError, BitbucketClient } from "./bitbucket-client.js";
import {
  Credentials,
  credentialsPath,
  readEnvCredentials,
  readStoredCredentials,
  writeStoredCredentials,
} from "./config.js";
import { errorMessage } from "./errors.js";
import { detectAgentRoots, installSkills, SKILL_NAME } from "./skills.js";

/**
 * `bitbucket setup` — connects the CLI to a Bitbucket account and installs the
 * agent skill into any detected agent root directory.
 */

export const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** The pull request diff redirects to the repository diff, hence the repository scope. */
export const REQUIRED_SCOPES = [
  "read:user:bitbucket",
  "read:pullrequest:bitbucket",
  "write:pullrequest:bitbucket",
  "read:repository:bitbucket",
];

export interface SetupOptions {
  /** Skip installing the agent skill. */
  skipSkills?: boolean;
  /** Skip the authentication step. */
  skipAuth?: boolean;
  /** Additional agent roots to install into. */
  dirs?: string[];
  /** Re-run authentication even if credentials already work. */
  reauth?: boolean;
  /** Credentials given on the command line; whatever is missing is asked for. */
  email?: string;
  token?: string;
  dryRun?: boolean;
}

export async function runSetup(options: SetupOptions = {}): Promise<number> {
  let failed = false;

  if (!options.skipAuth) {
    failed = !(await setupAuth(options));
  }

  if (!options.skipSkills) {
    if (!options.skipAuth) console.log("");
    setupSkills(options);
  }

  return failed ? 1 : 0;
}

async function setupAuth(options: SetupOptions): Promise<boolean> {
  console.log("Authentication");

  const replacing = options.reauth || options.email !== undefined || options.token !== undefined;

  if (!replacing) {
    const fromEnv = readEnvCredentials();
    if (fromEnv) {
      const user = await check(fromEnv);
      if (user) {
        console.log(
          `  ✔ Using BITBUCKET_EMAIL / BITBUCKET_API_TOKEN from the environment (${user}).`,
        );
        return true;
      }
      console.log(
        "  ⚠ BITBUCKET_EMAIL / BITBUCKET_API_TOKEN are set but were rejected by Bitbucket.",
      );
    }

    const stored = readStoredCredentials();
    if (stored) {
      const user = await check(stored);
      if (user) {
        console.log(`  ✔ Already authenticated as ${user}.`);
        console.log(`    Credentials: ${credentialsPath()} (re-run with --reauth to replace)`);
        return true;
      }
      console.log("  ⚠ Stored credentials were rejected by Bitbucket — let's set them up again.");
    }
  }

  const credentials = await askForCredentials(options);
  if (!credentials) return false;

  let user: string;
  try {
    user = await describeUser(credentials);
  } catch (error) {
    const rejected = error instanceof BitbucketApiError && error.status === 401;
    console.error(
      `  ✖ ${rejected ? "Bitbucket rejected the email or API token (401 Unauthorized)." : errorMessage(error)}`,
    );
    console.error(
      "    Nothing was saved. Check the email and token and run 'bitbucket setup' again.",
    );
    return false;
  }

  if (options.dryRun) {
    console.log(`  ✔ Verified as ${user}; skipped writing ${credentialsPath()} (--dry-run).`);
    return true;
  }

  const path = writeStoredCredentials(credentials);
  console.log(`  ✔ Authenticated as ${user}.`);
  console.log(`    Saved to ${path} (readable only by you).`);
  console.log("    A scope the token lacks shows up later as HTTP 403 naming it.");
  return true;
}

async function askForCredentials(options: SetupOptions): Promise<Credentials | null> {
  if (options.email !== undefined && options.token !== undefined) {
    return { email: options.email.trim(), token: options.token.trim() };
  }

  if (!process.stdin.isTTY) {
    console.error("  ✖ No working credentials found and this is not an interactive terminal.");
    console.error(
      "    Pass --email and --token, or set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN in the environment.",
    );
    return null;
  }

  // Node's readline has no line length limit, unlike the macOS `security` prompt,
  // which cuts input at 128 characters — shorter than an Atlassian API token.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    console.log(`  1. Create an API token with scopes at ${TOKEN_URL}`);
    console.log("     Choose the Bitbucket app and these scopes:");
    for (const scope of REQUIRED_SCOPES) {
      console.log(`       ${scope}`);
    }
    console.log("");
    console.log("  2. Enter the email of your Atlassian account and the token.");
    const email = (options.email ?? (await ask(rl, "     Atlassian account email: "))).trim();
    if (!email) {
      console.error("  ✖ No email entered.");
      return null;
    }
    const token = (options.token ?? (await ask(rl, "     API token: ", { mask: true }))).trim();
    if (!token) {
      console.error("  ✖ No token entered.");
      return null;
    }
    return { email, token };
  } finally {
    rl.close();
  }
}

function setupSkills(options: SetupOptions): void {
  console.log("Agent skills");

  const roots = detectAgentRoots(options.dirs ?? []);
  if (roots.length === 0) {
    console.log("  – No agent directories found (looked for ~/.claude and ~/.agents).");
    console.log("    Install somewhere specific with: bitbucket setup --dir <path>");
    return;
  }

  for (const installation of installSkills(roots, { dryRun: options.dryRun })) {
    const verb = {
      installed: "installed",
      updated: "updated",
      unchanged: "up to date",
    }[installation.status];
    const suffix = options.dryRun ? " (dry run)" : "";
    console.log(`  ✔ ${SKILL_NAME} ${verb} — ${installation.path}${suffix}`);
  }

  console.log("    Re-run 'bitbucket setup' after upgrading to refresh the skill.");
}

async function describeUser(credentials: Credentials): Promise<string> {
  const user = await new BitbucketClient(credentials).getCurrentUser();
  return `${user.display_name} (${user.nickname})`;
}

async function check(credentials: Credentials): Promise<string | null> {
  try {
    return await describeUser(credentials);
  } catch {
    return null;
  }
}

/** Reads a line; `mask` hides typing for secrets. */
function ask(rl: Interface, query: string, options: { mask?: boolean } = {}): Promise<string> {
  if (!options.mask) {
    return new Promise((resolve) => rl.question(query, resolve));
  }

  return new Promise((resolve) => {
    const stdout = process.stdout;
    const write = stdout.write.bind(stdout);
    let muted = false;

    (stdout as unknown as { write: typeof write }).write = ((chunk: unknown, ...rest: unknown[]) =>
      muted ? true : write(chunk as string, ...(rest as []))) as typeof write;

    rl.question(query, (answer) => {
      (stdout as unknown as { write: typeof write }).write = write;
      write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

export function setupHelp(): string {
  return [
    "bitbucket setup [options]",
    "",
    "Connect the CLI to a Bitbucket account and install the agent skill.",
    "",
    "Options:",
    "  --reauth               Replace existing credentials",
    "  --email <email>        Atlassian account email (asked for when missing)",
    "  --token <token>        API token (asked for, hidden, when missing)",
    "  --no-auth              Skip authentication",
    "  --no-agent-skills      Skip installing the agent skill",
    "  --dir <path>           Extra agent root to install the skill into",
    "  --dry-run              Report what would happen without writing anything",
    "",
    `Create the token at ${TOKEN_URL}`,
    `with the scopes ${REQUIRED_SCOPES.join(", ")}.`,
    "",
    `Credentials are stored in ${credentialsPath()}.`,
    "BITBUCKET_EMAIL / BITBUCKET_API_TOKEN (or a .env file) still take precedence.",
  ].join("\n");
}
