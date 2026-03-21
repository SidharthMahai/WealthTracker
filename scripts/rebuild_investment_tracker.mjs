import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx/xlsx.mjs";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATEMENTS_DIR = process.env.STATEMENTS_DIR
  ? path.resolve(process.env.STATEMENTS_DIR)
  : path.join(REPO_DIR, "statements");
const EXTRACTOR_PATH = path.join(REPO_DIR, "scripts", "extract_pdf_text.swift");
const OUTPUT_WORKBOOK_PATH = path.join(REPO_DIR, "data", "Investment-Tracker.xlsx");

const DATE_ONLY_RE = /^\d{2}-[A-Za-z]{3}-\d{4}$/;
const OPENING_RE = /^Opening Balance as on\s+(.+?)\s+([\d,.]+)$/;
const FOLIO_RE =
  /^Folio Number:\s*(.+?)\s+\((?:Hide|Show) Historic Transactions\)\s+Statement Date:\s*(\d{2}-[A-Za-z]{3}-\d{4})$/;
const SUMMARY_RE =
  /^Current Unit Balance:\s*([\d,.]+)\s*\|\s*NAV\s+\(([^)]+)\):\s*([\d,.]+)\s*\|\s*Cost Value:\s*\[\s*([\d,.]+)\s*\]\s*\|\s*Current Value:\s*\[\s*([\d,.]+)\s*\]$/;
const TX_RE =
  /^(?:(\d{2}-[A-Za-z]{3}-\d{4})\s+)?(.+?)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)$/;
const GROSS_INVESTMENT_RE =
  /^Gross Investment Amount\s+([\d,]+\.\d+);\s*Stamp Duty charges levied\s+([\d,]+\.\d+)$/i;
const NET_AMOUNT_RE = /^Net Amount\s+([\d,]+\.\d+);\s*STT Paid\s+([\d,]+\.\d+)$/i;
const GROSS_AMOUNT_RE = /^Gross Amount\s+([\d,]+\.\d+);\s*STT Paid\s+([\d,]+\.\d+)$/i;

