#!/usr/bin/env node
// Push a local 9Router DB (~/.9router/db/data.sqlite) to a Vercel deployment's
// remote store (Upstash blob). Rebuilds the DB compact (drops the requestDetails
// observability log, which is the bulk and is excluded by the app's own backups),
// base64-encodes it, and SETs it at the store key.
//
// Usage:
//   node scripts/sync-db-to-vercel.mjs [path/to/data.sqlite] [--yes] [--dry-run]
//     --yes       actually upload (otherwise dry run: build + size check only)
//     --dry-run   build + report, never upload
//     --keep-details   include requestDetails (may exceed the 10 MB Upstash limit)
//
// Env (required for upload):
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   NINEROUTER_REMOTE_KEY   (optional; default 9router:db:data.sqlite)
//
// The blob is the WHOLE DB, so this overwrites everything on the target. It is
// not a merge. Keep a backup of the current blob before the first push.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import initSqlJs from "sql.js";

const UPSTASH_MAX = 10 * 1024 * 1024; // request size limit (base64 body)

function parseArgs(argv) {
  const opts = { yes: false, dryRun: false, keepDetails: false, source: null };
  for (const a of argv) {
    if (a === "--yes") opts.yes = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--keep-details") opts.keepDetails = true;
    else if (!a.startsWith("--")) opts.source = a;
  }
  return opts;
}

function compact(rawDb, SQL, keepDetails) {
  const out = new SQL.Database();
  out.run("PRAGMA foreign_keys=OFF");
  const tables = rawDb.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0].values;
  const kept = tables.filter(([n]) => keepDetails || n !== "requestDetails");
  for (const [name, sql] of kept) {
    out.run(sql);
    const r = rawDb.exec(`SELECT * FROM ${name}`);
    if (!r[0]) continue;
    const ph = "(" + Array(r[0].columns.length).fill("?").join(",") + ")";
    for (const row of r[0].values) out.run(`INSERT INTO ${name} VALUES ${ph}`, row);
  }
  const idx = rawDb.exec("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")[0]?.values || [];
  for (const [sql] of idx) { try { out.run(sql); } catch { /* index may reference a dropped table */ } }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const src = opts.source || path.join(os.homedir(), ".9router", "db", "data.sqlite");
if (!fs.existsSync(src)) {
  console.error(`source not found: ${src}`);
  process.exit(1);
}

const SQL = await initSqlJs();
const raw = new SQL.Database(fs.readFileSync(src));
const built = compact(raw, SQL, opts.keepDetails);
const buf = Buffer.from(built.export());
const b64 = buf.toString("base64");

const counts = (t) => { const r = built.exec(`SELECT count(*) FROM ${t}`); return r[0] ? r[0].values[0][0] : "-"; };
console.log(`source:            ${src}`);
console.log(`compacted DB:      ${buf.length} bytes`);
console.log(`base64:            ${b64.length} bytes  (limit ${UPSTASH_MAX})`);
console.log(`requestDetails:    ${opts.keepDetails ? counts("requestDetails") : "dropped"}`);
console.log(`providers:         ${counts("providerConnections")}`);
console.log(`usageHistory:      ${counts("usageHistory")}`);
console.log(`apiKeys:           ${counts("apiKeys")}`);

if (b64.length >= UPSTASH_MAX) {
  console.error(`\nABORT: base64 ${b64.length} >= Upstash limit ${UPSTASH_MAX}. Re-run without --keep-details, or trim usageHistory.`);
  process.exit(1);
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const key = process.env.NINEROUTER_REMOTE_KEY || "9router:db:data.sqlite";

if (opts.dryRun || !opts.yes) {
  console.log(`\nDRY RUN — not uploading. Target: ${url || "<UPSTASH_REDIS_REST_URL unset>"} key=${key}`);
  console.log(`Run with --yes to upload.`);
  process.exit(0);
}
if (!url || !token) {
  console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required to upload.");
  process.exit(1);
}

const res = await fetch(`${url.replace(/\/$/, "")}/set/${encodeURIComponent(key)}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "content-type": "text/plain" },
  body: b64,
});
console.log(`\nSET ${key} -> ${res.status} ${(await res.text()).slice(0, 80)}`);
if (!res.ok) process.exit(1);
console.log("done. Instances pick it up within NINEROUTER_REMOTE_RELOAD_MS (or on cold start).");
