// Remote sql.js adapter for the Vercel/serverless port.
//
// Same SQL engine as sqljsAdapter.js (pure-JS sql.js, no native deps), but the
// DB blob is loaded from / persisted to a remote store instead of a local file.
// This keeps the entire SQLite schema, repos/, and usage layer unchanged — only
// the bytes' home moves. Adapter contract matches the local adapters:
//   { driver, run, get, all, exec, transaction, close, raw }
//
// Cross-instance writes are last-write-wins. Fine for single-user; use a single
// region, or the upstash backend if concurrency matters.

import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { createRemoteStore } from "../remoteStore/index.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

// Writes are debounced so a burst of statements costs one round-trip. Tune via
// NINEROUTER_REMOTE_SAVE_MS. close() always flushes.
const SAVE_DEBOUNCE_MS = Number(process.env.NINEROUTER_REMOTE_SAVE_MS || 250);

export async function createRemoteSqljsAdapter(key) {
  const SQLLib = await loadSql();
  const store = await createRemoteStore();

  const buf = await store.load(key);
  const db = new SQLLib.Database(buf || undefined);
  db.exec(PRAGMA_SQL);

  let dirty = false;
  let saveTimer = null;
  // Serialize saves so a slow round-trip can't interleave with the next one.
  let saving = Promise.resolve();

  function persist() {
    const data = db.export();
    dirty = false;
    saving = saving
      .then(() => store.save(key, new Uint8Array(data)))
      .catch((e) => console.error(`[remoteSqljs:${store.name}] save failed:`, e && e.message ? e.message : e));
    return saving;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) persist();
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  async function close() {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) await persist();
    await saving;
    db.close();
  }

  return { driver: `remote:${store.name}`, run, get, all, exec, transaction, close, raw: db, store };
}
