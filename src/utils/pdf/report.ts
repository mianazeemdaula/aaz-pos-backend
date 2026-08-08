import { Response } from "express";
import { ReportBuilder, ReportSpec } from "./report-spec";
import { renderReportToBuffer } from "./report-renderer";
import { renderOnWorker, isThreadedRenderingEnabled, poolFailureOf } from "./pdf-worker-pool";

/**
 * Public entry point for building report PDFs.
 *
 * Callers hand over a finished spec and get bytes back. Where those bytes are
 * produced — worker thread or, if threading is not available in this runtime,
 * in-process — is an implementation detail handled here.
 */

function toSpec(input: ReportBuilder | ReportSpec): ReportSpec {
    return input instanceof ReportBuilder ? input.spec : input;
}

export async function renderReport(input: ReportBuilder | ReportSpec): Promise<Buffer> {
    const spec = toSpec(input);

    if (isThreadedRenderingEnabled()) {
        try {
            return await renderOnWorker(spec);
        } catch (error) {
            const failure = poolFailureOf(error);
            if (!failure) {
                throw error; // A real layout failure — do not paper over it.
            }
            if (failure === "WORKER_FAILED") {
                console.warn("[pdf] worker render failed, retrying in-process:", (error as Error).message);
            }
        }
    }

    return renderReportToBuffer(spec);
}

/**
 * Render a report and write it to the HTTP response.
 *
 * Errors are left to the caller so each report can answer with its own
 * message; this only owns the success path and the headers.
 */
export async function sendReport(res: Response, input: ReportBuilder | ReportSpec): Promise<void> {
    const spec = toSpec(input);
    const buffer = await renderReport(spec);

    const disposition = spec.disposition || "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `${disposition}; filename="${spec.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(buffer);
}
