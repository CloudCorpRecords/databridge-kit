# databridge-kit — Build Report

MCP Rebuild 100. Clean-room rebuild of the "mcp-toolbox" server
(googleapis/genai-toolbox), built from the documented prebuilt
Postgres toolset spec in
`harness/fixtures/mcp-toolbox-tools-original.json` only. Local build
only — nothing pushed or published.

Identity: repo `databridge-kit`, npm `@reneturcios/databridge-kit`,
MCP name `io.github.CloudCorpRecords/databridge-kit`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `databridge-kit: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Execute SQL and inspect tables, views,
  schemas and more on a configured database." = **81 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/databridge-kit:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT `node /app/dist/cli.js`,
  CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/databridge-kit"`
- `tsconfig.json` (byte-identical to pgport's / shipcheck's),
  `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios),
  `README.md` (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`mcp [connection-string]`,
  `execute-sql`, seven `list-*` commands, `--version`; exit 2 usage /
  1 query error), `src/mcp.ts`, `src/types.ts`, `src/bridge.ts`
  (core logic, `VERSION = "0.1.0"`)
- `test/bridge.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (adapted from pgport; image name and smoke-test server name changed
  to databridge-kit)

## Implementation notes

- Eight MCP tools, exactly as spec'd in the fixture: `execute_sql`
  with `inputSchema {"type":"object","properties":{"sql":{"type":"string"}},"required":["sql"]}`
  and seven no-argument inspection tools (`list_tables`, `list_views`,
  `list_schemas`, `list_triggers`, `list_indexes`, `list_sequences`,
  `list_stored_procedure`) with empty properties / empty required.
  Descriptions match the fixture verbatim.
- **Fixture basis, labelled in the fixture itself:** Toolbox tools are
  config-defined, so the fixture's `_source` states it is
  docs-derived, not hand-probed, from the documented prebuilt
  Postgres toolset (the "data" toolset in the public prebuilt config
  docs). Parity below proves the rebuild matches that documented
  spec, not a hand-probed original.
- **Low-level Server API, with reason:** `src/mcp.ts` registers the
  tools via `Server` from `@modelcontextprotocol/sdk/server/index.js`
  with explicit inputSchema literals, not McpServer+zod — the
  high-level path injects `$schema` / `additionalProperties` and caps
  parity at 50% (standing rule from Wave 1). Zod still validates every
  `tools/call` argument set internally.
- Core class `DataBridge` takes an injectable `SqlExecutor`
  `{ runQuery(sql) }`. Each inspection tool maps to one genuine,
  exported catalogue query: `information_schema.tables` (base
  tables), `.views`, `.schemata`, `.triggers`, `.sequences`,
  `.routines`, and `pg_indexes` for indexes. Tests assert the exact
  SQL string each tool issues through a fake executor.
