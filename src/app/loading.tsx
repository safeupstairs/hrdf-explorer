import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-3 h-10 w-2/3 max-w-xl" />
      <Skeleton className="mt-3 h-4 w-1/2 max-w-md" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}
