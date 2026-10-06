import "server-only";
import { cookies } from "next/headers";
import { LANGS, type Lang } from "@/lib/hrdf/lookups";

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get("hrdf-lang")?.value?.toUpperCase();
  return LANGS.includes(v as Lang) ? (v as Lang) : "EN";
}
