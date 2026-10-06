import { notFound } from "next/navigation";
import { hasDb } from "@/lib/db";
import { getStation } from "@/lib/hrdf/queries";

/** Resolve 404 before this segment's loading.tsx suspense boundary (so the status is not 200). */
export default async function StationLayout({ children, params }: LayoutProps<"/stations/[id]">) {
  if (hasDb()) {
    const id = Number((await params).id);
    if (!Number.isFinite(id) || !getStation(id)) notFound();
  }
  return children;
}
