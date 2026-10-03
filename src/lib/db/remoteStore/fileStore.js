// Local-file blob store. Phase-0 spike driver: exercises the remote adapter's
// load/save round-trip without any cloud account. Also a sane fallback.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export function createFileStore() {
  const file = process.env.NINEROUTER_REMOTE_FILE || path.join(DATA_DIR, "db", "remote-blob.sqlite");
  return {
    name: "file",
    async load() {
      if (!fs.existsSync(file)) return null;
      return new Uint8Array(fs.readFileSync(file));
    },
    async save(_key, bytes) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, Buffer.from(bytes));
      fs.renameSync(tmp, file); // atomic replace
    },
  };
}
