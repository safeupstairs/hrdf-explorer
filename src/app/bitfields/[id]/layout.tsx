import { notFound } from "next/navigation";
import { hasDb } from "@/lib/db";
import { cache } from "@/lib/hrdf/lookups";

/** Resolve 404 before this segment's loading.tsx suspense boundary (so the status is not 200). */
export default async function BitfieldLayout({ children, params }: LayoutProps<"/bitfields/[id]">) {
  if (hasDb()) {
    const id = Number((await params).id);
    if (!Number.isFinite(id) || !cache().bitfields.has(id)) notFound();
  }
  return children;
}
