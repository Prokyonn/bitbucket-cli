import { BitbucketClient } from "../bitbucket-client.js";

/** The shape every tool is described in — the one an MCP server would expose. */

export interface JsonSchemaProperty {
  type?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  description?: string;
  /** Array options given as one comma-separated value rather than a repeated flag. */
  commaSeparated?: boolean;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  /** Arguments that may be passed positionally, in this order. Defaults to `required`. */
  positional?: string[];
}

export interface ToolDefinition<TArgs = Record<string, any>> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  run: (client: BitbucketClient, args: TArgs) => Promise<unknown>;
}

export function defineTool<TArgs>(definition: ToolDefinition<TArgs>): ToolDefinition {
  return definition as ToolDefinition;
}
