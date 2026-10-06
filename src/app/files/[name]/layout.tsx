import { notFound } from "next/navigation";
import { hasDb } from "@/lib/db";
import { fileInfo } from "@/lib/hrdf/queries";

/** Resolve 404 before this segment's loading.tsx suspense boundary (so the status is not 200). */
export default async function FileLayout({ children, params }: LayoutProps<"/files/[name]">) {
  if (hasDb()) {
    const name = (await params).name;
    if (!fileInfo(name)) notFound();
  }
  return children;
}
