# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `databridge-kit execute-sql <connection-string> <sql>` runs one
  SQL statement and prints rows as JSON; the seven `list-*` commands
  run the matching inspection query; `databridge-kit mcp
  [connection-string]` starts the stdio MCP server. Connection
  strings can also come from `DATABRIDGE_DATABASE_URL` or
  `DATABASE_URL`.
- MCP server with eight tools: `execute_sql` (required `sql` string)
  and the no-argument inspection tools `list_tables`, `list_views`,
  `list_schemas`, `list_triggers`, `list_indexes`, `list_sequences`,
  `list_stored_procedure`.
- `execute_sql` enforces a single statement per call (semicolons in
  string literals and comments are not statement boundaries) and
  otherwise passes the statement through unchanged.
- Inspection tools run fixed catalogue queries against
  `information_schema` (`tables`, `views`, `schemata`, `triggers`,
  `sequences`, `routines`) and `pg_indexes`.
- Statements run through the `psql` subprocess with `--csv` output
  parsed into row objects; no database driver is bundled.
