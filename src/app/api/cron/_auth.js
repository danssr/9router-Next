// Shared guard for Vercel Cron routes. Vercel sends `Authorization: Bearer
// $CRON_SECRET` on scheduled invocations. Refuse when CRON_SECRET is unset so a
// deployed app never exposes these endpoints unauthenticated.
export function cronAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}
