"use client";

import { AlertTriangle } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="rounded-md border-l-4 border-primary bg-card p-6">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="size-5 text-primary" /> Something went wrong reading the HRDF data
        </div>
        <p className="mt-2 font-mono text-sm break-words text-muted-foreground">{error.message}</p>
        <button onClick={reset} className="mt-4 h-9 rounded-md bg-foreground px-4 text-sm font-semibold text-background hover:bg-primary">
          Try again
        </button>
      </div>
    </div>
  );
}
