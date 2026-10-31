import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertSingleStatement,
  DataBridge,
  LIST_INDEXES_SQL,
  LIST_SCHEMAS_SQL,
  LIST_SEQUENCES_SQL,
  LIST_STORED_PROCEDURES_SQL,
  LIST_TABLES_SQL,
  LIST_TRIGGERS_SQL,
  LIST_VIEWS_SQL,
  parseConnectionString,
  parseCsvRows,
  resolveConnectionString,
} from "../src/bridge.js";
import type { SqlExecutor } from "../src/types.js";

function fakeExecutor(rows: Array<Record<string, unknown>>): SqlExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async runQuery(sql: string) {
      calls.push(sql);
      return rows;
    },
  };
}

describe("parseConnectionString", () => {
  it("parses a full postgres:// URL", () => {
    const info = parseConnectionString("postgres://alice:s3cret@db.example.com:6543/shop");
    assert.equal(info.host, "db.example.com");
    assert.equal(info.port, 6543);
    assert.equal(info.database, "shop");
    assert.equal(info.user, "alice");
  });

  it("applies defaults: port 5432 and no user", () => {
    const info = parseConnectionString("postgres://localhost/mydb");
    assert.equal(info.host, "localhost");
    assert.equal(info.port, 5432);
    assert.equal(info.database, "mydb");
    assert.equal(info.user, undefined);
  });

  it("accepts the postgresql:// scheme", () => {
    const info = parseConnectionString("postgresql://bob@db.internal:5433/analytics");
    assert.equal(info.host, "db.internal");
    assert.equal(info.database, "analytics");
    assert.equal(info.user, "bob");
  });

  it("rejects malformed connection strings", () => {
    for (const bad of [
      "",
      "not a url",
      "http://localhost/mydb",
      "postgres://",
      "postgres://localhost",
      "postgres://localhost/",
    ]) {
      assert.throws(() => parseConnectionString(bad), /Invalid connection string/, bad);
    }
  });
});

describe("resolveConnectionString", () => {
  it("prefers the explicit argument, then DATABRIDGE_DATABASE_URL, then DATABASE_URL", () => {
    const env = {
      DATABRIDGE_DATABASE_URL: "postgres://h/bridge",
      DATABASE_URL: "postgres://h/generic",
    } as NodeJS.ProcessEnv;
    assert.equal(resolveConnectionString("postgres://h/explicit", env), "postgres://h/explicit");
    assert.equal(resolveConnectionString(undefined, env), "postgres://h/bridge");
    assert.equal(
      resolveConnectionString(undefined, { DATABASE_URL: "postgres://h/generic" } as NodeJS.ProcessEnv),
      "postgres://h/generic",
    );
    assert.equal(resolveConnectionString(undefined, {} as NodeJS.ProcessEnv), undefined);
  });
});

describe("assertSingleStatement", () => {
  it("accepts one statement, with or without a trailing semicolon", () => {
    assert.doesNotThrow(() => assertSingleStatement("SELECT 1"));
    assert.doesNotThrow(() => assertSingleStatement("SELECT 1;"));
    assert.doesNotThrow(() => assertSingleStatement("INSERT INTO t VALUES (1);  \n"));
  });

  it("accepts semicolons inside string literals and comments", () => {
    assert.doesNotThrow(() => assertSingleStatement("SELECT 'a;b'"));
    assert.doesNotThrow(() => assertSingleStatement("SELECT 'it''s; fine'"));
    assert.doesNotThrow(() => assertSingleStatement("-- note; here\nSELECT 1"));
  });

  it("rejects two statements", () => {
    assert.throws(() => assertSingleStatement("SELECT 1; SELECT 2"), /Multiple SQL statements/);
    assert.throws(() => assertSingleStatement("SELECT 1; DROP TABLE t"), /Multiple SQL statements/);
  });

  it("rejects empty input", () => {
    assert.throws(() => assertSingleStatement(""), /empty/);
    assert.throws(() => assertSingleStatement("   "), /empty/);
    assert.throws(() => assertSingleStatement("-- only a comment"), /empty/);
  });
});

