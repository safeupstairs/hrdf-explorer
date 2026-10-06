export type ImportState = "idle" | "uploading" | "downloading" | "building" | "success" | "error";
export type ImportSource = "fetch" | "upload" | null;

export type ImportStatus = {
  state: ImportState;
  source: ImportSource;
  filename: string | null;
  pct: number;
  message: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  bytes: number | null;
  totalBytes: number | null;
  dbBytes: number | null;
  zipReady: boolean;
  ready: boolean;
  pid: number | null;
};