const monthMap = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function main() {
  const sections = loadSections();
  const funds = [];
  const transactions = [];
  const auditRows = [];

  sections.forEach((section, index) => {
    const fundId = `FUND-${String(index + 1).padStart(3, "0")}`;
    const parsed = parseSection(section, fundId);
    funds.push(parsed.fund);
    transactions.push(...parsed.transactions);
    auditRows.push(parsed.audit);
  });

  const summaryByFund = funds.map((fund) => {
    const fundTransactions = transactions.filter(
      (transaction) => transaction.fundId === fund.fundId
    );
    const contributions = sumBy(fundTransactions, (transaction) =>
      transaction.direction === "Contribution" ? transaction.normalizedAmount : 0
    );
    const redemptions = sumBy(fundTransactions, (transaction) =>
      transaction.direction === "Redemption" ? transaction.normalizedAmount : 0
    );
    const netCashFlow = contributions - redemptions;
    const unrealizedProfitLoss = roundToTwo(fund.currentValue - fund.holdingCost);
    const absoluteReturn =
      fund.holdingCost === 0 ? 0 : roundToSix(unrealizedProfitLoss / fund.holdingCost);

    return {
      fundId: fund.fundId,
      fundName: fund.fundName,
      category: fund.category,
      assetType: fund.assetType,
      folioNumber: fund.folioNumber,
      startDate: fund.startDate,
      statementDate: fund.statementDate,
      latestNavDate: fund.latestNavDate,
      transactionCount: fundTransactions.length,
      totalContributions: contributions,
      totalRedemptions: redemptions,
      netCashFlow,
      holdingCost: fund.holdingCost,
      currentUnits: fund.currentUnits,
      latestNav: fund.latestNav,
      currentValue: fund.currentValue,
      unrealizedProfitLoss,
      absoluteReturn,
    };
  });

  const summaryByYear = buildSummaryByYear(transactions);
  const workbook = XLSX.utils.book_new();

  appendSheet(
    workbook,
    "Instructions",
    [
      ["Investment Tracker"],
      [
        "This workbook is rebuilt from your fund statement PDFs and keeps one row per actual transaction.",
      ],
      [
        "Normalized Amount stores the rounded cash value you asked for, while Cash Amount Exact / Statement Amount preserve the audit trail.",
      ],
      [
        "Funds is the latest statement snapshot. Transactions is the detailed ledger. Summary sheets are organized views for analysis and the app.",
      ],
      [
        "If a new statement is added later, rerun scripts/rebuild_investment_tracker.mjs to refresh the workbook from source PDFs.",
      ],
    ],
    [120]
  );

  appendSheet(
    workbook,
    "Funds",
    [
      [
        "Fund ID",
        "Fund Name",
        "Category",
        "Asset Type",
        "Folio Number",
        "Start Date",
        "Statement Date",
        "Latest NAV Date",
        "Current Units",
        "Latest NAV",
        "Holding Cost",
        "Current Value",
        "Unrealized P/L",
        "Absolute Return",
      ],
      ...summaryByFund.map((fund) => [
        fund.fundId,
        fund.fundName,
        fund.category,
        fund.assetType,
        fund.folioNumber,
        fund.startDate,
        fund.statementDate,
        fund.latestNavDate,
        fund.currentUnits,
        fund.latestNav,
        fund.holdingCost,
        fund.currentValue,
        fund.unrealizedProfitLoss,
        fund.absoluteReturn,
      ]),
    ],
    [14, 34, 24, 16, 18, 14, 14, 14, 14, 12, 14, 14, 14, 14]
  );

  appendSheet(
    workbook,
    "Transactions",
    [
      [
        "Entry ID",
        "Transaction Date",
        "Financial Year",
        "Fund ID",
        "Fund Name",
        "Transaction Type",
        "Direction",
        "Normalized Amount",
        "Cash Amount Exact",
        "Statement Amount",
        "Charges",
        "Units",
        "NAV",
        "Balance Units",
        "Folio Number",
        "Notes",
        "Source File",
      ],
      ...transactions.map((transaction) => [
        transaction.entryId,
        transaction.transactionDate,
        transaction.financialYear,
        transaction.fundId,
        transaction.fundName,
        transaction.transactionType,
        transaction.direction,
        transaction.normalizedAmount,
        transaction.cashAmountExact,
        transaction.statementAmount,
        transaction.charges,
        transaction.units,
        transaction.nav,
        transaction.balanceUnits,
        transaction.folioNumber,
        transaction.notes,
        transaction.sourceFile,
      ]),
    ],
    [12, 14, 14, 12, 34, 24, 14, 16, 16, 16, 10, 12, 10, 14, 18, 42, 28]
  );

  appendSheet(
    workbook,
    "Summary by Fund",
    [
      [
        "Fund ID",
        "Fund Name",
        "Category",
        "Contributions",
        "Redemptions",
        "Net Cash Flow",
        "Holding Cost",
        "Current Value",
        "Unrealized P/L",
        "Absolute Return",
        "Transactions",
      ],
      ...summaryByFund.map((fund) => [
        fund.fundId,
        fund.fundName,
        fund.category,
        fund.totalContributions,
        fund.totalRedemptions,
        fund.netCashFlow,
        fund.holdingCost,
        fund.currentValue,
        fund.unrealizedProfitLoss,
        fund.absoluteReturn,
        fund.transactionCount,
      ]),
      [
        "TOTAL",
        "",
        "",
        sumBy(summaryByFund, (fund) => fund.totalContributions),
        sumBy(summaryByFund, (fund) => fund.totalRedemptions),
        sumBy(summaryByFund, (fund) => fund.netCashFlow),
        sumBy(summaryByFund, (fund) => fund.holdingCost),
        sumBy(summaryByFund, (fund) => fund.currentValue),
        sumBy(summaryByFund, (fund) => fund.unrealizedProfitLoss),
        roundToSix(
          sumBy(summaryByFund, (fund) => fund.holdingCost) === 0
            ? 0
            : sumBy(summaryByFund, (fund) => fund.unrealizedProfitLoss) /
                sumBy(summaryByFund, (fund) => fund.holdingCost)
        ),
        transactions.length,
      ],
    ],
    [14, 34, 24, 14, 14, 14, 14, 14, 14, 14, 12]
  );

  appendSheet(
    workbook,
    "Summary by Year",
    [
      [
        "Financial Year",
        "Contributions",
        "Redemptions",
        "Net Cash Flow",
        "Transaction Count",
      ],
      ...summaryByYear.map((row) => [
        row.financialYear,
        row.contributions,
        row.redemptions,
        row.netCashFlow,
        row.transactionCount,
      ]),
    ],
    [14, 14, 14, 14, 14]
  );

  appendSheet(
    workbook,
    "Import Audit",
    [
      [
        "Fund ID",
        "Fund Name",
        "Source File",
        "Folio Number",
        "Statement Date",
        "Start Date",
        "Last Transaction Date",
        "Imported Transactions",
        "Contribution Total",
        "Redemption Total",
        "Current Units",
        "Last Balance Units",
        "Units Check",
        "Latest NAV",
        "Current Value",
        "Calculated Value",
        "Value Check",
      ],
      ...auditRows.map((row) => [
        row.fundId,
        row.fundName,
        row.sourceFile,
        row.folioNumber,
        row.statementDate,
        row.startDate,
        row.lastTransactionDate,
        row.importedTransactions,
        row.contributionTotal,
        row.redemptionTotal,
        row.currentUnits,
        row.lastBalanceUnits,
        row.unitsCheck,
        row.latestNav,
        row.currentValue,
        row.calculatedValue,
        row.valueCheck,
      ]),
    ],
    [14, 34, 28, 18, 14, 14, 18, 16, 16, 16, 14, 16, 12, 12, 14, 16, 12]
  );

  const workbookBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  fs.mkdirSync(path.dirname(OUTPUT_WORKBOOK_PATH), { recursive: true });

  fs.writeFileSync(OUTPUT_WORKBOOK_PATH, workbookBuffer);
  console.log(`Created ${OUTPUT_WORKBOOK_PATH}`);
}

