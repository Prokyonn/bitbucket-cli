/** A mistake in how a command or tool was called; the CLI exits with 2 for these. */
export class UsageError extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
