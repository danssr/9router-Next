// x-9r-real-ip is only trustworthy when custom-server.js stamped it from the TCP socket.
// It proves that by echoing the per-process secret it generated at boot, which a client
// cannot guess. Without the proof the header is just attacker-supplied input.
export function hasTrustedPeerHeaders(request) {
  const token = process.env.NINEROUTER_PEER_TOKEN;
  return Boolean(token) && request.headers.get("x-9r-peer-token") === token;
}

// A platform reverse proxy that OVERWRITES the client-IP headers at the edge,
// so the client cannot spoof them. Vercel does this (it sets
// x-vercel-forwarded-for / x-forwarded-for to the real peer). A self-managed
// reverse proxy opts in explicitly with TRUST_PROXY=true.
export function isPlatformTrustedProxy() {
  return process.env.TRUST_PROXY === "true" || !!process.env.VERCEL;
}

// Single resolver for the client IP, shared by the login limiter (and anything
// else that needs it). Order of trust:
//   1. custom-server.js proof (x-9r-peer-token) → x-9r-real-ip
//   2. platform/opt-in proxy that overwrites XFF (Vercel)
//   3. otherwise a single "unknown" bucket, so a spoofed XFF rotation cannot
//      escape the limiter.
export function getTrustedClientIp(request) {
  if (hasTrustedPeerHeaders(request)) {
    const realIp = request.headers.get("x-9r-real-ip");
    if (realIp) return realIp;
  }
  if (isPlatformTrustedProxy()) {
    const xff = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return "unknown";
}
