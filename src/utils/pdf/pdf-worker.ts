import { parentPort } from "worker_threads";
import { ReportSpec } from "./report-spec";
import { renderReportToBuffer } from "./report-renderer";

/**
 * Worker-thread entry point for PDF rendering.
 *
 * Laying out a report is pure, blocking CPU work — measuring glyphs, packing
 * rows, deflating streams. Running it here keeps the Express event loop free,
 * so the POS terminals keep getting served while a long report is being built.
 *
 * The thread is long-lived: font buffers and parsed assets stay cached between
 * jobs (see report-assets.ts), so only the first report pays the warm-up cost.
 */

export interface RenderRequest {
    id: number;
    spec: ReportSpec;
}

export type RenderResponse =
    | { id: number; ok: true; buffer: ArrayBuffer }
    | { id: number; ok: false; error: string };

if (parentPort) {
    const port = parentPort;

    port.on("message", (message: RenderRequest) => {
        renderReportToBuffer(message.spec)
            .then((buffer) => {
                // Hand the bytes over instead of copying them.
                const transferable = buffer.buffer.slice(
                    buffer.byteOffset,
                    buffer.byteOffset + buffer.byteLength
                ) as ArrayBuffer;
                const response: RenderResponse = { id: message.id, ok: true, buffer: transferable };
                port.postMessage(response, [transferable]);
            })
            .catch((error: unknown) => {
                const response: RenderResponse = {
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                };
                port.postMessage(response);
            });
    });

}
