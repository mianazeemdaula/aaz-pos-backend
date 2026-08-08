/**
 * Smoke test for the report pipeline.
 *
 *   npx ts-node --transpile-only scripts/pdf-smoke.ts
 *
 * Renders a large report twice — once in-process, once on a worker thread —
 * and reports how long the main thread was stalled in each case.
 */
import fs from "fs";
import path from "path";
import { ReportBuilder, TableCell } from "../src/utils/pdf/report-spec";
import { renderReportToBuffer } from "../src/utils/pdf/report-renderer";
import { renderOnWorker, shutdownPdfWorkers, isThreadedRenderingEnabled } from "../src/utils/pdf/pdf-worker-pool";

const ROWS = Number(process.argv[2] || 4000);

function buildSpec() {
    const report = new ReportBuilder({
        title: "Sales Report",
        subtitle: "Sales transaction summary",
        filename: "smoke.pdf",
        orientation: "landscape",
        company: { name: "Ali Traders", address: "Ghala Mandi Road, Depalpur", phone: "0342-4818064" },
        logoPath: path.join(__dirname, "../logo/logo.jpg"),
        stamp: "Generated 08 Aug 2026, 03:12 PM",
        filters: { From: "01 Jan 2026", To: "31 Jan 2026", Cashier: "All", Transactions: ROWS },
    });

    report.stats([
        { label: "Total Revenue", value: "12,480,300", tone: "primary", note: `${ROWS} transactions` },
        { label: "Amount Collected", value: "11,004,120", tone: "success" },
        { label: "Outstanding Due", value: "1,476,180", tone: "danger" },
        { label: "Discounts Given", value: "233,900", tone: "warning" },
        { label: "Tax Charged", value: "402,110" },
        { label: "Cost of Goods", value: "9,112,400", tone: "muted" },
        { label: "Gross Profit", value: "3,367,900", tone: "success", note: "27.0% margin" },
    ]);

    report.section("Payment Method Breakdown", "Net amount collected per account");
    report.table({
        columns: [
            { label: "Payment Account / Method", width: 220 },
            { label: "Net Amount Collected", width: 150, align: "right" },
            { label: "", width: "*" },
        ],
        rows: [
            ["Cash", "8,220,100", ""],
            ["Meezan Bank — 0123", "2,110,000", ""],
            ["EasyPaisa", "674,020", ""],
        ],
        totalRow: [{ text: "Total Collected" }, { text: "11,004,120", align: "right" }, ""],
    });

    report.section("Transactions", `${ROWS} record(s)`);
    const rows: TableCell[][] = [];
    for (let i = 0; i < ROWS; i++) {
        rows.push([
            String(i + 1),
            "08-08-2026 03:12 PM",
            i % 7 === 0 ? "محمد اکرم" : `Customer ${i + 1}`,
            "Kashif",
            String((i % 9) + 1),
            "120",
            "45",
            "3,420",
            "3,000",
            { text: "420", align: "right", tone: "danger" },
        ]);
    }
    report.table({
        columns: [
            { label: "#", width: 26, align: "center" },
            { label: "Date", width: 100 },
            { label: "Customer", width: "*" },
            { label: "Cashier", width: 85 },
            { label: "Items", width: 38, align: "center" },
            { label: "Discount", width: 62, align: "right" },
            { label: "Tax", width: 58, align: "right" },
            { label: "Total", width: 72, align: "right" },
            { label: "Paid", width: 72, align: "right" },
            { label: "Due", width: 68, align: "right" },
        ],
        rows,
        totalRow: [{ text: "Grand Total", colSpan: 5 }, "233,900", "402,110", "12,480,300", "11,004,120", "1,476,180"],
    });

    return report.spec;
}

/**
 * Time a render, separating the part that runs on the main thread from the
 * wall clock. `blockMs` is what actually matters: for as long as it lasts, no
 * other HTTP request can be served.
 */
async function timed(label: string, start: () => Promise<Buffer>) {
    const t0 = Date.now();
    const pending = start();
    const blockMs = Date.now() - t0;
    const buffer = await pending;
    const totalMs = Date.now() - t0;
    console.log(
        `${label.padEnd(7)}: ${String(totalMs).padStart(5)}ms total, ` +
            `${String(blockMs).padStart(5)}ms blocking the main thread, ` +
            `${(buffer.length / 1024).toFixed(0)}KB`
    );
    return buffer;
}

async function main() {
    const spec = buildSpec();
    const outDir = path.join(__dirname, "../.pdf-smoke");
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`rows=${ROWS} threading=${isThreadedRenderingEnabled()}`);

    // Warm the worker so the measurement is about layout, not module loading.
    await renderOnWorker({ ...spec, blocks: spec.blocks.slice(0, 1) });

    const threaded = await timed("worker", () => renderOnWorker(spec));
    fs.writeFileSync(path.join(outDir, "threaded.pdf"), threaded);

    const inline = await timed("inline", () => renderReportToBuffer(spec));
    fs.writeFileSync(path.join(outDir, "inline.pdf"), inline);

    console.log(`output : ${outDir}`);

    await shutdownPdfWorkers();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
