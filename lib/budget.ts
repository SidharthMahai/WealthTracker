import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  getConfiguredWorkbookPathLabel,
  getWorkbookContextIfExists,
  getWorkbookContextOrThrow,
  persistWorkbookIfBlob,
} from "@/lib/workbook-storage";
import type {
  BudgetPlannerData,
  BudgetPlannerItem,
  NewBudgetPlannerItemInput,
} from "@/lib/types";

const DEFAULT_WORKBOOK_PATH = path.join(process.cwd(), "data", "Investment-Tracker.xlsx");
const BUDGET_SHEET_NAME = "Budget Planner";

const budgetItemSchema = z.object({
  category: z.string().trim().min(1),
  type: z.enum(["Fixed", "Variable"]),
  monthlyAmountUsd: z.number().nonnegative(),
  notes: z.string().trim().optional().default(""),
});

function buildEmptyBudgetPlannerData(): BudgetPlannerData {
  const configuredPath = getConfiguredWorkbookPathLabel(DEFAULT_WORKBOOK_PATH);

  return {
    workbookName: "No workbook configured",
    workbookPath: configuredPath,
    items: [],
    totals: {
      fixedMonthlyUsd: 0,
      variableMonthlyUsd: 0,
      totalMonthlyUsd: 0,
    },
  };
}

export async function getBudgetPlannerData(): Promise<BudgetPlannerData> {
  const workbookContext = await getWorkbookContextIfExists(DEFAULT_WORKBOOK_PATH);
  if (!workbookContext) {
    return buildEmptyBudgetPlannerData();
  }

  const workbook = readWorkbook(workbookContext.localPath);
  const items = parseBudgetPlannerSheet(workbook);
  return buildBudgetPlannerData(workbookContext.workbookName, workbookContext.workbookPathLabel, items);
}

export async function addBudgetPlannerItem(input: NewBudgetPlannerItemInput) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbook = readWorkbook(workbookContext.localPath);
  const items = parseBudgetPlannerSheet(workbook);
  const parsed = budgetItemSchema.parse(input);

  const newItem: BudgetPlannerItem = {
    itemId: getNextBudgetItemId(items),
    category: parsed.category,
    type: parsed.type,
    monthlyAmountUsd: roundToTwo(parsed.monthlyAmountUsd),
    notes: parsed.notes,
  };

  const updatedItems = [...items, newItem];
  writeBudgetPlannerSheet(workbookContext.localPath, workbook, updatedItems);
  await persistWorkbookIfBlob(workbookContext);

  return {
    itemId: newItem.itemId,
    budget: buildBudgetPlannerData(
      workbookContext.workbookName,
      workbookContext.workbookPathLabel,
      updatedItems
    ),
  };
}

export async function updateBudgetPlannerItem(
  itemId: string,
  input: NewBudgetPlannerItemInput
) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbook = readWorkbook(workbookContext.localPath);
  const items = parseBudgetPlannerSheet(workbook);
  const parsed = budgetItemSchema.parse(input);
  const itemIndex = items.findIndex((item) => item.itemId === itemId);

  if (itemIndex === -1) {
    throw new Error("Budget item not found.");
  }

  const updatedItem: BudgetPlannerItem = {
    itemId,
    category: parsed.category,
    type: parsed.type,
    monthlyAmountUsd: roundToTwo(parsed.monthlyAmountUsd),
    notes: parsed.notes,
  };

  const updatedItems = items.slice();
  updatedItems[itemIndex] = updatedItem;

  writeBudgetPlannerSheet(workbookContext.localPath, workbook, updatedItems);
  await persistWorkbookIfBlob(workbookContext);

  return {
    itemId,
    budget: buildBudgetPlannerData(
      workbookContext.workbookName,
      workbookContext.workbookPathLabel,
      updatedItems
    ),
  };
}

export async function deleteBudgetPlannerItem(itemId: string) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbook = readWorkbook(workbookContext.localPath);
  const items = parseBudgetPlannerSheet(workbook);
  const updatedItems = items.filter((item) => item.itemId !== itemId);

  if (updatedItems.length === items.length) {
    throw new Error("Budget item not found.");
  }

  writeBudgetPlannerSheet(workbookContext.localPath, workbook, updatedItems);
  await persistWorkbookIfBlob(workbookContext);

  return {
    itemId,
    budget: buildBudgetPlannerData(
      workbookContext.workbookName,
      workbookContext.workbookPathLabel,
      updatedItems
    ),
  };
}

function readWorkbook(workbookPath: string) {
  const workbookBuffer = fs.readFileSync(workbookPath);
  return XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: false,
  });
}

function parseBudgetPlannerSheet(workbook: XLSX.WorkBook): BudgetPlannerItem[] {
  const sheet = workbook.Sheets[BUDGET_SHEET_NAME];
  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows
    .filter((row) => row["Item ID"] && row["Category"])
    .map((row) => {
      const type: BudgetPlannerItem["type"] =
        String(row["Type"] || "Variable") === "Fixed" ? "Fixed" : "Variable";

      return {
        itemId: String(row["Item ID"] || ""),
        category: String(row["Category"] || ""),
        type,
        monthlyAmountUsd: roundToTwo(toNumber(row["Monthly Amount USD"])),
        notes: String(row["Notes"] || ""),
      };
    })
    .sort((left, right) => left.category.localeCompare(right.category));
}

function writeBudgetPlannerSheet(
  workbookPath: string,
  workbook: XLSX.WorkBook,
  items: BudgetPlannerItem[]
) {
  workbook.Sheets[BUDGET_SHEET_NAME] = XLSX.utils.aoa_to_sheet([
    ["Item ID", "Category", "Type", "Monthly Amount USD", "Notes"],
    ...items.map((item) => [
      item.itemId,
      item.category,
      item.type,
      item.monthlyAmountUsd,
      item.notes,
    ]),
  ]);

  workbook.Sheets[BUDGET_SHEET_NAME]["!cols"] = [
    { wch: 14, hidden: true },
    { wch: 28 },
    { wch: 14 },
    { wch: 18 },
    { wch: 40 },
  ];
  if (!workbook.SheetNames.includes(BUDGET_SHEET_NAME)) {
    workbook.SheetNames.push(BUDGET_SHEET_NAME);
  }

  const workbookBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
  fs.writeFileSync(workbookPath, workbookBuffer);
}

function buildBudgetPlannerData(
  workbookName: string,
  workbookPath: string,
  items: BudgetPlannerItem[]
): BudgetPlannerData {
  const fixedMonthlyUsd = roundToTwo(
    items
      .filter((item) => item.type === "Fixed")
      .reduce((sum, item) => sum + item.monthlyAmountUsd, 0)
  );
  const variableMonthlyUsd = roundToTwo(
    items
      .filter((item) => item.type === "Variable")
      .reduce((sum, item) => sum + item.monthlyAmountUsd, 0)
  );

  return {
    workbookName,
    workbookPath,
    items,
    totals: {
      fixedMonthlyUsd,
      variableMonthlyUsd,
      totalMonthlyUsd: roundToTwo(fixedMonthlyUsd + variableMonthlyUsd),
    },
  };
}

function getNextBudgetItemId(items: BudgetPlannerItem[]) {
  const highest = items.reduce((current, item) => {
    const match = item.itemId.match(/(\d+)$/);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);

  return `BUDGET-${String(highest + 1).padStart(4, "0")}`;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundToTwo(value: number) {
  return Number(value.toFixed(2));
}
