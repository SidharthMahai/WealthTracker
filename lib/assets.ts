import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import { fetchDelhiGoldRate } from "@/lib/indian-gold";
import { getWorkbookContextOrThrow, persistWorkbookIfBlob } from "@/lib/workbook-storage";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cash"), balance: z.number().finite().nonnegative() }),
  z.object({ kind: z.literal("gold"), acquisition: z.enum(["Purchase", "Gift"]), grams: z.number().finite().positive(), karat: z.number().int().min(1).max(24), date: z.string().date() }),
]);

export async function assetSnapshot(input?: unknown) {
  const parsed = input === undefined ? null : schema.parse(input);
  const context = await getWorkbookContextOrThrow(path.join(process.cwd(), "data", "Investment-Tracker.xlsx"));
  try {
    const workbook = XLSX.read(fs.readFileSync(context.localPath), { type: "buffer" });
    let cash = Number(workbook.Sheets["Cash Holdings"]?.B2?.v ?? 0);
    const gold = workbook.Sheets["Physical Gold"] ? XLSX.utils.sheet_to_json<{ date: string; acquisition: string; grams: number; karat: number }>(workbook.Sheets["Physical Gold"]) : [];
    if (parsed?.kind === "cash") cash = parsed.balance;
    if (parsed?.kind === "gold") gold.push({ date: parsed.date, acquisition: parsed.acquisition, grams: parsed.grams, karat: parsed.karat });
    if (parsed) {
      for (const [name, sheet] of [
        ["Cash Holdings", XLSX.utils.aoa_to_sheet([["Asset", "Balance"], ["Cash in hand", cash]])],
        ["Physical Gold", XLSX.utils.json_to_sheet(gold)],
      ] as const) {
        if (!workbook.SheetNames.includes(name)) workbook.SheetNames.push(name);
        workbook.Sheets[name] = sheet;
      }
      fs.writeFileSync(context.localPath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
      await persistWorkbookIfBlob(context);
    }
    let rate: number | null = null;
    let asOf: string | null = null;
    try {
      const quote = await fetchDelhiGoldRate();
      rate = quote.rate;
      asOf = quote.asOf;
    } catch {}
    const pureGrams = gold.reduce((total, item) => total + Number(item.grams) * Number(item.karat) / 24, 0);
    return { cash, gold, rate, asOf, goldValue: pureGrams === 0 ? 0 : rate === null ? null : pureGrams * rate };
  } finally {
    if (context.storage === "blob") fs.rmSync(context.localPath, { force: true });
  }
}