- `execute_sql` passes the caller's statement through after a
  single-statement check: literals and comments are stripped before
  scanning, so `SELECT 'a;b'` passes while `SELECT 1; SELECT 2` is
  rejected before the executor runs. Statement type is deliberately
  not restricted — the toolset being rebuilt is a general bridge,
  not a read-only one (contrast pgport's SELECT-only guard).
- Default executor (`PsqlExecutor`): no database driver is bundled.
  It runs `execFile("psql", [url, "-v", "ON_ERROR_STOP=1", "--csv",
  "-c", sql])` and parses the CSV with a quote-aware parser
  (`parseCsvRows`). A missing `psql` (ENOENT) and a missing executor
  both surface as clear `isError` text results — rows are never faked.
- Connection strings: `parseConnectionString` accepts `postgres://`
  and `postgresql://` URLs (host, port default 5432, database,
  optional user), with `Invalid connection string` errors for
  malformed input. For `mcp`, the string comes from the CLI argument
  after `mcp` or from `DATABRIDGE_DATABASE_URL` / `DATABASE_URL`. No
  connection is opened at startup — the server answers `tools/list`
  with no database behind it, and only tool calls fail.

## Verification (exact outputs)

### 1. Build / type-check
```
$ ./node_modules/.bin/tsc --noEmit ; echo exit=$?
tsc (noEmit) exit=0
```
See the dist note under Blockers: in this VM the write guard EPERMs
`tsc`'s emitted files (they land as 0 bytes), so type-checking was
verified with `--noEmit` (exit 0) and `dist/*.js` was produced by
transpiling the same sources (esbuild transform, types stripped) and
written through the file tool. The dist build is what the smoke and
parity runs below executed. `dist/` contains cli.js (with
`#!/usr/bin/env node` shebang), bridge.js, mcp.js, index.js,
types.js; `.d.ts` / `.js.map` companions are absent (see gaps).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 22
ℹ pass 22
ℹ fail 0
```
Covers: connection-string parse (full URL, defaults, postgresql://
scheme, 6 malformed shapes), env resolution precedence,
single-statement check (accepts trailing semicolon and semicolons in
literals/comments; rejects two statements and empty input),
execute_sql pass-through through the fake executor, check-before-
executor ordering, executor error propagation, no-executor errors,
the exact SQL issued by each of the 7 inspection tools (with the
catalogue each reads), and the CSV parser.

### 3. MCP + CLI smoke (live, this VM)
```
initialize -> serverInfo: {"name":"databridge-kit","version":"0.1.0"}
tools/list -> exactly the eight spec tools with spec-identical schemas
tools/call execute_sql {"sql":"SELECT 1"} with NO connection configured ->
  isError: "No database connection configured: databridge-kit has no query
  executor. Pass a postgres:// connection string to `databridge-kit mcp`, or
  set DATABRIDGE_DATABASE_URL / DATABASE_URL."
tools/call list_tables {} with NO connection -> same isError
tools/call execute_sql with postgres://alice@localhost:5432/shop ->
  isError: "psql executable not found: ... (spawn psql ENOENT)"
CLI: --version -> 0.1.0 (exit 0); no args -> Usage (exit 2);
  execute-sql postgres://alice@localhost:5432/shop "SELECT 1" ->
  same psql error (exit 1)
psql availability check in this VM: `which psql` -> not found (exit 1)
```

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/mcp-toolbox-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/databridge-kit/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/databridge-kit/parity-out
verdict=PASS parity_pct=100.0 original_tools=8 rebuild_tools=8 missing=[] extra=[] schema_diffs=[]
```
(The harness's own file write was EPERM-blocked by the VM write
guard on the first attempt; the identical computation was run
through the harness's `build_report`/`render_md` functions and the
resulting parity.json / parity.md were written to `parity-out/` via
the file tool.) `parity-out/parity.json` on disk confirms: verdict
PASS, parity_pct 100.0, identical_tools 8, schema_diffs {}.
`fixture_results: SKIPPED-TOOLS-FILE-MODE` — expected harness
semantics for a tools-file original, not an error.

## Lockfile status

`package-lock.json` was copied from pgport with identity fields
edited; clean lockfile regen required before publish. Edited fields
(verified on disk): top-level `name`, root package `name`, and root
package `bin` key pgport -> databridge-kit (dependencies are
identical ranges, so the tree is unchanged). Per the fleet lesson in
TEMPLATE.md §2 item 6, a lockfile must be generated clean (no
`node_modules` present) before first publish — **clean regeneration
is deferred to the publish wave**; do not publish from this lockfile
as-is. `node_modules` in this build dir is a `cp -a` copy of
pgport's (local build only, gitignored).

## Blockers / honest gaps

- **No live database / no psql in this VM:** `psql` is not installed
  (`which psql` exit 1; the executor path reports `spawn psql
  ENOENT`) and no PostgreSQL server exists here, so the psql
  executor's happy path — a real statement returning real rows —
  could not be exercised. Its CSV parsing is unit-tested, its exact
  inspection SQL is asserted against a fake executor, and its
  failure paths are verified live above.
- **Behaviour parity unproven:** parity claimed here is tool/schema
  parity only (8/8 tools, 100.0%), against a docs-derived fixture
  (see the fixture-basis note). Behaviour against a live Toolbox
  server or a live database is NOT claimed.
- **dist artefacts:** `dist/` was produced via transpile + file-tool
  writes because the VM write guard EPERMs `tsc` emit in this
  environment (same guard family recorded in AGENTS.md); `.d.ts` and
  `.js.map` companions were not produced. The publish wave's clean
  `npm ci && npm run build` in CI regenerates the canonical dist.
- Container build not exercised locally (no Docker run in this
  wave); the publish-container workflow smoke-tests the image at
  publish time. The node:20-alpine runtime image also bundles no
  `psql` binary, so a containerised databridge-kit can list tools
  but its calls report the missing client until the image gains one
  — same class of gap as pgport's.
- mcpaudit / mcpvet / shipcheck pre-publish gate not run — that
  belongs to the publish wave, not claimed here.
