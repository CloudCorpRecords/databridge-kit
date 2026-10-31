/**
 * databridge-kit MCP server. Tools: execute_sql, list_tables,
 * list_views, list_schemas, list_triggers, list_indexes,
 * list_sequences, list_stored_procedure.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects two keys that are
 * not in this toolset's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema parity
 * with the spec. This file therefore serves tools/list with the
 * spec's exact input schemas, while zod still validates every
 * tools/call argument set.
 *
 * The connection string comes from the argument after `mcp`
 * (`databridge-kit mcp postgres://...`) or from
 * DATABRIDGE_DATABASE_URL / DATABASE_URL. No database connection is
 * opened at startup: the server answers tools/list with nothing
 * behind it, and only a tools/call touches the executor — which is
 * where a missing connection or a missing `psql` binary surfaces as
 * an isError result instead of invented rows.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createDataBridge, VERSION } from "./bridge.js";

const ExecuteSqlArgs = z.object({
  sql: z.string(),
});

const NoArgs = z.object({});

const EMPTY_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [] as string[],
};

const TOOLS = [
  {
    name: "execute_sql",
    description: "Execute a SQL statement against the configured database source",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "The SQL statement to execute against the configured database source.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "list_tables",
    description: "List tables in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "list_views",
    description: "List views in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "list_schemas",
    description: "List schemas in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "list_triggers",
    description: "List triggers in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "list_indexes",
    description: "List indexes in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "list_sequences",
    description: "List sequences in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "list_stored_procedure",
    description: "List stored procedures in the configured database source",
    inputSchema: EMPTY_SCHEMA,
  },
];

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

// argv looks like: [node, cli.js, "mcp", maybe-connection-string].
const argv = process.argv.slice(2);
const mcpIndex = argv.indexOf("mcp");
const explicit = mcpIndex >= 0 ? argv[mcpIndex + 1] : undefined;
const bridge = createDataBridge(explicit);

const server = new Server(
  { name: "databridge-kit", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "execute_sql": {
        const parsed = ExecuteSqlArgs.parse(args ?? {});
        return textResult(await bridge.executeSql(parsed.sql));
      }
      case "list_tables":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listTables());
      case "list_views":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listViews());
      case "list_schemas":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listSchemas());
      case "list_triggers":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listTriggers());
      case "list_indexes":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listIndexes());
      case "list_sequences":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listSequences());
      case "list_stored_procedure":
        NoArgs.parse(args ?? {});
        return textResult(await bridge.listStoredProcedures());
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
