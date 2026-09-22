import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

/**
 * Credentials: BITBUCKET_EMAIL and BITBUCKET_API_TOKEN from the environment (or a
 * `.env` file in the working directory) win; the file written by `bitbucket setup`
 * is the fallback, so the CLI works from any directory once set up.
 */

export interface Credentials {
  /** The Atlassian account email, the Basic auth username for API tokens. */
  email: string;
  token: string;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "bitbucket-cli") : join(homedir(), ".config", "bitbucket-cli");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export function loadCredentials(): Credentials | null {
  return readEnvCredentials() ?? readStoredCredentials();
}

/** Variables already set in the environment keep their value over the `.env` file. */
export function readEnvCredentials(): Credentials | null {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const email = process.env.BITBUCKET_EMAIL;
  const token = process.env.BITBUCKET_API_TOKEN;
  return email && token ? { email, token } : null;
}

export function readStoredCredentials(): Credentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed?.email === "string" && typeof parsed?.token === "string") {
      return { email: parsed.email, token: parsed.token };
    }
  } catch {
    // A corrupt file behaves like no file at all; `bitbucket setup` rewrites it.
  }
  return null;
}

export function writeStoredCredentials(credentials: Credentials): string {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  // Tighten permissions even when the file already existed with looser ones.
  chmodSync(path, 0o600);
  return path;
}
