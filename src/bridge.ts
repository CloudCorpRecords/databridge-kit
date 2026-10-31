/**
 * databridge-kit core: connection-string parsing, a single-statement
 * check, an executor-backed bridge class, a `psql` subprocess executor,
 * and the fixed inspection queries behind the list_* tools.
 *
 * Each inspection tool maps to one genuine PostgreSQL query against
 * information_schema or pg_catalog (pg_indexes): the tool name decides
 * which catalogue is read, the executor decides how the SQL reaches a
 * database. `execute_sql` passes the caller's statement through after
 * a single-statement check — databridge-kit deliberately does not
 * restrict statement type, because the toolset it rebuilds is a
 * general database bridge, not a read-only one.
 *
 * No database driver is bundled. The default executor runs the SQL
 * through the `psql` command-line client. When `psql` is missing or
 * no connection is configured, calls fail with a plain error that
 * says so — databridge-kit never invents rows.
 */
import { execFile } from "node:child_process";
import type { DbConnectionInfo, SqlExecutor } from "./types.js";

export const VERSION = "0.1.0";

export const NO_EXECUTOR_MESSAGE =
  "No database connection configured: databridge-kit has no SQL executor. " +
  "Pass a postgres:// connection string to `databridge-kit mcp`, or set " +
  "DATABRIDGE_DATABASE_URL / DATABASE_URL.";

// ---------------------------------------------------------------------------
// Inspection queries — one per list_* tool, exported so tests can assert
// the exact SQL each tool issues.
// ---------------------------------------------------------------------------

export const LIST_TABLES_SQL =
  "SELECT table_schema, table_name, table_type FROM information_schema.tables " +
  "WHERE table_type = 'BASE TABLE' ORDER BY table_schema, table_name";

export const LIST_VIEWS_SQL =
  "SELECT table_schema, table_name FROM information_schema.views " +
  "ORDER BY table_schema, table_name";

export const LIST_SCHEMAS_SQL =
  "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name";

export const LIST_TRIGGERS_SQL =
  "SELECT trigger_schema, event_object_table, trigger_name, event_manipulation, action_timing " +
  "FROM information_schema.triggers " +
  "ORDER BY trigger_schema, event_object_table, trigger_name";

export const LIST_INDEXES_SQL =
  "SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes " +
  "ORDER BY schemaname, tablename, indexname";

export const LIST_SEQUENCES_SQL =
  "SELECT sequence_schema, sequence_name FROM information_schema.sequences " +
  "ORDER BY sequence_schema, sequence_name";

export const LIST_STORED_PROCEDURES_SQL =
  "SELECT routine_schema, routine_name, routine_type FROM information_schema.routines " +
  "ORDER BY routine_schema, routine_name";

// ---------------------------------------------------------------------------
// Connection-string parsing
// ---------------------------------------------------------------------------

