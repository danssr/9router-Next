// Upstash Redis blob store (REST). Prod backend: atomic-ish, good under concurrency.
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//      NINEROUTER_REMOTE_KEY (optional; default 9router:db:data.sqlite)
// Value is stored base64-encoded (Redis is string-only).

const DEFAULT_KEY = "9router:db:data.sqlite";

export function createUpstashStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("[remoteStore] upstash: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required");
  }
  const base = url.replace(/\/$/, "");
  const auth = { Authorization: `Bearer ${token}` };
  const resolveKey = (key) => process.env.NINEROUTER_REMOTE_KEY || key || DEFAULT_KEY;

  return {
    name: "upstash",
    async load(key) {
      const r = await fetch(`${base}/get/${encodeURIComponent(resolveKey(key))}`, { headers: auth });
      if (!r.ok) throw new Error(`[remoteStore] upstash GET ${r.status}: ${await r.text().catch(() => "")}`);
      const j = await r.json();
      if (j.result == null) return null;
      return new Uint8Array(Buffer.from(j.result, "base64"));
    },
    async save(key, bytes) {
      const b64 = Buffer.from(bytes).toString("base64");
      const r = await fetch(`${base}/set/${encodeURIComponent(resolveKey(key))}`, {
        method: "POST",
        headers: { ...auth, "content-type": "text/plain" },
        body: b64,
      });
      if (!r.ok) throw new Error(`[remoteStore] upstash SET ${r.status}: ${await r.text().catch(() => "")}`);
    },
    // Distributed lock so concurrent instances serialize their flushes.
    async acquireLock(key, token, ttlMs) {
      const lockKey = `${resolveKey(key)}:__lock`;
      const body = JSON.stringify(["SET", lockKey, token, "NX", "PX", String(ttlMs)]);
      const r = await fetch(base, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body });
      if (!r.ok) throw new Error(`[remoteStore] upstash lock ${r.status}: ${await r.text().catch(() => "")}`);
      const j = await r.json();
      return j.result === "OK";
    },
    async releaseLock(key, token) {
      const lockKey = `${resolveKey(key)}:__lock`;
      const script = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
      const body = JSON.stringify(["EVAL", script, "1", lockKey, token]);
      await fetch(base, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body });
    },
  };
}
