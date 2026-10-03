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
    const { syncModelCatalog } = await import("@/lib/modelCatalog/sync.js");
    await syncModelCatalog();
    return NextResponse.json({ ok: true, job: "model-catalog" });
  } catch (e) {
    return NextResponse.json({ ok: false, job: "model-catalog", error: e?.message || String(e) }, { status: 500 });
  }
}
