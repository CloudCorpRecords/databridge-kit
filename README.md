# databridge-kit

databridge-kit is a small bridge between an agent (or a terminal) and
one configured PostgreSQL database. It can run a single SQL statement
and answer the seven inspection questions that come up constantly
while exploring an unfamiliar database: which tables, views, schemas,
triggers, indexes, sequences and stored procedures exist.

The toolset mirrors the documented prebuilt Postgres toolset of a
config-defined database toolbox: the tools are fixed, the database is
whatever the connection string points at. There is no bundled
database driver — statements run through the `psql` command-line
client, so a machine that wants live answers needs `psql` on its
`PATH`. Without it — or without a connection string — the server
still starts and lists its tools; only the calls themselves report
the problem.

## Install

```bash
npx @reneturcios/databridge-kit list-tables postgres://user@localhost:5432/mydb
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/databridge-kit
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
# Run one SQL statement; rows print as JSON
databridge-kit execute-sql postgres://alice@localhost/shop "SELECT id, name FROM products ORDER BY id"

# Inspection commands; each prints its rows as JSON
databridge-kit list-tables postgres://alice@localhost/shop
databridge-kit list-views postgres://alice@localhost/shop
databridge-kit list-schemas postgres://alice@localhost/shop
databridge-kit list-triggers postgres://alice@localhost/shop
databridge-kit list-indexes postgres://alice@localhost/shop
databridge-kit list-sequences postgres://alice@localhost/shop
databridge-kit list-stored-procedures postgres://alice@localhost/shop

# Start the MCP server (connection string optional, see below)
databridge-kit mcp postgres://alice@localhost/shop

databridge-kit --version
```

Exit codes: `0` on success, `1` when the statement, the connection
string, or `psql` itself fails (the error says which), `2` for usage
errors.

The connection string is a normal PostgreSQL URL: `postgres://` or
`postgresql://`, with host, optional port (default 5432), database
name from the path, and optional user and password in the userinfo.
For the `mcp` command the string can be left off the command line and
supplied through the `DATABRIDGE_DATABASE_URL` environment variable
instead (plain `DATABASE_URL` works too).

## How statements and inspections work

`execute_sql` accepts exactly one statement per call. Semicolons
inside string literals and comments do not count as statement
boundaries, but a second real statement is rejected before anything
reaches the database. The statement type is not restricted — this is
a general bridge, so a caller who can reach it can write as well as
read; point it only at databases where that is intended.

Each inspection tool runs one fixed catalogue query:

| Tool | Catalogue read |
| --- | --- |
| `list_tables` | `information_schema.tables` (base tables) |
| `list_views` | `information_schema.views` |
| `list_schemas` | `information_schema.schemata` |
| `list_triggers` | `information_schema.triggers` |
| `list_indexes` | `pg_indexes` |
| `list_sequences` | `information_schema.sequences` |
| `list_stored_procedure` | `information_schema.routines` |

Statements run as `psql -v ON_ERROR_STOP=1 --csv -c <sql>` and the CSV
output is parsed into row objects. Values come back as the strings
psql rendered.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/databridge-kit mcp postgres://alice@localhost/shop
```

MCP client configuration:

```json
{
  "mcpServers": {
    "databridge-kit": {
      "command": "npx",
      "args": ["-y", "@reneturcios/databridge-kit", "mcp"],
      "env": { "DATABRIDGE_DATABASE_URL": "postgres://alice@localhost/shop" }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `execute_sql` | `sql` (string, required) — one SQL statement | The result rows as a JSON array of objects keyed by column name. |
| `list_tables` | — | Rows describing the base tables in the configured source. |
| `list_views` | — | Rows describing the views in the configured source. |
| `list_schemas` | — | Rows describing the schemas in the configured source. |
| `list_triggers` | — | Rows describing the triggers in the configured source. |
| `list_indexes` | — | Rows describing the indexes in the configured source. |
| `list_sequences` | — | Rows describing the sequences in the configured source. |
| `list_stored_procedure` | — | Rows describing the stored procedures (routines) in the configured source. |

A missing connection, a missing `psql`, a multi-statement
`execute_sql`, and database errors all come back as tool errors —
never as made-up rows.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network, no live database
npm run dev     # run the CLI from source via tsx
```

The core logic sits behind an injectable executor interface, which is
what the test suite drives: connection-string parsing, the
single-statement check, pass-through execution, error propagation,
and the exact catalogue SQL behind every inspection tool are all
covered with a fake executor.

## License

MIT — see `LICENSE`.
