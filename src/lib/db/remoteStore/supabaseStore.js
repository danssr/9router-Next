// Supabase Storage blob store (REST, no SDK). Supabase is supported as an
// alternative prod backend. Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_BUCKET (default "9router")  NINEROUTER_REMOTE_KEY (default 9router/db/data.sqlite)
// Create the bucket once (private). Service-role key is required to bypass RLS.

const DEFAULT_OBJ = "9router/db/data.sqlite";

export function createSupabaseStore() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET || "9router";
  if (!url || !serviceKey) {
    throw new Error("[remoteStore] supabase: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const base = url.replace(/\/$/, "");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const objectUrl = (key) => `${base}/storage/v1/object/${bucket}/${process.env.NINEROUTER_REMOTE_KEY || key || DEFAULT_OBJ}`;

  return {
    name: "supabase",
    async load(key) {
      const r = await fetch(objectUrl(key), { headers });
      if (r.status === 404 || r.status === 400) return null; // object not created yet
      if (!r.ok) throw new Error(`[remoteStore] supabase GET ${r.status}: ${await r.text().catch(() => "")}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async save(key, bytes) {
      const r = await fetch(objectUrl(key), {
        method: "POST",
        headers: { ...headers, "x-upsert": "true", "content-type": "application/octet-stream" },
        body: Buffer.from(bytes),
      });
      if (!r.ok) throw new Error(`[remoteStore] supabase PUT ${r.status}: ${await r.text().catch(() => "")}`);
    },
    // No atomic lock primitive here; concurrency merge is best-effort only.
    async acquireLock() { return true; },
    async releaseLock() {},
  };
}
