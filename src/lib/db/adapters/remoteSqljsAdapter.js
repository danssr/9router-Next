// Remote sql.js adapter for the Vercel/serverless port.
//
// Same SQL engine as sqljsAdapter.js (pure-JS sql.js, no native deps), but the
// DB blob is loaded from / persisted to a remote store instead of a local file.
// This keeps the entire SQLite schema, repos/, and usage layer unchanged — only
// the bytes' home moves. Adapter contract matches the local adapters:
//   { driver, run, get, all, exec, transaction, close, raw }
//
// Concurrency: by default each instance holds the DB in memory and writes the
// whole blob back (last-write-wins). Set NINEROUTER_REMOTE_CONCURRENCY=merge to
// serialize flushes with a store lock and replay the mutations made since the
// last flush onto the latest remote blob, so a concurrent instance's writes are
// merged instead of clobbered. Residual: mutations already flushed by an
// instance whose save was later overwritten are not recovered — true multi-writer
// correctness needs a row-level store (see docs/VERCEL-PORT.md).

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
const MERGE = (process.env.NINEROUTER_REMOTE_CONCURRENCY || "off").toLowerCase() === "merge";
const LOCK_TTL_MS = Number(process.env.NINEROUTER_REMOTE_LOCK_TTL_MS || 10000);
const LOCK_RETRIES = Number(process.env.NINEROUTER_REMOTE_LOCK_RETRIES || 25);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createRemoteSqljsAdapter(key) {
  const SQLLib = await loadSql();
  const store = await createRemoteStore();

  const buf = await store.load(key);
  let db = new SQLLib.Database(buf || undefined);
  db.exec(PRAGMA_SQL);

  let dirty = false;
  let saveTimer = null;
  // Serialize saves so a slow round-trip can't interleave with the next one.
  let saving = Promise.resolve();
  // Mutating statements since the last successful flush (merge mode only).
  const pending = [];

  function record(stmt) {
    if (MERGE) pending.push(stmt);
  }

  async function acquire() {
    if (!store.acquireLock) return "noop";
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < LOCK_RETRIES; i++) {
      if (await store.acquireLock(key, token, LOCK_TTL_MS)) return token;
      await sleep(40 + Math.floor(Math.random() * 80));
    }
    return null; // gave up: proceed without the lock (best effort)
  }

  async function release(token) {
    if (token && token !== "noop" && store.releaseLock) {
      try { await store.releaseLock(key, token); } catch { /* best effort */ }
    }
  }

  async function flush() {
    if (!MERGE) {
      await store.save(key, new Uint8Array(db.export()));
      return;
    }
    const batch = pending.splice(0);
    const token = await acquire();
    try {
      const latest = await store.load(key);
      if (latest) {
        // Rebuild from the current remote state, then replay our unflushed
        // mutations on top, so a concurrent instance's writes survive.
        try { db.close(); } catch { /* ignore */ }
        db = new SQLLib.Database(latest);
        db.exec(PRAGMA_SQL);
        for (const stmt of batch) {
          try {
            if (stmt.type === "run") {
              const s = db.prepare(stmt.sql);
              try { s.bind(stmt.params && stmt.params.length ? stmt.params : undefined); s.step(); } finally { s.free(); }
            } else {
              db.exec(stmt.sql);
            }
          } catch (e) {
            console.warn(`[remoteSqljs:merge] replay skipped (${e && e.message ? e.message : e})`);
          }
        }
      }
      await store.save(key, new Uint8Array(db.export()));
    } catch (e) {
      pending.unshift(...batch); // requeue; retry on the next flush
      throw e;
    } finally {
      await release(token);
    }
  }

  function persist() {
    dirty = false;
    saving = saving
      .then(flush)
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
      record({ type: "run", sql, params });
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
    record({ type: "exec", sql });
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

  return {
    driver: `remote:${store.name}`,
    run, get, all, exec, transaction, close,
    get raw() { return db; },
    store,
  };
}
