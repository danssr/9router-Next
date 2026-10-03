// Upstash Redis blob store (REST). Prod backend: atomic-ish, good under concurrency.
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//      NINEROUTER_REMOTE_KEY (optional; default 9router:db:data.sqlite)
// Value is stored base64-encoded (Redis is string-only).

const DEFAULT_KEY = "9router:db:data.sqlite";

export function createUpstashStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = process.env.NINEROUTER_REMOTE_KEY || DEFAULT_KEY;
  if (!url || !token) {
    throw new Error("[remoteStore] upstash: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required");
  }
  const base = url.replace(/\/$/, "");
  const auth = { Authorization: `Bearer ${token}` };

  return {
    name: "upstash",
    async load() {
      const r = await fetch(`${base}/get/${encodeURIComponent(key)}`, { headers: auth });
      if (!r.ok) throw new Error(`[remoteStore] upstash GET ${r.status}: ${await r.text().catch(() => "")}`);
      const j = await r.json();
      if (j.result == null) return null;
      return new Uint8Array(Buffer.from(j.result, "base64"));
    },
    async save(_k, bytes) {
      const b64 = Buffer.from(bytes).toString("base64");
      const r = await fetch(`${base}/set/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { ...auth, "content-type": "text/plain" },
        body: b64,
      });
      if (!r.ok) throw new Error(`[remoteStore] upstash SET ${r.status}: ${await r.text().catch(() => "")}`);
    },
  };
}
