// Remote blob store drivers for the Vercel/serverless port.
// The DB is a single sql.js blob; these drivers move that blob off local disk.
// Selected by NINEROUTER_REMOTE_STORE = file | upstash | supabase (empty = local, unchanged).
//
// Driver contract: { name, load(key) -> Uint8Array|null, save(key, bytes) -> Promise<void> }

import { createFileStore } from "./fileStore.js";
import { createUpstashStore } from "./upstashStore.js";
import { createSupabaseStore } from "./supabaseStore.js";

export function isRemoteStoreEnabled() {
  return !!process.env.NINEROUTER_REMOTE_STORE;
}

export async function createRemoteStore() {
  const driver = (process.env.NINEROUTER_REMOTE_STORE || "").toLowerCase();
  if (driver === "file") return createFileStore();
  if (driver === "upstash" || driver === "kv" || driver === "redis") return createUpstashStore();
  if (driver === "supabase") return createSupabaseStore();
  throw new Error(`[remoteStore] unknown driver: "${driver}" (use file|upstash|supabase)`);
}
