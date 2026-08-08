/**
 * PDF Utilities
 *
 * Reports are described as a declarative spec (report-spec), rendered by
 * report-renderer, and executed on a worker thread by pdf-worker-pool so
 * document layout never blocks the API.
 */

export * from "./report-spec";
export * from "./report-theme";
export { renderReport, sendReport } from "./report";
export { renderReportToBuffer } from "./report-renderer";
export {
    warmUpPdfWorkers,
    shutdownPdfWorkers,
    isThreadedRenderingEnabled,
    getPoolSize,
} from "./pdf-worker-pool";
export { clearAssetCache } from "./report-assets";
export { getReportFontTheme, clearReportFontThemeCache } from "./report-fonts";
