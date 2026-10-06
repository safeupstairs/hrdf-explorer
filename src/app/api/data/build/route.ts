import { NextResponse } from "next/server";
import { ImportBusyError, startBuild } from "@/lib/import-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export function POST() {
  try {
    return NextResponse.json(startBuild());
  } catch (err) {
    const status = err instanceof ImportBusyError ? 409 : 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
