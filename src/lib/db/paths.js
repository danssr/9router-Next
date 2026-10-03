import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "data.sqlite");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");
export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};
export function ensureDirs() {
  // Best-effort. DATA_DIR also holds the model catalog and other runtime files,
  // so it is created even in remote mode (where the DB itself is off-disk).
  // Never fatal: the remote DB path does not depend on the local FS.
  for (const dir of [DATA_DIR, DB_DIR, BACKUPS_DIR]) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.warn(`[DB] ensureDirs ${dir}: ${e.message}`);
    }
  }
}
