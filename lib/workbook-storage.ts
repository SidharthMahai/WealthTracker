import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { get, put } from "@vercel/blob";

type WorkbookAccess = "private" | "public";

export type WorkbookContext = {
  localPath: string;
  workbookName: string;
  workbookPathLabel: string;
  storage: "local" | "blob";
  blobPathname?: string;
  blobAccess?: WorkbookAccess;
};

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function getConfiguredWorkbookPathLabel(defaultWorkbookPath: string) {
  const blobPathname = process.env.PORTFOLIO_BLOB_PATHNAME;
  if (blobPathname) {
    return `vercel-blob:${blobPathname}`;
  }

  return process.env.PORTFOLIO_WORKBOOK_PATH ?? defaultWorkbookPath;
}

function getBlobAccess(): WorkbookAccess {
  return process.env.PORTFOLIO_BLOB_ACCESS === "public" ? "public" : "private";
}

async function downloadWorkbookBlobToTemp(
  pathname: string,
  access: WorkbookAccess
): Promise<string | null> {
  const result = await get(pathname, { access });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const safeName = path.basename(pathname || "Investment-Tracker.xlsx");
  const base = safeName.replace(/\.xlsx$/i, "") || "Investment-Tracker";
  const tmpName = `${base}-${crypto.randomUUID()}.xlsx`;
  const tmpPath = path.join(os.tmpdir(), tmpName);

  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

export async function getWorkbookContextIfExists(
  defaultWorkbookPath: string
): Promise<WorkbookContext | null> {
  const blobPathname = process.env.PORTFOLIO_BLOB_PATHNAME;
  if (blobPathname) {
    const access = getBlobAccess();
    const localPath = await downloadWorkbookBlobToTemp(blobPathname, access);
    if (!localPath) {
      return null;
    }

    return {
      localPath,
      workbookName: path.basename(blobPathname),
      workbookPathLabel: `vercel-blob:${blobPathname}`,
      storage: "blob",
      blobPathname,
      blobAccess: access,
    };
  }

  const workbookPath = process.env.PORTFOLIO_WORKBOOK_PATH ?? defaultWorkbookPath;
  if (!fs.existsSync(workbookPath)) {
    return null;
  }

  return {
    localPath: workbookPath,
    workbookName: path.basename(workbookPath),
    workbookPathLabel: workbookPath,
    storage: "local",
  };
}

export async function getWorkbookContextOrThrow(
  defaultWorkbookPath: string
): Promise<WorkbookContext> {
  const context = await getWorkbookContextIfExists(defaultWorkbookPath);
  if (!context) {
    throw new Error(
      "Workbook not found. Upload it to Vercel Blob (PORTFOLIO_BLOB_PATHNAME) or set PORTFOLIO_WORKBOOK_PATH."
    );
  }

  return context;
}

export async function persistWorkbookIfBlob(context: WorkbookContext) {
  if (context.storage !== "blob" || !context.blobPathname || !context.blobAccess) {
    return;
  }

  const fileBuffer = fs.readFileSync(context.localPath);

  await put(context.blobPathname, new Blob([fileBuffer], { type: XLSX_CONTENT_TYPE }), {
    access: context.blobAccess,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: XLSX_CONTENT_TYPE,
    cacheControlMaxAge: 0,
  });
}