describe("DataBridge.executeSql", () => {
  it("passes the statement through the fake executor unchanged", async () => {
    const rows = [{ n: "1" }];
    const executor = fakeExecutor(rows);
    const bridge = new DataBridge(executor);
    const out = await bridge.executeSql("SELECT count(*) AS n FROM orders");
    assert.deepEqual(out, rows);
    assert.deepEqual(executor.calls, ["SELECT count(*) AS n FROM orders"]);
  });

  it("checks single-statement before the executor is ever called", async () => {
    const executor = fakeExecutor([]);
    const bridge = new DataBridge(executor);
    await assert.rejects(() => bridge.executeSql("SELECT 1; SELECT 2"), /Multiple SQL statements/);
    assert.deepEqual(executor.calls, []);
  });

  it("propagates executor errors", async () => {
    const failing: SqlExecutor = {
      async runQuery() {
        throw new Error("connection to server failed: Connection refused");
      },
    };
    const bridge = new DataBridge(failing);
    await assert.rejects(() => bridge.executeSql("SELECT 1"), /Connection refused/);
  });

  it("errors clearly when no executor is configured", async () => {
    const bridge = new DataBridge();
    await assert.rejects(() => bridge.executeSql("SELECT 1"), /No database connection configured/);
    await assert.rejects(() => bridge.listTables(), /No database connection configured/);
  });
});

describe("inspection tools issue their exact catalogue SQL", () => {
  const cases: Array<{
    name: string;
    run: (b: DataBridge) => Promise<Array<Record<string, unknown>>>;
    sql: string;
    catalogue: RegExp;
  }> = [
    { name: "listTables", run: (b) => b.listTables(), sql: LIST_TABLES_SQL, catalogue: /information_schema\.tables/ },
    { name: "listViews", run: (b) => b.listViews(), sql: LIST_VIEWS_SQL, catalogue: /information_schema\.views/ },
    { name: "listSchemas", run: (b) => b.listSchemas(), sql: LIST_SCHEMAS_SQL, catalogue: /information_schema\.schemata/ },
    { name: "listTriggers", run: (b) => b.listTriggers(), sql: LIST_TRIGGERS_SQL, catalogue: /information_schema\.triggers/ },
    { name: "listIndexes", run: (b) => b.listIndexes(), sql: LIST_INDEXES_SQL, catalogue: /pg_indexes/ },
    { name: "listSequences", run: (b) => b.listSequences(), sql: LIST_SEQUENCES_SQL, catalogue: /information_schema\.sequences/ },
    {
      name: "listStoredProcedures",
      run: (b) => b.listStoredProcedures(),
      sql: LIST_STORED_PROCEDURES_SQL,
      catalogue: /information_schema\.routines/,
    },
  ];

  for (const c of cases) {
    it(`${c.name} issues exactly its exported SQL constant`, async () => {
      const rows = [{ probe: "row" }];
      const executor = fakeExecutor(rows);
      const bridge = new DataBridge(executor);
      const out = await c.run(bridge);
      assert.deepEqual(out, rows);
      assert.deepEqual(executor.calls, [c.sql]);
      assert.match(c.sql, c.catalogue);
      assert.match(c.sql, /^SELECT /);
    });
  }
});

describe("parseCsvRows", () => {
  it("parses psql-style CSV into row objects", () => {
    const rows = parseCsvRows('id,name,note\n1,Ada,"hello, world"\n2,Grace,"said ""hi"""\n');
    assert.deepEqual(rows, [
      { id: "1", name: "Ada", note: "hello, world" },
      { id: "2", name: "Grace", note: 'said "hi"' },
    ]);
  });

  it("returns no rows for header-only or empty output", () => {
    assert.deepEqual(parseCsvRows("id,name\n"), []);
    assert.deepEqual(parseCsvRows(""), []);
  });
});
