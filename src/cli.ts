#!/usr/bin/env node
/**
 * databridge-kit CLI.
 *
 *   databridge-kit mcp [connection-string]
 *   databridge-kit execute-sql <connection-string> <sql>
 *   databridge-kit list-tables <connection-string>
 *   databridge-kit list-views <connection-string>
 *   databridge-kit list-schemas <connection-string>
 *   databridge-kit list-triggers <connection-string>
 *   databridge-kit list-indexes <connection-string>
 *   databridge-kit list-sequences <connection-string>
 *   databridge-kit list-stored-procedures <connection-string>
 *   databridge-kit --version
 *
 * Exit codes: 0 success, 1 query/connection error, 2 usage error.
 * For `mcp`, the connection string may be omitted when
 * DATABRIDGE_DATABASE_URL or DATABASE_URL is set; the server still
 * starts and lists its tools without one, and only calls fail.
 */
import { DataBridge, PsqlExecutor, VERSION } from "./bridge.js";

function usage(): never {
  console.error(`Usage:
  databridge-kit mcp [connection-string]
  databridge-kit execute-sql <connection-string> <sql>
  databridge-kit list-tables <connection-string>
  databridge-kit list-views <connection-string>
  databridge-kit list-schemas <connection-string>
  databridge-kit list-triggers <connection-string>
  databridge-kit list-indexes <connection-string>
  databridge-kit list-sequences <connection-string>
  databridge-kit list-stored-procedures <connection-string>
  databridge-kit --version`);
  process.exit(2);
}

const LIST_COMMANDS: Record<string, (bridge: DataBridge) => Promise<Array<Record<string, unknown>>>> = {
  "list-tables": (b) => b.listTables(),
  "list-views": (b) => b.listViews(),
  "list-schemas": (b) => b.listSchemas(),
  "list-triggers": (b) => b.listTriggers(),
  "list-indexes": (b) => b.listIndexes(),
  "list-sequences": (b) => b.listSequences(),
  "list-stored-procedures": (b) => b.listStoredProcedures(),
};

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  try {
    if (cmd === "execute-sql") {
      const [connectionString, ...sqlParts] = rest;
      if (!connectionString || sqlParts.length === 0) usage();
      const bridge = new DataBridge(new PsqlExecutor(connectionString));
      const rows = await bridge.executeSql(sqlParts.join(" "));
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd in LIST_COMMANDS) {
      const [connectionString] = rest;
      if (!connectionString) usage();
      const bridge = new DataBridge(new PsqlExecutor(connectionString));
      const rows = await LIST_COMMANDS[cmd](bridge);
      console.log(JSON.stringify(rows, null, 2));
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