export function parseConnectionString(connectionString: string): DbConnectionInfo {
  const raw = typeof connectionString === "string" ? connectionString.trim() : "";
  if (!raw) {
    throw new Error("Invalid connection string: '' (expected a postgres:// or postgresql:// URL)");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid connection string: '${connectionString}' (could not be parsed as a URL)`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `Invalid connection string: '${connectionString}' (scheme must be postgres:// or postgresql://)`,
    );
  }
  const host = url.hostname;
  if (!host) {
    throw new Error(`Invalid connection string: '${connectionString}' (missing host)`);
  }
  let port = 5432;
  if (url.port) {
    port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid connection string: '${connectionString}' (invalid port '${url.port}')`);
    }
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error(`Invalid connection string: '${connectionString}' (missing database name)`);
  }
  const info: DbConnectionInfo = { host, port, database };
  if (url.username) info.user = decodeURIComponent(url.username);
  return info;
}

/** Explicit argument wins, then DATABRIDGE_DATABASE_URL, then DATABASE_URL. */
export function resolveConnectionString(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const fromBridge = env.DATABRIDGE_DATABASE_URL?.trim();
  if (fromBridge) return fromBridge;
  const fromGeneric = env.DATABASE_URL?.trim();
  if (fromGeneric) return fromGeneric;
  return undefined;
}

// ---------------------------------------------------------------------------
// Single-statement check
//
// String literals and comments are blanked out first, so a semicolon
// that lives inside a literal ('a;b') or a comment never looks like a
// statement boundary. After that, a semicolon followed by anything
// other than whitespace means a second statement, which is rejected:
// the executor runs exactly one statement per call.
// ---------------------------------------------------------------------------

export function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] ?? "";
    if (ch === "'") {
      out += "''";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function assertSingleStatement(sql: string): void {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error("SQL statement is empty: one SQL statement is required");
  }
  const stripped = stripLiteralsAndComments(sql);
  if (!stripped.trim()) {
    throw new Error("SQL statement is empty: one SQL statement is required");
  }
  const semi = stripped.indexOf(";");
  if (semi !== -1 && stripped.slice(semi + 1).trim().length > 0) {
    throw new Error("Multiple SQL statements are not allowed: submit one statement per call");
  }
}

// ---------------------------------------------------------------------------
// CSV parsing for psql --csv output
// ---------------------------------------------------------------------------

/**
 * Parse CSV text (header row plus data rows) into row objects keyed by
 * the header names. Handles quoted fields, embedded commas, doubled
 * quotes, and embedded newlines inside quotes — the shapes `psql --csv`
 * actually produces. All values stay strings, as psql renders them.
 */
export function parseCsvRows(text: string): Array<Record<string, unknown>> {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  const pushField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\n") {
      pushRow();
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
    fieldStarted = true;
  }
  if (fieldStarted || field.length > 0 || row.length > 0) pushRow();
  while (
    records.length > 0 &&
    records[records.length - 1].length === 1 &&
    records[records.length - 1][0] === ""
  ) {
    records.pop();
  }
  if (records.length === 0) return [];
  const headers = records[0];
  return records.slice(1).map((cells) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? "";
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// psql executor
// ---------------------------------------------------------------------------

/**
 * Default executor: runs one statement through the `psql` binary and
 * parses its `--csv` output into rows. Unlike a read-only bridge, the
 * statement is passed to psql as given — execute_sql is a general
 * statement tool, and the single-statement check in the core class is
 * the only gate applied before this point.
 */
export class PsqlExecutor implements SqlExecutor {
  constructor(private readonly connectionString: string) {
    // Validate eagerly so a malformed string fails at wiring time,
    // but never open a connection here — the server must start and
    // answer tools/list with no live database behind it.
    parseConnectionString(connectionString);
  }

  async runQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "psql",
        [this.connectionString, "-v", "ON_ERROR_STOP=1", "--csv", "-c", sql],
        { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
        (err, out, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              reject(
                new Error(
                  "psql executable not found: the `psql` command-line client is not installed " +
                    "or not on PATH, so databridge-kit cannot run the query. Install PostgreSQL " +
                    "client tools and retry. (spawn psql ENOENT)",
                ),
              );
              return;
            }
            const detail = (stderr || "").trim() || err.message;
            reject(new Error(`psql query failed: ${detail}`));
            return;
          }
          resolve(out);
        },
      );
    });
    if (!stdout.trim()) return [];
    return parseCsvRows(stdout);
  }
}

export function createPsqlExecutor(connectionString: string): SqlExecutor {
  return new PsqlExecutor(connectionString);
}

// ---------------------------------------------------------------------------
// Core class
// ---------------------------------------------------------------------------

export class DataBridge {
  constructor(private readonly executor?: SqlExecutor | null) {}

  private async run(sql: string): Promise<Array<Record<string, unknown>>> {
    if (!this.executor) {
      throw new Error(NO_EXECUTOR_MESSAGE);
    }
    return this.executor.runQuery(sql);
  }

  /** Execute one caller-supplied statement, after the single-statement check. */
  async executeSql(sql: string): Promise<Array<Record<string, unknown>>> {
    assertSingleStatement(sql);
    return this.run(sql);
  }

  async listTables(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_TABLES_SQL);
  }

  async listViews(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_VIEWS_SQL);
  }

  async listSchemas(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_SCHEMAS_SQL);
  }

  async listTriggers(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_TRIGGERS_SQL);
  }

  async listIndexes(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_INDEXES_SQL);
  }

  async listSequences(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_SEQUENCES_SQL);
  }

  async listStoredProcedures(): Promise<Array<Record<string, unknown>>> {
    return this.run(LIST_STORED_PROCEDURES_SQL);
  }
}

/**
 * Wire a DataBridge from an optional connection string: a configured
 * string yields the psql executor; no string yields a bridge whose
 * calls fail with NO_EXECUTOR_MESSAGE while tools/list still works.
 */
export function createDataBridge(connectionString?: string): DataBridge {
  const resolved = resolveConnectionString(connectionString);
  if (!resolved) return new DataBridge(null);
  return new DataBridge(createPsqlExecutor(resolved));
}
