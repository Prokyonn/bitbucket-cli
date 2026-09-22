// npm has no "postupdate" hook — but postinstall re-runs on `npm install -g
// <pkg>@latest` and on `npm update -g <pkg>`, so this covers upgrades too.
//
// Kept as a plain script (not build output) so a fresh clone can `npm install`
// before anything has been compiled. All of the actual work, including the
// opt-out checks, lives in build/install-skills.js.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const entry = resolve(root, "build/install-skills.js");
  if (existsSync(entry)) {
    await import(pathToFileURL(entry).href);
  }
} catch {
  // An optional convenience must never fail an install.
}
