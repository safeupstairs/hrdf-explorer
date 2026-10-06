import { getImportStatus } from "@/lib/import-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let last = "";
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown, event?: string) => {
        const data = JSON.stringify(payload);
        if (event !== "ping" && data === last) return;
        if (event !== "ping") last = data;
        const prefix = event ? `event: ${event}\n` : "";
        controller.enqueue(encoder.encode(`${prefix}data: ${data}\n\n`));
      };
      const tick = () => {
        try {
          send(getImportStatus());
        } catch (err) {
          send({ error: err instanceof Error ? err.message : String(err) });
        }
      };
      tick();
      const iv = setInterval(tick, 400);
      const ping = setInterval(() => send({ t: Date.now() }, "ping"), 15000);
      const stop = () => {
        clearInterval(iv);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", stop);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
