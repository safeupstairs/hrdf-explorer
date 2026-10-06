"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileArchive, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImportStatus } from "@/lib/import-status";

type Variant = "page" | "compact";

function formatBytes(n: number | null | undefined) {
  if (n == null || n <= 0) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function formatElapsed(startedAt: string | null, now: number) {
  if (!startedAt) return null;
  const s = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function isRunning(state: ImportStatus["state"] | undefined) {
  return state === "uploading" || state === "downloading" || state === "building";
}

export function DataWizard({ variant }: { variant: Variant }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback((s: ImportStatus) => {
    setStatus(s);
    if (s.state !== "uploading") setUploadPct(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/data/status")
      .then((r) => r.json())
      .then((s: ImportStatus) => {
        if (!cancelled) apply(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not read import status.");
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(() => {
    if (!status || !isRunning(status.state)) return;
    const es = new EventSource("/api/data/events");
    es.onmessage = (ev) => {
      try {
        apply(JSON.parse(ev.data) as ImportStatus);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      fetch("/api/data/status")
        .then((r) => r.json())
        .then((s: ImportStatus) => apply(s))
        .catch(() => undefined);
    };
    return () => es.close();
    // Re-subscribe when the job starts/stops, not on every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status?.state is the phase gate
  }, [apply, status?.state]);

  useEffect(() => {
    if (!isRunning(status?.state) && status?.state !== "success") return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [status?.state]);

  useEffect(() => {
    if (status?.state !== "success") return;
    const t = setTimeout(() => {
      router.refresh();
    }, 1600);
    return () => clearTimeout(t);
  }, [status?.state, router]);

  const busy = isRunning(status?.state) || uploadPct != null;
  const pct = uploadPct != null ? uploadPct * 0.12 : (status?.pct ?? 0);

  async function post(url: string) {
    setLoadError(null);
    const res = await fetch(url, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    apply(body as ImportStatus);
  }

  function uploadFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setLoadError("Choose an HRDF .zip file.");
      return;
    }
    setLoadError(null);
    setUploadPct(0);
    const CHUNK = 8 * 1024 * 1024;
    void (async () => {
      try {
        let last: ImportStatus | null = null;
        for (let offset = 0; offset < file.size || (file.size === 0 && offset === 0); offset += CHUNK) {
          const end = Math.min(file.size, offset + CHUNK);
          const chunk = file.slice(offset, end);
          const final = end >= file.size;
          last = await new Promise<ImportStatus>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `/api/data/upload?offset=${offset}&final=${final ? "1" : "0"}`);
            xhr.setRequestHeader("X-Hrdf-Filename", file.name);
            xhr.setRequestHeader("X-Hrdf-Size", String(file.size));
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            xhr.upload.onprogress = (e) => {
              if (!e.lengthComputable) return;
              setUploadPct(((offset + e.loaded) / Math.max(file.size, 1)) * 100);
            };
            xhr.onload = () => {
              try {
                const body = JSON.parse(xhr.responseText) as ImportStatus & { error?: string };
                if (xhr.status >= 400) {
                  reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
                  return;
                }
                resolve(body);
              } catch {
                reject(new Error(`Upload failed (${xhr.status})`));
              }
            };
            xhr.onerror = () => reject(new Error("Upload failed. Check that the app is still running."));
            xhr.send(chunk);
          });
          setUploadPct((end / Math.max(file.size, 1)) * 100);
          if (file.size === 0) break;
        }
        setUploadPct(null);
        if (last) apply(last);
      } catch (err) {
        setUploadPct(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
  }

  async function onRetry() {
    try {
      if (status?.zipReady) await post("/api/data/build");
      else if (status?.source === "fetch") await post("/api/data/fetch");
      else setStatus(status ? { ...status, state: "idle", error: null } : status);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) setDrag(true);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) setDrag(true);
    },
    onDragLeave: (e: DragEvent) => {
      e.preventDefault();
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDrag(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const file = e.dataTransfer.files?.[0];
      if (file && !busy) uploadFile(file);
    },
  };

  if (loadError && !status) {
    return (
      <Panel variant={variant}>
        <ErrorBlock message={loadError} onRetry={() => window.location.reload()} />
      </Panel>
    );
  }

  if (status?.state === "success") {
    return (
      <Panel variant={variant}>
        <div className="rounded-md bg-board p-5 text-board-foreground sm:p-6">
          <div className="flex items-center gap-2 text-board-accent">
            <CheckCircle2 className="size-5" />
            <span className="font-bold">Database ready</span>
          </div>
          <p className="mt-2 text-sm text-board-muted">{status.message}</p>
          <ProgressBar pct={100} />
          <Button className="mt-4 h-9 rounded-md" onClick={() => router.refresh()}>
            Open the explorer
          </Button>
        </div>
      </Panel>
    );
  }

  if (status?.state === "error") {
    return (
      <Panel variant={variant}>
        <ErrorBlock
          message={status.error ?? status.message}
          onRetry={() => void onRetry()}
          retryLabel={status.zipReady ? "Retry import" : status.source === "fetch" ? "Retry download" : "Try again"}
          onReset={() => setStatus({ ...status, state: "idle", error: null, message: "No HRDF database yet." })}
        />
      </Panel>
    );
  }

  if (busy) {
    const label =
      uploadPct != null || status?.state === "uploading"
        ? "Uploading zip"
        : status?.state === "downloading"
          ? "Downloading newest build"
          : "Importing into SQLite";
    const elapsed = formatElapsed(status?.startedAt ?? null, now);
    return (
      <Panel variant={variant}>
        <div className="rounded-md bg-board p-5 text-board-foreground sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-board-accent" />
              <span className="text-[13px] font-bold tracking-[0.08em] uppercase">{label}</span>
            </div>
            <span className="font-mono text-sm text-board-accent tabular">{Math.round(pct)}%</span>
          </div>
          <ProgressBar pct={pct} />
          <p className="mt-3 text-sm text-board-muted">{uploadPct != null ? `Sending ${Math.round(uploadPct)}% of the zip to the importer…` : status?.message}</p>
          <p className="mt-2 font-mono text-[11px] text-board-muted">
            {elapsed ? `Elapsed ${elapsed}` : "Starting…"}
            {" · "}A full 2027 export is about 3.3 GB and typically takes around 3 minutes.
            {status?.bytes && status.totalBytes ? ` · ${formatBytes(status.bytes)} / ${formatBytes(status.totalBytes)}` : null}
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel variant={variant}>
      {loadError ? <p className="mb-4 text-sm text-destructive">{loadError}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-md border bg-card p-4 sm:p-5">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Download className="size-4" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold">Fetch the newest build</h3>
          <p className="mt-1.5 flex-1 text-sm text-muted-foreground">
            Downloads the latest 2027 HRDF zip from opentransportdata.swiss (~200 MB), then runs{" "}
            <span className="font-mono text-[12.5px]">npm run data:build</span>.
          </p>
          <Button
            className="mt-4 h-10 w-full rounded-md sm:w-auto"
            onClick={() => void post("/api/data/fetch").catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)))}
          >
            Fetch and import
          </Button>
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop or choose a local HRDF zip"
          className={cn(
            "flex flex-col rounded-md border border-dashed bg-paper p-4 outline-none sm:p-5",
            drag ? "border-primary bg-primary/5" : "border-foreground/25",
          )}
          {...dropHandlers}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <div className="flex size-9 items-center justify-center rounded-md bg-foreground/8">
            <Upload className="size-4" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold">Use a local zip</h3>
          <p className="mt-1.5 flex-1 text-sm text-muted-foreground">
            Drop an HRDF 5.40 zip here, or choose a file. Same importer as the command line — no terminal after the app is running.
          </p>
          <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <FileArchive className="size-4" />
            Drop zip here or browse
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadFile(file);
            }}
          />
        </div>
      </div>
    </Panel>
  );
}

function Panel({ variant, children }: { variant: Variant; children: ReactNode }) {
  if (variant === "compact") {
    return <div>{children}</div>;
  }
  return (
    <div className="mx-auto max-w-3xl py-6 sm:py-12">
      <div className="eyebrow mb-3">First run</div>
      <h1 className="text-[32px] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-[44px]">No timetable loaded</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
        The explorer reads a local SQLite file built from an official HRDF 5.40 zip. A full 2027 export becomes about 3.3 GB and takes around 3 minutes. Data stays on this machine — nothing is sent to a paid host.
      </p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="mt-4 h-2.5 overflow-hidden rounded-full bg-board-line"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <div className="h-full bg-board-accent transition-[width] duration-300 ease-out" style={{ width: `${width}%` }} />
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
  retryLabel = "Try again",
  onReset,
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  onReset?: () => void;
}) {
  return (
    <div className="rounded-md border-l-4 border-primary bg-card p-5">
      <div className="flex items-center gap-2 font-bold">
        <AlertTriangle className="size-5 text-primary" /> Import failed
      </div>
      <p className="mt-2 font-mono text-sm break-words text-muted-foreground">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-9 rounded-md" onClick={onRetry}>
          {retryLabel}
        </Button>
        {onReset ? (
          <Button variant="outline" className="h-9 rounded-md" onClick={onReset}>
            Choose another file
          </Button>
        ) : null}
      </div>
    </div>
  );
}
