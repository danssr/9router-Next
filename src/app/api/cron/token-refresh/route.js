import { NextResponse } from "next/server";
import { cronAuthorized } from "../_auth.js";

// Driven by Vercel Cron (see vercel.json). Long-lived schedulers are disabled on
// serverless (src/lib/runtime/platform.js), so these routes run the tick once.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { runBackgroundTokenRefreshTick } = await import("@/sse/services/backgroundTokenRefresh.js");
    await runBackgroundTokenRefreshTick();
    return NextResponse.json({ ok: true, job: "token-refresh" });
  } catch (e) {
    return NextResponse.json({ ok: false, job: "token-refresh", error: e?.message || String(e) }, { status: 500 });
  }
}