function loadSections() {
  const pdfFiles = fs
    .readdirSync(STATEMENTS_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort();

  const sections = [];
  for (const fileName of pdfFiles) {
    const text = extractPdfText(path.join(STATEMENTS_DIR, fileName));
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const openingIndices = [];
    const summaryIndices = [];
    lines.forEach((line, index) => {
      if (line.startsWith("Opening Balance as on")) {
        openingIndices.push(index);
      }
      if (line.startsWith("Current Unit Balance:")) {
        summaryIndices.push(index);
      }
    });

    if (openingIndices.length === 0 || summaryIndices.length === 0) {
      throw new Error(`No statement sections found in ${fileName}`);
    }

    if (openingIndices.length !== summaryIndices.length) {
      throw new Error(
        `Mismatched opening/summary sections in ${fileName}: ${openingIndices.length} openings, ${summaryIndices.length} summaries`
      );
    }

    let sectionStart = 0;
    openingIndices.forEach((openingIndex, sectionIndex) => {
      const summaryIndex = summaryIndices[sectionIndex];
      const folioLine = [...lines.slice(0, openingIndex)]
        .reverse()
        .find((line) => line.startsWith("Folio Number:"));

      sections.push({
        sourceFile: fileName,
        folioLine: folioLine ?? "",
        lines: lines.slice(sectionStart, summaryIndex + 1),
      });

      sectionStart = summaryIndex + 1;
    });
  }

  return sections;
}

function parseSection(section, fundId) {
  const { lines, sourceFile } = section;
  const folioLine =
    lines.find((line) => line.startsWith("Folio Number:")) ?? section.folioLine;
  const folioMatch = folioLine?.match(FOLIO_RE);
  if (!folioMatch) {
    throw new Error(`Unable to parse folio line in ${sourceFile}`);
  }

  const [, folioNumber, statementDateRaw] = folioMatch;
  const statementDate = toIsoDate(statementDateRaw);

  const fundNameLine = lines.find(
    (line) =>
      /Fund/i.test(line) &&
      !line.startsWith("Folio Number:") &&
      !line.startsWith("Opening Balance as on") &&
      !line.startsWith("Current Unit Balance:")
  );

  if (!fundNameLine) {
    throw new Error(`Unable to find fund name in ${sourceFile}`);
  }

  const fundName = cleanFundName(fundNameLine);
  const category = cleanCategory(lines);
  const assetType = "Mutual Fund";

  const openingLine = lines.find((line) => line.startsWith("Opening Balance as on"));
  const openingMatch = openingLine?.match(OPENING_RE);
  if (!openingMatch) {
    throw new Error(`Unable to parse opening balance in ${sourceFile}`);
  }

  const startDate = toIsoDate(openingMatch[1].replace(/\./g, "-"));

  const summaryLine = lines.find((line) => line.startsWith("Current Unit Balance:"));
  const summaryMatch = summaryLine?.match(SUMMARY_RE);
  if (!summaryMatch) {
    throw new Error(`Unable to parse summary line in ${sourceFile}`);
  }

  const [
    ,
    currentUnitsRaw,
    latestNavDateRaw,
    latestNavRaw,
    holdingCostRaw,
    currentValueRaw,
  ] = summaryMatch;

  const parsedTransactions = parseTransactions(lines, {
    fundId,
    fundName,
    folioNumber,
    sourceFile,
  });

  const contributionTotal = sumBy(parsedTransactions, (transaction) =>
    transaction.direction === "Contribution" ? transaction.normalizedAmount : 0
  );
  const redemptionTotal = sumBy(parsedTransactions, (transaction) =>
    transaction.direction === "Redemption" ? transaction.normalizedAmount : 0
  );
  const lastBalanceUnits =
    parsedTransactions.length === 0
      ? 0
      : parsedTransactions[parsedTransactions.length - 1].balanceUnits;

  const currentUnits = toNumber(currentUnitsRaw);
  const latestNav = toNumber(latestNavRaw);
  const holdingCost = toNumber(holdingCostRaw);
  const currentValue = toNumber(currentValueRaw);
  const latestNavDate = toIsoDate(latestNavDateRaw.replace(/\./g, "-"));
  const calculatedValue = roundToTwo(currentUnits * latestNav);

  return {
    fund: {
      fundId,
      fundName,
      category,
      assetType,
      folioNumber,
      startDate,
      statementDate,
      latestNavDate,
      currentUnits,
      latestNav,
      holdingCost,
      currentValue,
    },
    transactions: parsedTransactions,
    audit: {
      fundId,
      fundName,
      sourceFile,
      folioNumber,
      statementDate,
      startDate,
      lastTransactionDate:
        parsedTransactions[parsedTransactions.length - 1]?.transactionDate ?? "",
      importedTransactions: parsedTransactions.length,
      contributionTotal,
      redemptionTotal,
      currentUnits,
      lastBalanceUnits,
      unitsCheck: nearlyEqual(currentUnits, lastBalanceUnits) ? "OK" : "CHECK",
      latestNav,
      currentValue,
      calculatedValue,
      valueCheck: nearlyEqual(currentValue, calculatedValue, 2) ? "OK" : "CHECK",
    },
  };
}

function parseTransactions(lines, sectionInfo) {
  const openingIndex = lines.findIndex((line) => line.startsWith("Opening Balance as on"));
  const summaryIndex = lines.findIndex((line) => line.startsWith("Current Unit Balance:"));
  const body = lines.slice(openingIndex + 1, summaryIndex);

  const transactions = [];
  let pendingDate = null;
  let currentTransaction = null;

  for (const line of body) {
    if (DATE_ONLY_RE.test(line)) {
      if (currentTransaction && !currentTransaction.transactionDate) {
        currentTransaction.transactionDate = toIsoDate(line);
        currentTransaction.financialYear = getFinancialYear(
          currentTransaction.transactionDate
        );
      } else {
        pendingDate = line;
      }
      continue;
    }

    const grossInvestmentMatch = line.match(GROSS_INVESTMENT_RE);
    if (grossInvestmentMatch && currentTransaction) {
      currentTransaction.cashAmountExact = toNumber(grossInvestmentMatch[1]);
      currentTransaction.charges = toNumber(grossInvestmentMatch[2]);
      currentTransaction.normalizedAmount = Math.round(
        currentTransaction.cashAmountExact
      );
      currentTransaction.notes = line;
      continue;
    }

    const netAmountMatch = line.match(NET_AMOUNT_RE);
    if (netAmountMatch && currentTransaction) {
      currentTransaction.cashAmountExact = toNumber(netAmountMatch[1]);
      currentTransaction.charges = toNumber(netAmountMatch[2]);
      currentTransaction.normalizedAmount = Math.round(
        currentTransaction.cashAmountExact
      );
      currentTransaction.notes = line;
      continue;
    }

    const grossAmountMatch = line.match(GROSS_AMOUNT_RE);
    if (grossAmountMatch && currentTransaction) {
      currentTransaction.charges = toNumber(grossAmountMatch[2]);
      currentTransaction.notes = line;
      continue;
    }

    const transactionMatch = line.match(TX_RE);
    if (!transactionMatch) {
      continue;
    }

    const [
      ,
      inlineDate,
      transactionTypeRaw,
      unitsRaw,
      navRaw,
      statementAmountRaw,
      balanceUnitsRaw,
    ] = transactionMatch;

    const transactionType = transactionTypeRaw.trim();
    const direction = /redemption/i.test(transactionType)
      ? "Redemption"
      : "Contribution";
    const transactionDate = inlineDate
      ? toIsoDate(inlineDate)
      : pendingDate
        ? toIsoDate(pendingDate)
        : "";

    const statementAmount = toNumber(statementAmountRaw);
    const units = toNumber(unitsRaw);
    const nav = toNumber(navRaw);
    const balanceUnits = toNumber(balanceUnitsRaw);

    currentTransaction = {
      entryId: `TXN-${String(transactions.length + 1).padStart(4, "0")}`,
      transactionDate,
      financialYear: transactionDate ? getFinancialYear(transactionDate) : "",
      fundId: sectionInfo.fundId,
      fundName: sectionInfo.fundName,
      transactionType,
      direction,
      normalizedAmount: Math.round(statementAmount),
      cashAmountExact: statementAmount,
      statementAmount,
      charges: 0,
      units,
      nav,
      balanceUnits,
      folioNumber: sectionInfo.folioNumber,
      notes: "",
      sourceFile: sectionInfo.sourceFile,
    };

    pendingDate = null;
    if (units === 0 && statementAmount === 0) {
      continue;
    }
    transactions.push(currentTransaction);
  }

  return transactions;
}

function extractPdfText(pdfPath) {
  return execFileSync("swift", [EXTRACTOR_PATH, pdfPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: "/tmp/wealthtracker-home",
      SWIFT_MODULE_CACHE_PATH: "/tmp/wealthtracker-module-cache",
      CLANG_MODULE_CACHE_PATH: "/tmp/wealthtracker-module-cache",
    },
  });
}

