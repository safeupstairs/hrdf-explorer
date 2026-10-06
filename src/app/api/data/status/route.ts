import { NextResponse } from "next/server";
import { getImportStatus } from "@/lib/import-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getImportStatus());
}
