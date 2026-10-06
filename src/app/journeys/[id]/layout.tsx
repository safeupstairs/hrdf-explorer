import { notFound } from "next/navigation";
import { hasDb } from "@/lib/db";
import { journeyExists } from "@/lib/hrdf/queries";

/** Resolve 404 before this segment's loading.tsx suspense boundary (so the status is not 200). */
export default async function JourneyLayout({ children, params }: LayoutProps<"/journeys/[id]">) {
  if (hasDb()) {
    const id = Number((await params).id);
    if (!Number.isFinite(id) || !journeyExists(id)) notFound();
  }
  return children;
}
