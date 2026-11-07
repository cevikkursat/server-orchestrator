import pg from "pg";
import mysql from "mysql2";
import type {
  ExplorerTree,
  SqlCell,
  SqlColumn,
  SqlFilter,
  SqlQueryResult,
  SqlRowsRequest,
  SqlRowsResult,
  SqlStatementResult,
} from "@panel/shared";
import { HttpError } from "../../lib/errors.js";

/**
 * PostgreSQL ve MariaDB için ortak tablo gezgini.
 * Güvenlik: tablo/sütun adları sorguya ancak veritabanının kendi kataloğunda bulunduktan sonra
 * (tırnaklanarak) girer; kullanıcının verdiği her değer parametre olarak gider.
 * Bütün değerler veritabanının metin gösterimiyle taşınır (tarih, sayı, JSON… kayıpsız gidip gelir).
 */

export interface SqlTarget {
  engine: "postgres" | "mysql" | "mariadb";
  host: string;
  password: string;
}

const STATEMENT_TIMEOUT_S = 15;
/** Listede bir hücrenin en fazla gösterilen uzunluğu */
const CELL_PREVIEW = 1000;
/** Konsolda bir sorgudan dönen en fazla satır */
const CONSOLE_MAX_ROWS = 1000;

interface Runner {
  q(id: string): string;
  ph(i: number): string;
  textOf(expr: string): string;
  like: string;
  run(sql: string, params?: unknown[]): Promise<{ rows: SqlCell[][]; rowCount: number }>;
  columns(schema: string, table: string): Promise<{ cols: SqlColumn[]; kind: "table" | "view" } | null>;
  tree(): Promise<ExplorerTree["groups"]>;
  end(): Promise<void>;
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------
const rawText = () => (v: string) => v;

function pgClient(t: SqlTarget, readOnly = false, streaming = false) {
  const c = new pg.Client({
    host: t.host,
    port: 5432,
    user: "app",
    password: t.password,
    database: "app",
    connectionTimeoutMillis: 5000,
    statement_timeout: STATEMENT_TIMEOUT_S * 1000,
    // Konsolda istemci taraflı zaman aşımı kullanılmaz: pg o durumda sorguya kendi geri çağırmasını
    // ekliyor, 'error' olayı gelmiyor ve satırlar bellekte birikiyor. Sunucu taraflı sınır yeterli.
    ...(streaming ? {} : { query_timeout: (STATEMENT_TIMEOUT_S + 5) * 1000 }),
    application_name: "sunucu-paneli",
    // Her tür metin olarak gelsin (int8/numeric/timestamp/bytea… kayıpsız)
    types: { getTypeParser: rawText as never },
    ...(readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
  });
  // Bağlantı koparsa istemci 'error' yayar; dinleyicisiz kalırsa bütün panel düşer
  c.on("error", () => {});
  return c;
}

async function pgRunner(t: SqlTarget): Promise<Runner> {
  const c = pgClient(t);
  await c.connect();
  const run: Runner["run"] = async (sql, params = []) => {
    const r = await c.query({ text: sql, values: params, rowMode: "array" });
    return { rows: r.rows as SqlCell[][], rowCount: r.rowCount ?? 0 };
  };
  return {
    q: (id) => `"${id.replace(/"/g, '""')}"`,
    ph: (i) => `$${i}`,
    textOf: (e) => `CAST(${e} AS text)`,
    like: "ILIKE",
    run,
    async tree() {
      const r = await run(
        `SELECT n.nspname, c.relname, c.relkind, c.reltuples::bigint
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
            AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
          ORDER BY 1, 2`,
      );
      return group(r.rows.map(([s, n, k, cnt]) => ({ group: s!, name: n!, kind: k === "v" || k === "m" ? "view" : "table", count: estimate(cnt) })));
    },
    async columns(schema, table) {
      const k = await run(
        `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r','p','v','m')`,
        [schema, table],
      );
      if (!k.rows.length) return null;
      const r = await run(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
                (a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '')::text,
                COALESCE(a.attnum = ANY(i.indkey::int2[]), false)::text, (a.attgenerated <> '')::text
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
          WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [schema, table],
      );
      const kind = k.rows[0]![0] === "v" || k.rows[0]![0] === "m" ? "view" : "table";
      return {
        kind,
        cols: r.rows.map(([name, type, nullable, def, pk, generated]) => ({
          name: name!,
          type: type!,
          nullable: nullable === "true",
          hasDefault: def === "true",
          pk: pk === "true",
          editable: generated !== "true",
        })),
      };
    },
    end: () => c.end().catch(() => {}),
  };
}

// ---------------------------------------------------------------------------
// MariaDB
// ---------------------------------------------------------------------------
/** Sürücünün döndürdüğü değeri metne çevirir; ikili veriler 0x… onaltılık gösterimle */
function myCell(v: unknown): SqlCell {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function myConn(t: SqlTarget, multipleStatements = false) {
  const c = mysql.createConnection({
    host: t.host,
    port: 3306,
    user: "app",
    password: t.password,
    database: "app",
    connectTimeout: 5000,
    multipleStatements,
    // Tarih, büyük sayı, ondalık ve JSON metin olarak gelsin (kayıpsız)
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    dateStrings: true,
    jsonStrings: true,
  });
  c.on("error", () => {});
  return c;
}

async function myOpen(t: SqlTarget, opts: { multi?: boolean; readOnly?: boolean } = {}) {
  const c = myConn(t, opts.multi);
  const p = c.promise();
  await p.connect();
  // MariaDB: saniye, tüm ifadeler · MySQL: milisaniye, SELECT'ler (yazmalar kilit beklemesiyle sınırlı)
  await p.query(t.engine === "mysql" ? `SET SESSION max_execution_time = ${STATEMENT_TIMEOUT_S * 1000}` : `SET SESSION max_statement_time = ${STATEMENT_TIMEOUT_S}`);
  if (t.engine === "mysql") await p.query(`SET SESSION innodb_lock_wait_timeout = ${STATEMENT_TIMEOUT_S}`);
  if (opts.readOnly) await p.query("SET SESSION TRANSACTION READ ONLY");
  return { c, p };
}

async function myRunner(t: SqlTarget): Promise<Runner> {
  const { p } = await myOpen(t);
  const run: Runner["run"] = async (sql, params = []) => {
    const [res] = await p.query({ sql, values: params, rowsAsArray: true });
    if (Array.isArray(res)) return { rows: (res as unknown[][]).map((row) => row.map(myCell)), rowCount: res.length };
    return { rows: [], rowCount: (res as { affectedRows: number }).affectedRows };
  };
  const SYSTEM = "('information_schema','mysql','performance_schema','sys')";
  return {
    q: (id) => `\`${id.replace(/`/g, "``")}\``,
    ph: () => "?",
    textOf: (e) => `CAST(${e} AS CHAR)`,
    like: "LIKE",
    run,
    async tree() {
      const r = await run(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, CAST(TABLE_ROWS AS CHAR) FROM information_schema.TABLES
          WHERE TABLE_SCHEMA NOT IN ${SYSTEM} ORDER BY 1, 2`,
      );
      return group(r.rows.map(([s, n, k, cnt]) => ({ group: s!, name: n!, kind: k === "VIEW" ? "view" : "table", count: estimate(cnt) })));
    },
    async columns(schema, table) {
      const k = await run(`SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_SCHEMA NOT IN ${SYSTEM}`, [
        schema,
        table,
      ]);
      if (!k.rows.length) return null;
      const r = await run(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, DATA_TYPE
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema, table],
      );
      return {
        kind: k.rows[0]![0] === "VIEW" ? "view" : "table",
        cols: r.rows.map(([name, type, nullable, def, key, extra, dataType]) => ({
          name: name!,
          type: type!,
          nullable: nullable === "YES",
          hasDefault: def != null || /auto_increment|generated/i.test(extra ?? ""),
          pk: key === "PRI",
          // Üretilen sütunlar ve ikili veri (0x… olarak gösterilir) düzenlenemez
          editable: !/generated/i.test(extra ?? "") && !/^(tinyblob|blob|mediumblob|longblob|binary|varbinary|bit|geometry)$/i.test(dataType ?? ""),
        })),
      };
    },
    end: () => p.end().catch(() => {}),
  };
}

// ---------------------------------------------------------------------------
// Ortak
// ---------------------------------------------------------------------------
function estimate(v: SqlCell | undefined) {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function group(items: { group: string; name: string; kind: "table" | "view"; count: number | null }[]): ExplorerTree["groups"] {
  const m = new Map<string, ExplorerTree["groups"][number]>();
  for (const i of items) {
    if (!m.has(i.group)) m.set(i.group, { name: i.group, items: [] });
    m.get(i.group)!.items.push({ name: i.name, kind: i.kind, count: i.count });
  }
  return [...m.values()];
}

async function withRunner<T>(t: SqlTarget, fn: (r: Runner) => Promise<T>): Promise<T> {
  let r: Runner;
  try {
    r = t.engine === "postgres" ? await pgRunner(t) : await myRunner(t);
  } catch (err) {
    throw new HttpError(502, "errors:explorer.connectFailed", { error: (err as Error).message });
  }
  try {
    return await fn(r);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, (err as Error).message);
  } finally {
    await r.end();
  }
}

async function requireTable(r: Runner, schema: string, table: string) {
  const meta = await r.columns(schema, table);
  if (!meta) throw new HttpError(404, "errors:explorer.tableNotFound", { table: `${schema}.${table}` });
  return meta;
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);

function whereClause(r: Runner, cols: SqlColumn[], filters: SqlFilter[], params: unknown[]) {
  const parts: string[] = [];
  for (const f of filters) {
    const col = cols.find((c) => c.name === f.column);
    if (!col) throw new HttpError(400, "errors:explorer.columnMissing", { column: f.column });
    const c = r.q(col.name);
    const p = () => (params.push(f.op === "contains" ? `%${escapeLike(f.value)}%` : f.value), r.ph(params.length));
    if (f.op === "null") parts.push(`${c} IS NULL`);
    else if (f.op === "notnull") parts.push(`${c} IS NOT NULL`);
    else if (f.op === "contains") parts.push(`${r.textOf(c)} ${r.like} ${p()}`);
    else parts.push(`${c} ${{ eq: "=", neq: "<>", gt: ">", lt: "<" }[f.op]} ${p()}`);
  }
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

/** Anahtar sütunlarıyla tek satırı seçen koşul. Anahtar tam olarak birincil anahtar olmalı. */
function keyClause(r: Runner, cols: SqlColumn[], key: Record<string, SqlCell>, params: unknown[]) {
  const pk = cols.filter((c) => c.pk);
  if (!pk.length) throw new HttpError(400, "errors:explorer.noPrimaryKey");
  const names = Object.keys(key);
  if (names.length !== pk.length || !pk.every((c) => names.includes(c.name))) throw new HttpError(400, "errors:explorer.rowKeyInvalid");
  return pk
    .map((c) => {
      if (key[c.name] == null) throw new HttpError(400, "errors:explorer.primaryKeyEmpty");
      params.push(key[c.name]);
      return `${r.q(c.name)} = ${r.ph(params.length)}`;
    })
    .join(" AND ");
}

function checkValues(cols: SqlColumn[], values: Record<string, SqlCell>) {
  for (const name of Object.keys(values)) {
    const c = cols.find((x) => x.name === name);
    if (!c) throw new HttpError(400, "errors:explorer.columnMissing", { column: name });
    if (!c.editable) throw new HttpError(400, "errors:explorer.columnReadOnly", { column: name });
  }
}

// ---------------------------------------------------------------------------
// Dışa açık işlemler
// ---------------------------------------------------------------------------
export const sqlTree = (t: SqlTarget) => withRunner(t, (r) => r.tree());

export function sqlRows(t: SqlTarget, req: SqlRowsRequest): Promise<SqlRowsResult> {
  return withRunner(t, async (r) => {
    const { cols, kind } = await requireTable(r, req.schema, req.table);
    const from = `${r.q(req.schema)}.${r.q(req.table)}`;
    const params: unknown[] = [];
    const where = whereClause(r, cols, req.filters, params);
    let order = "";
    if (req.sort) {
      if (!cols.some((c) => c.name === req.sort!.column)) throw new HttpError(400, "errors:explorer.columnMissing", { column: req.sort.column });
      order = ` ORDER BY ${r.q(req.sort.column)} ${req.sort.dir === "desc" ? "DESC" : "ASC"}`;
    } else if (cols.some((c) => c.pk)) {
      order = ` ORDER BY ${cols
        .filter((c) => c.pk)
        .map((c) => r.q(c.name))
        .join(", ")}`;
    }
    const list = cols.map((c) => r.q(c.name)).join(", ");
    const res = await r.run(`SELECT ${list} FROM ${from}${where}${order} LIMIT ${req.pageSize} OFFSET ${req.page * req.pageSize}`, params);
    let truncated = false;
    const rows = res.rows.map((row) =>
      row.map((v) => {
        if (typeof v === "string" && v.length > CELL_PREVIEW) {
          truncated = true;
          return v.slice(0, CELL_PREVIEW);
        }
        return v;
      }),
    );
    let total: number | null = null;
    try {
      const c = await r.run(`SELECT COUNT(*) FROM ${from}${where}`, params);
      total = Number(c.rows[0]?.[0] ?? 0);
    } catch {
      total = null; // çok büyük tabloda zaman aşımı: sayfalama yine çalışır
    }
    return { columns: cols, rows, truncated, total, editable: kind === "table" && cols.some((c) => c.pk), kind };
  });
}

/** Tek satırın tam (kısaltılmamış) değerleri */
export function sqlRow(t: SqlTarget, schema: string, table: string, key: Record<string, SqlCell>) {
  return withRunner(t, async (r) => {
    const { cols } = await requireTable(r, schema, table);
    const params: unknown[] = [];
    const res = await r.run(
      `SELECT ${cols.map((c) => r.q(c.name)).join(", ")} FROM ${r.q(schema)}.${r.q(table)} WHERE ${keyClause(r, cols, key, params)}`,
      params,
    );
    if (res.rows.length !== 1) throw new HttpError(404, "errors:explorer.rowChanged");
    return Object.fromEntries(cols.map((c, i) => [c.name, res.rows[0]![i] ?? null])) as Record<string, SqlCell>;
  });
}

/** Değişiklik tam olarak bir satırı etkilemeli; değilse geri alınır */
async function exactlyOne(r: Runner, sql: string, params: unknown[]) {
  await r.run(r.ph(1) === "?" ? "START TRANSACTION" : "BEGIN");
  try {
    const res = await r.run(sql, params);
    if (res.rowCount !== 1) {
      throw res.rowCount === 0 ? new HttpError(409, "errors:explorer.rowGone") : new HttpError(409, "errors:explorer.tooManyRows", { count: res.rowCount });
    }
    await r.run("COMMIT");
  } catch (err) {
    await r.run("ROLLBACK").catch(() => {});
    throw err;
  }
}

export function sqlUpdate(t: SqlTarget, schema: string, table: string, key: Record<string, SqlCell>, values: Record<string, SqlCell>) {
  return withRunner(t, async (r) => {
    const { cols, kind } = await requireTable(r, schema, table);
    if (kind !== "table") throw new HttpError(400, "errors:explorer.viewEdit");
    checkValues(cols, values);
    const names = Object.keys(values);
    if (!names.length) return { ok: true };
    const params: unknown[] = [];
    const set = names.map((n) => (params.push(values[n]), `${r.q(n)} = ${r.ph(params.length)}`)).join(", ");
    await exactlyOne(r, `UPDATE ${r.q(schema)}.${r.q(table)} SET ${set} WHERE ${keyClause(r, cols, key, params)}`, params);
    return { ok: true };
  });
}

export function sqlDelete(t: SqlTarget, schema: string, table: string, key: Record<string, SqlCell>) {
  return withRunner(t, async (r) => {
    const { cols, kind } = await requireTable(r, schema, table);
    if (kind !== "table") throw new HttpError(400, "errors:explorer.viewDelete");
    const params: unknown[] = [];
    await exactlyOne(r, `DELETE FROM ${r.q(schema)}.${r.q(table)} WHERE ${keyClause(r, cols, key, params)}`, params);
    return { ok: true };
  });
}

export function sqlInsert(t: SqlTarget, schema: string, table: string, values: Record<string, SqlCell>) {
  return withRunner(t, async (r) => {
    const { cols, kind } = await requireTable(r, schema, table);
    if (kind !== "table") throw new HttpError(400, "errors:explorer.viewInsert");
    checkValues(cols, values);
    const names = Object.keys(values);
    const target = `${r.q(schema)}.${r.q(table)}`;
    if (!names.length) {
      await r.run(r.ph(1) === "?" ? `INSERT INTO ${target} () VALUES ()` : `INSERT INTO ${target} DEFAULT VALUES`);
    } else {
      const params = names.map((n) => values[n]);
      await r.run(`INSERT INTO ${target} (${names.map((n) => r.q(n)).join(", ")}) VALUES (${names.map((_, i) => r.ph(i + 1)).join(", ")})`, params);
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// SQL konsolu
// ---------------------------------------------------------------------------
const READ_KEYWORDS = /^(select|with|show|explain|describe|desc|values|table|analyze)\b/i;

/** Yorumları atlayıp ilk anahtar kelimeyi bulur */
function firstKeyword(sql: string) {
  return sql.replace(/^(\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "").match(/^\w+/)?.[0] ?? "";
}

export async function sqlConsole(t: SqlTarget, sql: string, write: boolean): Promise<SqlQueryResult> {
  if (!write && !READ_KEYWORDS.test(firstKeyword(sql))) {
    throw new HttpError(400, "errors:explorer.writeRequired");
  }
  const started = Date.now();
  const statements = t.engine === "postgres" ? await pgConsole(t, sql, write) : await myConsole(t, sql, write);
  return { statements, durationMs: Date.now() - started };
}

function capCell(v: unknown): SqlCell {
  if (v == null) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.length > 10_000 ? s.slice(0, 10_000) : s;
}

/**
 * Sonuçlar akış halinde okunur: satırlar belleğe sadece ilk CONSOLE_MAX_ROWS kadar alınır
 * (büyük bir tabloyu SELECT etmek paneli çökertmesin).
 */
async function pgConsole(t: SqlTarget, sql: string, write: boolean): Promise<SqlStatementResult[]> {
  const c = pgClient(t, !write, true);
  try {
    await c.connect();
  } catch (err) {
    throw new HttpError(502, "errors:explorer.connectFailed", { error: (err as Error).message });
  }
  try {
    return await new Promise<SqlStatementResult[]>((resolve, reject) => {
      type Res = { fields?: { name: string }[]; command?: string | null; rowCount?: number | null };
      // 'row' dinleyicisi varken pg satırları kendisi biriktirmez; ilk N satırı biz tutarız
      const seen = new Map<Res, { rows: SqlCell[][]; count: number }>();
      const q = new pg.Query({ text: sql, rowMode: "array" } as never);
      q.on("row", (row: unknown[], r?: unknown) => {
        const res = r as Res;
        let e = seen.get(res);
        if (!e) seen.set(res, (e = { rows: [], count: 0 }));
        e.count++;
        if (e.rows.length < CONSOLE_MAX_ROWS) e.rows.push(row.map(capCell));
      });
      q.on("error", reject);
      q.on("end", (results: Res | Res[]) => {
        const list = Array.isArray(results) ? results : [results];
        resolve(
          list.map((res) => {
            const e = seen.get(res);
            const hasCols = !!res.fields?.length;
            return {
              command: res.command ?? "",
              columns: hasCols ? res.fields!.map((f) => f.name) : null,
              rows: hasCols ? (e?.rows ?? []) : null,
              rowCount: hasCols ? (e?.count ?? 0) : (res.rowCount ?? null),
              truncated: (e?.count ?? 0) > CONSOLE_MAX_ROWS,
            };
          }),
        );
      });
      c.query(q as never);
    });
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  } finally {
    await c.end().catch(() => {});
  }
}

async function myConsole(t: SqlTarget, sql: string, write: boolean): Promise<SqlStatementResult[]> {
  let conn: { c: mysql.Connection; p: ReturnType<mysql.Connection["promise"]> };
  try {
    conn = await myOpen(t, { multi: true, readOnly: !write });
  } catch (err) {
    throw new HttpError(502, "errors:explorer.connectFailed", { error: (err as Error).message });
  }
  try {
    return await new Promise<SqlStatementResult[]>((resolve, reject) => {
      // mysql2 her ifade için önce 'fields' (DML'de undefined), sonra 'result' olaylarını sırayla verir
      const out: SqlStatementResult[] = [];
      let failed = false;
      const safe =
        <A extends unknown[]>(fn: (...a: A) => void) =>
        (...a: A) => {
          if (failed) return;
          try {
            fn(...a);
          } catch (err) {
            failed = true;
            reject(err);
          }
        };
      const q = conn.c.query({ sql, rowsAsArray: true });
      q.on(
        "fields",
        safe((fields?: { name: string }[]) => {
          out.push(
            fields
              ? { command: "SELECT", columns: fields.map((f) => f.name), rows: [], rowCount: 0, truncated: false }
              : { command: "OK", columns: null, rows: null, rowCount: null, truncated: false },
          );
        }),
      );
      q.on(
        "result",
        safe((row: unknown) => {
          const s = out[out.length - 1];
          if (!s) return;
          if (Array.isArray(row) && s.rows) {
            s.rowCount = (s.rowCount ?? 0) + 1;
            if (s.rows.length < CONSOLE_MAX_ROWS) s.rows.push(row.map((v) => capCell(myCell(v))));
            else s.truncated = true;
          } else if (!Array.isArray(row)) {
            s.rowCount = (row as { affectedRows?: number }).affectedRows ?? null;
          }
        }),
      );
      q.on("error", (err: Error) => {
        failed = true;
        reject(err);
      });
      q.on("end", () => !failed && resolve(out));
    });
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  } finally {
    await conn.p.end().catch(() => {});
  }
}
