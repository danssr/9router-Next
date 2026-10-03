// Runtime platform detection for the Vercel/serverless port.
//
// On a serverless host, long-lived schedulers and local-OS subsystems
// (tunnel, tailscale, mitm, tray, pxpipe, headroom process) cannot run; those
// paths are replaced by Vercel Cron routes that call the same tick functions.
// NINEROUTER_SERVERLESS=1 forces the same behavior on any host (e.g. a local
// dry-run of the serverless path).

export function isVercel() {
  return !!process.env.VERCEL;
}

export function isServerless() {
  return isVercel() || process.env.NINEROUTER_SERVERLESS === "1";
}
