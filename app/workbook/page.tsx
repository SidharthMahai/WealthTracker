import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { getWorkbookContextIfExists } from "@/lib/workbook-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_WORKBOOK_PATH = path.join(
  process.cwd(),
  "data",
  "Investment-Tracker.xlsx"
);

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: string
) {
  const value = searchParams?.[key];
  return typeof value === "string" ? value : "";
}

export default async function WorkbookPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workbookContext = await getWorkbookContextIfExists(DEFAULT_WORKBOOK_PATH);

  if (!workbookContext) {
    return (
      <main className="page-shell">
        <section className="panel workbook-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Workbook</p>
              <h2>No workbook configured</h2>
            </div>
            <p className="muted">
              On Vercel, set <strong>PORTFOLIO_BLOB_PATHNAME</strong> to a Blob
              pathname (recommended). Locally, set
              <strong> PORTFOLIO_WORKBOOK_PATH</strong> or generate
              <strong> data/Investment-Tracker.xlsx</strong> with
              <strong> npm run rebuild:workbook</strong>.
            </p>
          </div>

          <div className="workbook-actions">
            <a className="workbook-link" href="/" rel="noreferrer">
              Back to dashboard
            </a>
          </div>
        </section>
      </main>
    );
  }

  const fileBuffer = fs.readFileSync(workbookContext.localPath);
  const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;

  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const requestedSheet = getSearchParam(resolvedSearchParams, "sheet");
  const activeSheet = sheetNames.includes(requestedSheet)
    ? requestedSheet
    : (sheetNames[0] ?? "");

  const sheet = activeSheet ? workbook.Sheets[activeSheet] : undefined;
  const rawRows = sheet
    ? (XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
      }) as Array<Array<unknown>>)
    : [];

  const previewLimit = 80;
  const rows = rawRows.slice(0, previewLimit);
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);

  const headerCandidate = rows[0] ?? [];
  const hasHeader = headerCandidate.some(
    (cell) => String(cell ?? "").trim().length > 0
  );

  const header = hasHeader
    ? headerCandidate
    : Array.from({ length: maxColumns }, (_value, index) => `Col ${index + 1}`);

  const bodyRows = hasHeader ? rows.slice(1) : rows;

  return (
    <main className="page-shell">
      <section className="panel table-panel workbook-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Workbook</p>
            <h2>{workbookContext.workbookName}</h2>
          </div>
          <p className="muted">
            Previewing <strong>{activeSheet || "—"}</strong>. This view opens in
            the browser (no download).
          </p>
        </div>

        <div className="workbook-actions">
          <a
            className="workbook-link workbook-link-secondary"
            href="/"
            rel="noreferrer"
          >
            Back to dashboard
          </a>
          <a
            className="workbook-link"
            href="/api/workbook"
            target="_blank"
            rel="noreferrer"
          >
            Open .xlsx
          </a>
        </div>

        <div className="sheet-tabs" role="tablist" aria-label="Workbook sheets">
          {sheetNames.map((name) => {
            const href = `/workbook?sheet=${encodeURIComponent(name)}`;
            const active = name === activeSheet;

            return (
              <a
                key={name}
                className={`sheet-tab ${active ? "is-active" : ""}`}
                href={href}
                role="tab"
                aria-selected={active}
              >
                {name}
              </a>
            );
          })}
        </div>

        <div className="table-scroll">
          {maxColumns === 0 ? (
            <p className="muted">No preview available for this sheet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {header.map((cell, index) => (
                    <th key={index}>{String(cell ?? "") || `Col ${index + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {Array.from({ length: maxColumns }).map(
                      (_value, colIndex) => (
                        <td key={colIndex}>{String(row[colIndex] ?? "")}</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="muted workbook-footnote">
          Showing up to {previewLimit} rows for this sheet.
        </p>
      </section>
    </main>
  );
}
