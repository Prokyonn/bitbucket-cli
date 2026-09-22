import { UsageError } from "./errors.js";

/** Argument checks shared by the client and the request bodies it builds. */

/** Accepts numbers and digit strings alike, since script placeholders resolve to strings. */
export function positiveInteger(value: unknown, name: string): number {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new UsageError(`'${name}' must be a positive whole number (got '${String(value)}').`);
  }
  return Number(value);
}

export function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UsageError(`'${name}' must not be empty.`);
  }
  return value;
}

/** Encodes a value for one path segment, refusing anything that would leave the path. */
export function segment(value: unknown, name: string): string {
  return encodeURIComponent(requireText(value, name));
}

/** Encodes a file path, keeping its slashes as separators. */
export function pathSegments(value: unknown, name: string): string {
  return requireText(value, name)
    .split("/")
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join("/");
}
