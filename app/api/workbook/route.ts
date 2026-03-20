import fs from "node:fs";
import path from "node:path";
import { getWorkbookContextIfExists } from "@/lib/workbook-storage";

export const runtime = "nodejs";

const DEFAULT_WORKBOOK_PATH = path.join(
  process.cwd(),
  "data",
  "Investment-Tracker.xlsx"
);

export async function GET() {
  const workbookContext = await getWorkbookContextIfExists(DEFAULT_WORKBOOK_PATH);
  if (!workbookContext) {
    return new Response("Workbook not configured.", { status: 404 });
  }

  const fileBuffer = fs.readFileSync(workbookContext.localPath);

  return new Response(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Note: browsers still usually download .xlsx; the workbook viewer at /workbook is the “open in browser” experience.
      "Content-Disposition": `inline; filename="${workbookContext.workbookName}"`,
    },
  });
}
