import { NextResponse } from "next/server";
import { ImportBusyError, saveUpload } from "@/lib/import-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const filename = request.headers.get("x-hrdf-filename") ?? "hrdf.zip";
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const final = url.searchParams.get("final") !== "0";
  const totalBytes = Number(request.headers.get("x-hrdf-size") ?? 0);
  try {
    const status = await saveUpload(request, filename, { offset, final, totalBytes });
    return NextResponse.json(status);
  } catch (err) {
    const status = err instanceof ImportBusyError ? 409 : 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