function cleanFundName(rawLine) {
  const cleaned = rawLine
    .replace(/\[ Details \]/gi, "")
    .replace(/\[ Details\]/gi, "")
    .replace(/\s*\|\s*ISIN:.*$/i, "")
    .replace(/\s*MF-[A-Za-z/ -]+$/i, "")
    .replace(/\s*-\s*Reg\s*-\s*Gr/gi, "")
    .replace(/\s*-\s*Reg\s*-\s*Gr\s*/gi, " ")
    .replace(/\s*-\s*Gr/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned === cleaned.toUpperCase() ? toTitleCase(cleaned) : cleaned;
}

function cleanCategory(lines) {
  const categoryLine = lines.find((line) => line.includes("MF-") && line.includes("ISIN"));
  if (!categoryLine) {
    return "Mutual Fund";
  }
  const match = categoryLine.match(/MF-([^|]+)/);
  return match ? match[1].trim() : "Mutual Fund";
}

function buildSummaryByYear(transactions) {
  const yearMap = new Map();
  for (const transaction of transactions) {
    const current = yearMap.get(transaction.financialYear) ?? {
      financialYear: transaction.financialYear,
      contributions: 0,
      redemptions: 0,
      netCashFlow: 0,
      transactionCount: 0,
    };

    if (transaction.direction === "Contribution") {
      current.contributions += transaction.normalizedAmount;
      current.netCashFlow += transaction.normalizedAmount;
    } else {
      current.redemptions += transaction.normalizedAmount;
      current.netCashFlow -= transaction.normalizedAmount;
    }

    current.transactionCount += 1;
    yearMap.set(transaction.financialYear, current);
  }

  return Array.from(yearMap.values()).sort((left, right) =>
    left.financialYear.localeCompare(right.financialYear)
  );
}

function appendSheet(workbook, name, rows, widths) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = widths.map((width) => ({ wch: width }));
  if (rows.length > 1) {
    worksheet["!autofilter"] = {
      ref: `A1:${XLSX.utils.encode_cell({
        c: rows[0].length - 1,
        r: rows.length - 1,
      })}`,
    };
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

function toNumber(value) {
  return Number(String(value).replace(/,/g, ""));
}

function toIsoDate(rawDate) {
  const match = rawDate.match(/^(\d{2})[-.]([A-Za-z]{3})[-.](\d{4})$/);
  if (!match) {
    throw new Error(`Unable to parse date: ${rawDate}`);
  }

  const [, day, month, year] = match;
  const monthIndex = monthMap[month];
  if (monthIndex === undefined) {
    throw new Error(`Unknown month in date: ${rawDate}`);
  }

  const date = new Date(Date.UTC(Number(year), monthIndex, Number(day)));
  return date.toISOString().slice(0, 10);
}

function getFinancialYear(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function sumBy(items, getter) {
  return roundToTwo(items.reduce((total, item) => total + getter(item), 0));
}

function nearlyEqual(left, right, precision = 0.01) {
  return Math.abs(left - right) <= precision;
}

function roundToTwo(value) {
  return Number(value.toFixed(2));
}

function roundToSix(value) {
  return Number(value.toFixed(6));
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (!word) {
        return word;
      }
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

main();
