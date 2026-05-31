import fs from "node:fs";
import path from "node:path";
import {
  getConfiguredWorkbookPathLabel,
  getWorkbookContextIfExists,
  getWorkbookContextOrThrow,
  persistWorkbookIfBlob,
} from "@/lib/workbook-storage";
import * as XLSX from "xlsx";
import { z } from "zod";
import type {
  DashboardData,
  FundRecord,
  FundSummary,
  NewFundInput,
  NewTransactionInput,
  TransactionRecord,
} from "@/lib/types";
import type { WorkbookContext } from "@/lib/workbook-storage";
import { fetchStockInrQuote, fetchUsdInrFx } from "@/lib/market-data";

const DEFAULT_WORKBOOK_PATH = path.join(process.cwd(), "data", "Investment-Tracker.xlsx");

const transactionSchema = z.object({
  transactionDate: z.string().min(1),
  fundId: z.string().min(1),
  amountInvested: z.number().positive(),
  direction: z.enum(["Contribution", "Redemption"]).default("Contribution"),
  transactionType: z
    .string()
    .trim()
    .min(1)
    .transform(normalizeTransactionType)
    .default("Purchase"),
  units: z.number().nonnegative().optional(),
  nav: z.number().nonnegative().optional(),
  currentNav: z.number().nonnegative().optional(),
});

type TransactionInput = z.infer<typeof transactionSchema>;

const updateNavSchema = z.object({
  fundId: z.string().min(1),
  latestNav: z.number().positive(),
  latestNavDate: z.string().min(1),
});

const newFundSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  assetType: z.enum([
    "Mutual Fund",
    "Govt Scheme",
    "Stock",
    "Bank Account (INR)",
    "Bank Account (USD)",
  ]),
  folioNumber: z.string().trim().optional().default(""),
  accountNumber: z.string().trim().optional().default(""),
  ifscCode: z.string().trim().optional().default(""),
  startDate: z.string().min(1),
  latestNav: z.number().positive().optional(),
  currentBalance: z.number().nonnegative().optional(),
});

type FundPosition = {
  costBasis: number;
  units: number;
};

type StockInrQuote = Awaited<ReturnType<typeof fetchStockInrQuote>>;

type UsdBankQuote = {
  balanceUsd: number;
  fxInrPerUsd: number;
  valueInr: number;
  asOf: string;
};

function buildEmptyDashboardData(): DashboardData {
  const configuredPath = getConfiguredWorkbookPathLabel(DEFAULT_WORKBOOK_PATH);

  return {
    workbookName: "No workbook configured",
    workbookPath: configuredPath,
    metrics: {
      mutualFundPurchaseValue: 0,
      mutualFundCurrentValue: 0,
      mutualFundProfitLoss: 0,
      mutualFundAbsoluteReturn: 0,
      schemePurchaseValue: 0,
      schemeCurrentValue: 0,
      schemeInterestCredited: 0,
      schemeAbsoluteReturn: 0,
      stockCurrentValue: 0,
      netWorthCurrentValue: 0,
    },
    funds: [],
    fundSummaries: [],
    fundChart: [],
    portfolioFlowChart: [],
    yearlyChart: [],
    categoryChart: [],
    transactions: [],
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const workbookContext = await getWorkbookContextIfExists(DEFAULT_WORKBOOK_PATH);
  if (!workbookContext) {
    return buildEmptyDashboardData();
  }
  const { funds, transactions } = readPortfolioWorkbook(workbookContext.localPath);
  const { funds: hydratedFunds, stockQuotesByFundId, usdBankQuotesByFundId } =
    await hydrateFundsWithLiveMarketData(funds);
  return buildDashboardSnapshot(
    workbookContext,
    hydratedFunds,
    transactions,
    stockQuotesByFundId,
    usdBankQuotesByFundId
  );
}

export async function addTransaction(input: NewTransactionInput) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbookPath = workbookContext.localPath;
  const parsed = transactionSchema.parse(input);
  const { workbook, funds, transactions } = readPortfolioWorkbook(workbookPath, true);

  if (!workbook) {
    throw new Error("Workbook could not be opened.");
  }

  const selectedFund = getFundOrThrow(funds, parsed.fundId);
  const newEntryId = getNextEntryId(transactions);
  const newRowId = getNextRowId(transactions);
  const newTransaction = buildTransactionRecord({
    rowId: newRowId,
    entryId: newEntryId,
    existingTransaction: null,
    selectedFund,
    input: parsed,
  });
  applyNavUpdateFromTransaction(selectedFund, newTransaction, parsed);

  const updatedTransactions = [...transactions, newTransaction];
  const balancedTransactions = computeBalanceUnits(
    updatedTransactions,
    new Map(funds.map((fund) => [fund.fundId, fund]))
  );
  writePortfolioWorkbook(workbookPath, workbook, funds, balancedTransactions);
  await persistWorkbookIfBlob(workbookContext);

  const { funds: hydratedFunds, stockQuotesByFundId, usdBankQuotesByFundId } =
    await hydrateFundsWithLiveMarketData(funds);
  return {
    entryId: newEntryId,
    rowId: newRowId,
    dashboard: buildDashboardSnapshot(
      workbookContext,
      hydratedFunds,
      balancedTransactions,
      stockQuotesByFundId,
      usdBankQuotesByFundId
    ),
  };
}

export async function updateTransaction(
  rowId: string,
  input: NewTransactionInput
) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbookPath = workbookContext.localPath;
  const parsed = transactionSchema.parse(input);
  const { workbook, funds, transactions } = readPortfolioWorkbook(workbookPath, true);

  if (!workbook) {
    throw new Error("Workbook could not be opened.");
  }

  const transactionIndex = transactions.findIndex(
    (transaction) => transaction.rowId === rowId
  );
  if (transactionIndex === -1) {
    throw new Error("Transaction not found.");
  }

  const existingTransaction = transactions[transactionIndex];
  const selectedFund = getFundOrThrow(funds, parsed.fundId);
  const updatedTransaction = buildTransactionRecord({
    rowId: existingTransaction.rowId,
    entryId: existingTransaction.entryId,
    existingTransaction,
    selectedFund,
    input: parsed,
  });
  applyNavUpdateFromTransaction(selectedFund, updatedTransaction, parsed);

  const updatedTransactions = transactions.slice();
  updatedTransactions[transactionIndex] = updatedTransaction;
  const balancedTransactions = computeBalanceUnits(
    updatedTransactions,
    new Map(funds.map((fund) => [fund.fundId, fund]))
  );

  writePortfolioWorkbook(workbookPath, workbook, funds, balancedTransactions);
  await persistWorkbookIfBlob(workbookContext);
  const { funds: hydratedFunds, stockQuotesByFundId, usdBankQuotesByFundId } =
    await hydrateFundsWithLiveMarketData(funds);
  return {
    entryId: existingTransaction.entryId,
    rowId: existingTransaction.rowId,
    dashboard: buildDashboardSnapshot(
      workbookContext,
      hydratedFunds,
      balancedTransactions,
      stockQuotesByFundId,
      usdBankQuotesByFundId
    ),
  };
}

export async function deleteTransaction(rowId: string) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbookPath = workbookContext.localPath;
  const { workbook, funds, transactions } = readPortfolioWorkbook(workbookPath, true);

  if (!workbook) {
    throw new Error("Workbook could not be opened.");
  }

  const updatedTransactions = transactions.filter(
    (transaction) => transaction.rowId !== rowId
  );
  if (updatedTransactions.length === transactions.length) {
    throw new Error("Transaction not found.");
  }

  const balancedTransactions = computeBalanceUnits(
    updatedTransactions,
    new Map(funds.map((fund) => [fund.fundId, fund]))
  );
  writePortfolioWorkbook(workbookPath, workbook, funds, balancedTransactions);
  await persistWorkbookIfBlob(workbookContext);
  const { funds: hydratedFunds, stockQuotesByFundId, usdBankQuotesByFundId } =
    await hydrateFundsWithLiveMarketData(funds);
  return {
    rowId,
    dashboard: buildDashboardSnapshot(
      workbookContext,
      hydratedFunds,
      balancedTransactions,
      stockQuotesByFundId,
      usdBankQuotesByFundId
    ),
  };
}

export async function updateFundLatestNav(input: {
  fundId: string;
  latestNav: number;
  latestNavDate: string;
}) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbookPath = workbookContext.localPath;
  const parsed = updateNavSchema.parse(input);

  const { workbook, funds, transactions } = readPortfolioWorkbook(workbookPath, true);
  if (!workbook) {
    throw new Error("Workbook could not be opened.");
  }

  const fund = getFundOrThrow(funds, parsed.fundId);
  const assetType = (fund.assetType || "").toLowerCase();
  if (assetType === "stock") {
    throw new Error("Stocks use live quotes. Update not supported here.");
  }
  if (assetType !== "mutual fund") {
    throw new Error("Only mutual funds support manual NAV updates right now.");
  }

  fund.latestNav = roundToTwo(parsed.latestNav);
  fund.latestNavDate = parsed.latestNavDate;

  writePortfolioWorkbook(workbookPath, workbook, funds, transactions);
  await persistWorkbookIfBlob(workbookContext);

  const { funds: hydratedFunds, stockQuotesByFundId, usdBankQuotesByFundId } =
    await hydrateFundsWithLiveMarketData(funds);
  return {
    fundId: fund.fundId,
    dashboard: buildDashboardSnapshot(
      workbookContext,
      hydratedFunds,
      transactions,
      stockQuotesByFundId,
      usdBankQuotesByFundId
    ),
  };
}

export async function addFund(input: NewFundInput) {
  const workbookContext = await getWorkbookContextOrThrow(DEFAULT_WORKBOOK_PATH);
  const workbookPath = workbookContext.localPath;
  const parsed = newFundSchema.parse(input);
  const { workbook, funds, transactions } = readPortfolioWorkbook(workbookPath, true);

  if (!workbook) {
    throw new Error("Workbook could not be opened.");
  }

  const isInrBank = parsed.assetType === "Bank Account (INR)";
  const isUsdBank = parsed.assetType === "Bank Account (USD)";

  if (
    funds.some(
      (fund) =>
        fund.name.trim().toLowerCase() === parsed.name.toLowerCase() &&
        (isInrBank || isUsdBank
          ? fund.accountNumber.trim().toLowerCase() === parsed.accountNumber.toLowerCase()
          : fund.folioNumber.trim().toLowerCase() === parsed.folioNumber.toLowerCase())
    )
  ) {
    throw new Error(
      isInrBank || isUsdBank
        ? "A bank account with this name and account number already exists."
        : "A fund with this name and folio already exists."
    );
  }

  const currentBalance = roundToTwo(parsed.currentBalance ?? 0);

  if ((isInrBank || isUsdBank) && currentBalance <= 0) {
    throw new Error("Please enter the current balance for the bank account.");
  }

  if (!isInrBank && !isUsdBank && parsed.accountNumber) {
    throw new Error("Account number is only supported for bank accounts.");
  }

  if (!isInrBank && parsed.ifscCode) {
    throw new Error("IFSC code is only supported for Indian bank accounts.");
  }

  if ((isInrBank || isUsdBank) && !parsed.accountNumber) {
    throw new Error("Please enter the bank account number.");
  }

  if (isInrBank && !parsed.ifscCode) {
    throw new Error("Please enter the IFSC code.");
  }

  let latestNav = isInrBank ? 1 : parsed.latestNav ?? 0;
  let latestNavDate = latestNav > 0 ? parsed.startDate : "";
  let statementDate = latestNavDate;
  let currentValue = isInrBank ? currentBalance : 0;

  if (isUsdBank) {
    try {
      const fx = await fetchUsdInrFx();
      latestNav = roundToFour(fx.inrPerUsd);
      latestNavDate = fx.asOf.slice(0, 10);
      statementDate = latestNavDate;
      currentValue = roundToTwo(currentBalance * fx.inrPerUsd);
    } catch {
      currentValue = roundToTwo(currentBalance * latestNav);
    }
  }

  const newFund: FundRecord = {
    fundId: buildFundId(funds, parsed),
    name: parsed.name,
    category: parsed.category,
    assetType: parsed.assetType,
    folioNumber: parsed.folioNumber,
    accountNumber: parsed.accountNumber,
    ifscCode: parsed.ifscCode.toUpperCase(),
    startDate: parsed.startDate,
    statementDate,
    latestNavDate,
    currentUnits: currentBalance,
    latestNav,
    holdingCost: 0,
    currentValue,
    profitLoss: 0,
    absoluteReturn: 0,
  };

  writePortfolioWorkbook(workbookPath, workbook, [...funds, newFund], transactions);
  await persistWorkbookIfBlob(workbookContext);

  const { funds: hydratedFunds, stockQuotesByFundId, usdBankQuotesByFundId } =
    await hydrateFundsWithLiveMarketData([...funds, newFund]);
  return {
    fundId: newFund.fundId,
    dashboard: buildDashboardSnapshot(
      workbookContext,
      hydratedFunds,
      transactions,
      stockQuotesByFundId,
      usdBankQuotesByFundId
    ),
  };
}

async function hydrateFundsWithLiveMarketData(funds: FundRecord[]): Promise<{
  funds: FundRecord[];
  stockQuotesByFundId: Map<string, StockInrQuote>;
  usdBankQuotesByFundId: Map<string, UsdBankQuote>;
}> {
  const stockFunds = funds.filter((fund) => (fund.assetType || "").toLowerCase() === "stock");
  const usdBankFunds = funds.filter(
    (fund) => (fund.assetType || "").toLowerCase() === "bank account (usd)"
  );
  if (stockFunds.length === 0 && usdBankFunds.length === 0) {
    return {
      funds,
      stockQuotesByFundId: new Map(),
      usdBankQuotesByFundId: new Map(),
    };
  }

  const byFundId = new Map<string, string>([["STOCK-XOM", "XOM"]]);
  const cloned = funds.map((fund) => ({ ...fund }));
  const stockQuotesByFundId = new Map<string, StockInrQuote>();
  const usdBankQuotesByFundId = new Map<string, UsdBankQuote>();

  await Promise.all(
    cloned.map(async (fund) => {
      const assetType = (fund.assetType || "").toLowerCase();
      if (assetType === "stock") {
        const ticker = byFundId.get(fund.fundId);
        if (!ticker) {
          return;
        }

        try {
          const quote = await fetchStockInrQuote(ticker);
          fund.latestNav = roundToTwo(quote.priceInr);
          fund.latestNavDate = new Date().toISOString().slice(0, 10);
          stockQuotesByFundId.set(fund.fundId, quote);
        } catch {
          // Keep workbook-provided latestNav if live fetch fails.
        }
        return;
      }

      if (assetType !== "bank account (usd)") {
        return;
      }

      try {
        const fx = await fetchUsdInrFx();
        const valueInr = roundToTwo(fund.currentUnits * fx.inrPerUsd);
        fund.latestNav = roundToFour(fx.inrPerUsd);
        fund.latestNavDate = fx.asOf.slice(0, 10);
        fund.currentValue = valueInr;
        fund.statementDate = fx.asOf.slice(0, 10);
        usdBankQuotesByFundId.set(fund.fundId, {
          balanceUsd: roundToTwo(fund.currentUnits),
          fxInrPerUsd: roundToFour(fx.inrPerUsd),
          valueInr,
          asOf: fx.asOf,
        });
      } catch {
        // Keep workbook-provided FX-derived value if live fetch fails.
      }
    })
  );

  return { funds: cloned, stockQuotesByFundId, usdBankQuotesByFundId };
}

function buildDashboardSnapshot(
  workbookContext: WorkbookContext,
  funds: FundRecord[],
  transactions: TransactionRecord[],
  stockQuotesByFundId?: Map<string, StockInrQuote>,
  usdBankQuotesByFundId?: Map<string, UsdBankQuote>
): DashboardData {
  const baseFundSummaries = buildFundSummaries(funds, transactions);
  const fundSummaries = baseFundSummaries.map((summary) => {
    const assetType = (summary.assetType || "").toLowerCase();
    if (assetType === "stock") {
      const quote = stockQuotesByFundId?.get(summary.fundId);
      if (!quote) {
        return summary;
      }

      return {
        ...summary,
        stockPriceUsd: roundToTwo(quote.priceUsd),
        stockFxInrPerUsd: roundToTwo(quote.fxInrPerUsd),
        stockAsOf: quote.asOf,
      };
    }

    if (assetType === "bank account (usd)") {
      const quote = usdBankQuotesByFundId?.get(summary.fundId);
      if (!quote) {
        return summary;
      }

      return {
        ...summary,
        bankBalanceUsd: quote.balanceUsd,
        bankFxInrPerUsd: quote.fxInrPerUsd,
        bankAsOf: quote.asOf,
        currentValue: quote.valueInr,
      };
    }

    if (assetType !== "bank account (inr)") {
      return summary;
    }

    return {
      ...summary,
      currentValue: roundToTwo(summary.currentUnits),
    };
  });
  const activeFundSummaries = fundSummaries.filter(hasOpenPosition);

  const mutualFundSummaries = fundSummaries.filter(
    (fund) => (fund.assetType || "").toLowerCase() === "mutual fund"
  );
  const schemeSummaries = fundSummaries.filter(
    (fund) => (fund.assetType || "").toLowerCase() === "govt scheme"
  );
  const stockSummaries = fundSummaries.filter(
    (fund) => (fund.assetType || "").toLowerCase() === "stock"
  );
  const mutualFundPurchaseValue = sumBy(mutualFundSummaries, (fund) => fund.totalInvested);
  const mutualFundCurrentValue = sumBy(mutualFundSummaries, (fund) => fund.currentValue);
  const mutualFundProfitLoss = sumBy(mutualFundSummaries, (fund) => fund.profitLoss);
  const mutualFundAbsoluteReturn =
    mutualFundPurchaseValue === 0 ? 0 : mutualFundProfitLoss / mutualFundPurchaseValue;

  const schemePurchaseValue = sumBy(schemeSummaries, (fund) => fund.totalInvested);
  const schemeCurrentValue = sumBy(schemeSummaries, (fund) => fund.currentValue);
  const schemeInterestCredited = sumBy(schemeSummaries, (fund) => fund.profitLoss);
  const schemeAbsoluteReturn =
    schemePurchaseValue === 0 ? 0 : schemeInterestCredited / schemePurchaseValue;

  const stockCurrentValue = sumBy(stockSummaries, (fund) => fund.currentValue);
  const netWorthCurrentValue = sumBy(fundSummaries, (fund) => fund.currentValue);

  return {
    workbookName: workbookContext.workbookName,
    workbookPath: workbookContext.workbookPathLabel,
    metrics: {
      mutualFundPurchaseValue,
      mutualFundCurrentValue,
      mutualFundProfitLoss,
      mutualFundAbsoluteReturn,
      schemePurchaseValue,
      schemeCurrentValue,
      schemeInterestCredited,
      schemeAbsoluteReturn,
      stockCurrentValue,
      netWorthCurrentValue,
    },
    funds: fundSummaries
      .filter((fund) => !(fund.assetType || "").toLowerCase().startsWith("bank account"))
      .map((fund) => ({
      fundId: fund.fundId,
      name: fund.name,
      assetType: fund.assetType,
    })),
    fundSummaries,
    fundChart: activeFundSummaries
      .filter((fund) => {
        const assetType = (fund.assetType || "").toLowerCase();
        return assetType !== "stock" && !assetType.startsWith("bank account");
      })
      .map((fund) => ({
      fundId: fund.fundId,
      name: fund.name,
      invested: fund.totalInvested,
      currentValue: fund.currentValue,
    })),
    portfolioFlowChart: buildPortfolioFlowChart(transactions, funds),
    yearlyChart: buildYearlyChart(transactions),
    categoryChart: buildCategoryChart([...activeFundSummaries]),
    transactions: transactions
      .slice()
      .sort((left, right) => sortTransactionsDescending(left, right)),
  };
}


function buildTransactionRecord({
  rowId,
  entryId,
  existingTransaction,
  selectedFund,
  input,
}: {
  rowId: string;
  entryId: string;
  existingTransaction: TransactionRecord | null;
  selectedFund: FundRecord;
  input: TransactionInput;
}): TransactionRecord {
  const amountInvested = roundToTwo(input.amountInvested);
  const isInterestCredited = isInterestCreditedTransaction(input.transactionType);
  const normalizedAmount = isInterestCredited
    ? 0
    : normalizeCashAmount(amountInvested);
  const nav = input.nav ?? selectedFund.latestNav ?? 0;
  const isMutualFund = (selectedFund.assetType || "").toLowerCase() === "mutual fund";
  const isGovtScheme = (selectedFund.assetType || "").toLowerCase() === "govt scheme";
  const rawUnits =
    input.units ??
    ((isMutualFund || isGovtScheme) && nav > 0 ? amountInvested / nav : 0);
  const units = roundUnitsByAssetType(rawUnits, selectedFund.assetType);

  return {
    rowId,
    entryId,
    transactionDate: input.transactionDate,
    financialYear: getFinancialYear(input.transactionDate),
    fundId: selectedFund.fundId,
    fundName: selectedFund.name,
    transactionType: input.transactionType,
    direction: input.direction,
    normalizedAmount,
    cashAmountExact: amountInvested,
    statementAmount: amountInvested,
    charges: existingTransaction?.charges ?? 0,
    units,
    nav,
    balanceUnits: 0,
    folioNumber: selectedFund.folioNumber,
    notes: existingTransaction?.notes ?? "",
    sourceFile: existingTransaction?.sourceFile || "Next.js app",
  };
}

function normalizeTransactionType(transactionType: string) {
  const normalized = transactionType.trim();
  if (/^interest\s+credit(?:ed)?$/i.test(normalized)) {
    return "Interest Credited";
  }
  return normalized;
}

function isInterestCreditedTransaction(transactionType: string) {
  return normalizeTransactionType(transactionType) === "Interest Credited";
}

function applyNavUpdateFromTransaction(
  fund: FundRecord,
  transaction: TransactionRecord,
  input?: Pick<TransactionInput, "currentNav">
) {
  const assetType = (fund.assetType || "").toLowerCase();
  if (assetType !== "mutual fund") {
    return;
  }

  const currentNav = input?.currentNav ?? 0;
  if (Number.isFinite(currentNav) && currentNav > 0) {
    fund.latestNav = roundToTwo(currentNav);
    fund.latestNavDate = new Date().toISOString().slice(0, 10);
    return;
  }

  const nav = transaction.nav ?? 0;
  if (!Number.isFinite(nav) || nav <= 0) {
    return;
  }

  const txDate = transaction.transactionDate;
  if (!txDate) {
    return;
  }

  if (shouldReplaceLatestNav(fund.latestNavDate, txDate)) {
    fund.latestNav = roundToTwo(nav);
    fund.latestNavDate = txDate;
  }
}

function shouldReplaceLatestNav(currentDate: string, incomingDate: string) {
  const current = String(currentDate || "").trim();
  const incoming = String(incomingDate || "").trim();
  if (!incoming) {
    return false;
  }
  if (!current) {
    return true;
  }
  return incoming.localeCompare(current) >= 0;
}

function getFundOrThrow(funds: FundRecord[], fundId: string) {
  const selectedFund = funds.find((fund) => fund.fundId === fundId);
  if (!selectedFund) {
    throw new Error("The selected fund does not exist in the workbook.");
  }
  return selectedFund;
}

function getNextEntryId(transactions: TransactionRecord[]) {
  const highestNumber = transactions.reduce((highest, transaction) => {
    const match = transaction.entryId.match(/(\d+)$/);
    const current = match ? Number(match[1]) : 0;
    return Math.max(highest, current);
  }, 0);

  return `TXN-${String(highestNumber + 1).padStart(4, "0")}`;
}

function getNextRowId(transactions: TransactionRecord[]) {
  const highestNumber = transactions.reduce((highest, transaction) => {
    const match = transaction.rowId.match(/(\d+)$/);
    const current = match ? Number(match[1]) : 0;
    return Math.max(highest, current);
  }, 0);

  return `ROW-${String(highestNumber + 1).padStart(6, "0")}`;
}

function buildFundId(
  existingFunds: FundRecord[],
  input: z.infer<typeof newFundSchema>
) {
  const prefix =
    input.assetType === "Mutual Fund"
      ? "MF"
      : input.assetType === "Govt Scheme"
      ? "GS"
      : input.assetType === "Stock"
        ? "ST"
        : input.assetType === "Bank Account (INR)"
          ? "BANK-INR"
          : "BANK-USD";
  const folioPart = (input.folioNumber || input.accountNumber || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(-12);
  const namePart = input.name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = [prefix, namePart, folioPart].filter(Boolean).join("-");

  let candidate = base || `${prefix}-FUND`;
  let counter = 2;
  while (existingFunds.some((fund) => fund.fundId === candidate)) {
    candidate = `${base || `${prefix}-FUND`}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function readPortfolioWorkbook(workbookPath: string, includeWorkbook = false) {
  const workbookBuffer = fs.readFileSync(workbookPath);
  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: false,
  });
  const funds = parseFunds(workbook);
  const transactions = parseTransactions(workbook);

  return {
    workbook: includeWorkbook ? workbook : undefined,
    funds,
    transactions,
  };
}

function writePortfolioWorkbook(
  workbookPath: string,
  workbook: XLSX.WorkBook,
  funds: FundRecord[],
  transactions: TransactionRecord[]
) {
  const orderedTransactions = transactions
    .slice()
    .sort((left, right) => sortTransactionsAscending(left, right));
  const balancedTransactions = computeBalanceUnits(
    orderedTransactions,
    new Map(funds.map((fund) => [fund.fundId, fund]))
  );
  const fundSummaries = buildFundSummaries(funds, balancedTransactions);
  const yearlySummary = buildYearlyChart(balancedTransactions);

  workbook.Sheets["Transactions"] = XLSX.utils.aoa_to_sheet([
    [
      "Row ID",
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
    ...balancedTransactions.map((transaction) => [
      transaction.rowId,
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
  ]);
  applyBalanceUnitsNumberFormat(
    workbook.Sheets["Transactions"],
    balancedTransactions,
    new Map(funds.map((fund) => [fund.fundId, fund]))
  );
  workbook.Sheets["Transactions"]["!cols"] = [
    { wch: 12, hidden: true },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 34 },
    { wch: 24 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 20 },
  ];

  workbook.Sheets["Funds"] = XLSX.utils.aoa_to_sheet([
    [
      "Fund ID",
      "Fund Name",
      "Category",
      "Asset Type",
      "Folio Number",
      "Account Number",
      "IFSC Code",
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
    ...funds.map((fund) => {
      const summary = fundSummaries.find((item) => item.fundId === fund.fundId);
      return [
        fund.fundId,
        fund.name,
        fund.category,
        fund.assetType,
        fund.folioNumber,
        fund.accountNumber,
        fund.ifscCode,
        fund.startDate,
        fund.statementDate,
        fund.latestNavDate,
        summary?.currentUnits ?? 0,
        fund.latestNav,
        summary?.totalInvested ?? 0,
        summary?.currentValue ?? 0,
        summary?.profitLoss ?? 0,
        summary?.absoluteReturn ?? 0,
      ];
    }),
  ]);
  workbook.Sheets["Funds"]["!cols"] = [
    { wch: 12 },
    { wch: 34 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
  ];

  workbook.Sheets["Summary by Fund"] = XLSX.utils.aoa_to_sheet([
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
    ...fundSummaries.map((fund) => [
      fund.fundId,
      fund.name,
      fund.category,
      fund.totalContributions,
      fund.totalRedemptions,
      fund.netCashFlow,
      fund.totalInvested,
      fund.currentValue,
      fund.profitLoss,
      fund.absoluteReturn,
      fund.transactionCount,
    ]),
  ]);
  workbook.Sheets["Summary by Fund"]["!cols"] = [
    { wch: 12 },
    { wch: 34 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
  ];

  workbook.Sheets["Summary by Year"] = XLSX.utils.aoa_to_sheet([
    [
      "Financial Year",
      "Contributions",
      "Redemptions",
      "Net Cash Flow",
      "Transaction Count",
    ],
    ...yearlySummary.map((year) => [
      year.financialYear,
      year.contributions,
      year.redemptions,
      year.netCashFlow,
      year.transactionCount,
    ]),
  ]);
  workbook.Sheets["Summary by Year"]["!cols"] = [
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];

  const workbookBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
  fs.writeFileSync(workbookPath, workbookBuffer);
}

function parseFunds(workbook: XLSX.WorkBook): FundRecord[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets["Funds"],
    { defval: "" }
  );

  return rows
    .filter((row) => row["Fund ID"] && row["Fund Name"])
    .map((row) => {
      const holdingCost = toNumber(row["Holding Cost"]);
      const currentValue = toNumber(row["Current Value"]);
      const profitLoss = toNumber(row["Unrealized P/L"]);
      const absoluteReturn =
        holdingCost === 0 ? 0 : profitLoss / Math.max(holdingCost, 1);

      return {
        fundId: String(row["Fund ID"]),
        name: String(row["Fund Name"]),
        category: String(row["Category"] || ""),
        assetType: String(row["Asset Type"] || ""),
        folioNumber: String(row["Folio Number"] || ""),
        accountNumber: String(row["Account Number"] || row["Bank Account Number"] || ""),
        ifscCode: String(row["IFSC Code"] || ""),
        startDate: String(row["Start Date"] || ""),
        statementDate: String(row["Statement Date"] || ""),
        latestNavDate: String(row["Latest NAV Date"] || ""),
        currentUnits: toNumber(row["Current Units"]),
        latestNav: toNumber(row["Latest NAV"]),
        holdingCost,
        currentValue,
        profitLoss,
        absoluteReturn,
      };
    });
}

function parseTransactions(workbook: XLSX.WorkBook): TransactionRecord[] {
  const sheet = workbook.Sheets["Transactions"];
  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const transactions: TransactionRecord[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row["Entry ID"] || !row["Fund ID"]) {
      continue;
    }

    const rowIdCell = row["Row ID"] || row["RowId"] || row["rowId"];
    const fallbackRowNumber = index + 2;
    const fallbackRowId = `ROW-${String(fallbackRowNumber).padStart(6, "0")}`;

    transactions.push({
      rowId: String(rowIdCell || fallbackRowId),
      entryId: String(row["Entry ID"] || ""),
      transactionDate: String(row["Transaction Date"] || ""),
      financialYear: String(row["Financial Year"] || ""),
      fundId: String(row["Fund ID"] || ""),
      fundName: String(row["Fund Name"] || ""),
      transactionType: normalizeTransactionType(String(row["Transaction Type"] || "")),
      direction:
        String(row["Direction"] || "") === "Redemption"
          ? "Redemption"
          : "Contribution",
      normalizedAmount: toNumber(row["Normalized Amount"]),
      cashAmountExact: toNumber(row["Cash Amount Exact"]),
      statementAmount: toNumber(row["Statement Amount"]),
      charges: toNumber(row["Charges"]),
      units: toNumber(row["Units"]),
      nav: toNumber(row["NAV"]),
      balanceUnits: roundToFour(toNumber(row["Balance Units"])),
      folioNumber: String(row["Folio Number"] || ""),
      notes: String(row["Notes"] || ""),
      sourceFile: String(row["Source File"] || ""),
    });
  }

  return transactions;
}

function buildFundSummaries(
  funds: FundRecord[],
  transactions: TransactionRecord[]
): FundSummary[] {
  const transactionsByFund = new Map<string, TransactionRecord[]>();

  for (const transaction of transactions) {
    const currentTransactions = transactionsByFund.get(transaction.fundId) ?? [];
    currentTransactions.push(transaction);
    transactionsByFund.set(transaction.fundId, currentTransactions);
  }

  return funds
    .map((fund) => {
      const fundTransactions = (transactionsByFund.get(fund.fundId) ?? [])
        .slice()
        .sort((left, right) => sortTransactionsAscending(left, right));

      if (fundTransactions.length === 0) {
        return {
          fundId: fund.fundId,
          name: fund.name,
          category: fund.category,
          assetType: fund.assetType,
          folioNumber: fund.folioNumber,
          accountNumber: fund.accountNumber,
          ifscCode: fund.ifscCode,
          statementDate: fund.statementDate,
          latestNavDate: fund.latestNavDate,
          currentUnits: fund.currentUnits,
          latestNav: fund.latestNav,
          totalContributions: 0,
          totalRedemptions: 0,
          netCashFlow: 0,
          totalInvested: isBankAccountAssetType(fund.assetType) ? 0 : fund.holdingCost,
          currentValue: getStaticHoldingCurrentValue(fund),
          profitLoss: isBankAccountAssetType(fund.assetType) ? 0 : fund.profitLoss,
          absoluteReturn: isBankAccountAssetType(fund.assetType) ? 0 : fund.absoluteReturn,
          transactionCount: 0,
        };
      }

      let currentUnits = 0;
      let costBasis = 0;
      let totalContributions = 0;
      let totalRedemptions = 0;
      const unitAssetType = fund.assetType;

      for (const transaction of fundTransactions) {
        if (transaction.direction === "Contribution") {
          currentUnits = roundUnitsByAssetType(
            currentUnits + transaction.units,
            unitAssetType
          );
          costBasis += transaction.normalizedAmount;
          totalContributions += transaction.normalizedAmount;
          continue;
        }

        const averageCostPerUnit = currentUnits > 0 ? costBasis / currentUnits : 0;
        const redeemedUnits = Math.min(transaction.units, currentUnits);
        costBasis = Math.max(0, costBasis - redeemedUnits * averageCostPerUnit);
        currentUnits = roundUnitsByAssetType(
          Math.max(0, currentUnits - transaction.units),
          unitAssetType
        );
        totalRedemptions += transaction.normalizedAmount;
      }

      const totalInvested = roundToTwo(costBasis);
      const currentValue = roundToTwo(currentUnits * fund.latestNav);
      const profitLoss = roundToTwo(currentValue - totalInvested);

      return {
        fundId: fund.fundId,
        name: fund.name,
        category: fund.category,
        assetType: fund.assetType,
        folioNumber: fund.folioNumber,
        accountNumber: fund.accountNumber,
        ifscCode: fund.ifscCode,
        statementDate: fund.statementDate,
        latestNavDate: fund.latestNavDate,
        currentUnits: roundUnitsByAssetType(currentUnits, unitAssetType),
        latestNav: fund.latestNav,
        totalContributions: roundToTwo(totalContributions),
        totalRedemptions: roundToTwo(totalRedemptions),
        netCashFlow: roundToTwo(totalContributions - totalRedemptions),
        totalInvested,
        currentValue,
        profitLoss,
        absoluteReturn: totalInvested === 0 ? 0 : profitLoss / totalInvested,
        transactionCount: fundTransactions.length,
      };
    })
    .sort((left, right) => right.currentValue - left.currentValue);
}

function buildYearlyChart(transactions: TransactionRecord[]) {
  const totals = new Map<
    string,
    {
      financialYear: string;
      contributions: number;
      redemptions: number;
      netCashFlow: number;
      transactionCount: number;
    }
  >();

  for (const transaction of transactions) {
    const current = totals.get(transaction.financialYear) ?? {
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
    totals.set(transaction.financialYear, current);
  }

  return Array.from(totals.values())
    .map((year) => ({
      ...year,
      contributions: roundToTwo(year.contributions),
      redemptions: roundToTwo(year.redemptions),
      netCashFlow: roundToTwo(year.netCashFlow),
    }))
    .sort((left, right) => left.financialYear.localeCompare(right.financialYear));
}

function buildPortfolioFlowChart(
  transactions: TransactionRecord[],
  funds: FundRecord[]
) {
  const latestNavByFund = new Map(
    funds.map((fund) => [fund.fundId, fund.latestNav] as const)
  );
  const sortedTransactions = transactions
    .slice()
    .sort((left, right) => sortTransactionsAscending(left, right));
  const positions = new Map<string, FundPosition>();
  const snapshots = new Map<
    string,
    {
      period: string;
      purchaseValue: number;
      currentValue: number;
    }
  >();

  let portfolioPurchaseValue = 0;
  let portfolioCurrentValue = 0;

  for (const transaction of sortedTransactions) {
    if (!transaction.transactionDate) {
      continue;
    }

    const latestNav = latestNavByFund.get(transaction.fundId) ?? 0;
    const assetType = funds.find((fund) => fund.fundId === transaction.fundId)?.assetType ?? "";
    const position = positions.get(transaction.fundId) ?? {
      costBasis: 0,
      units: 0,
    };

    if (transaction.direction === "Contribution") {
      position.costBasis += transaction.normalizedAmount;
      position.units = roundUnitsByAssetType(
        position.units + transaction.units,
        assetType
      );
      portfolioPurchaseValue += transaction.normalizedAmount;
    } else {
      const averageCostPerUnit =
        position.units > 0 ? position.costBasis / position.units : 0;
      const redeemedUnits = Math.min(transaction.units, position.units);
      const costReduction = redeemedUnits * averageCostPerUnit;

      position.costBasis = Math.max(0, position.costBasis - costReduction);
      position.units = roundUnitsByAssetType(
        Math.max(0, position.units - transaction.units),
        assetType
      );
      portfolioPurchaseValue = Math.max(0, portfolioPurchaseValue - costReduction);
    }

    positions.set(transaction.fundId, position);
    portfolioCurrentValue = 0;
    for (const [fundId, currentPosition] of positions.entries()) {
      const nav = latestNavByFund.get(fundId) ?? 0;
      portfolioCurrentValue += currentPosition.units * nav;
    }
    const period = transaction.transactionDate.slice(0, 7);
    const purchaseValue = roundToTwo(portfolioPurchaseValue);
    const currentValue = roundToTwo(portfolioCurrentValue);

    snapshots.set(period, {
      period,
      purchaseValue,
      currentValue,
    });
  }

  return Array.from(snapshots.values())
    .sort((left, right) => left.period.localeCompare(right.period))
    .map((snapshot) => ({
      ...snapshot,
      currentValueGain:
        snapshot.currentValue >= snapshot.purchaseValue
          ? snapshot.currentValue
          : null,
      currentValueLoss:
        snapshot.currentValue < snapshot.purchaseValue
          ? snapshot.currentValue
          : null,
    }));
}

function buildCategoryChart(fundSummaries: FundSummary[]) {
  const totals = new Map<string, number>();

  for (const fund of fundSummaries) {
    totals.set(
      fund.category,
      (totals.get(fund.category) ?? 0) + fund.currentValue
    );
  }

  return Array.from(totals.entries()).map(([category, currentValue]) => ({
    category,
    currentValue: roundToTwo(currentValue),
  }));
}

function hasOpenPosition(fund: FundSummary) {
  if (isBankAccountAssetType(fund.assetType)) {
    return Math.abs(fund.currentValue) > 0.005;
  }

  return (
    Math.abs(fund.currentUnits) > 0.0001 ||
    Math.abs(fund.currentValue) > 0.005 ||
    Math.abs(fund.totalInvested) > 0.005
  );
}

function getFinancialYear(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Transaction date is invalid.");
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startYear = month >= 3 ? year : year - 1;
  const endYear = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endYear}`;
}

function sortTransactionsAscending(
  left: TransactionRecord,
  right: TransactionRecord
) {
  return (
    left.transactionDate.localeCompare(right.transactionDate) ||
    left.entryId.localeCompare(right.entryId)
  );
}

function sortTransactionsDescending(
  left: TransactionRecord,
  right: TransactionRecord
) {
  return (
    right.transactionDate.localeCompare(left.transactionDate) ||
    right.entryId.localeCompare(left.entryId)
  );
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumBy<T>(items: T[], getter: (item: T) => number) {
  return roundToTwo(items.reduce((total, item) => total + getter(item), 0));
}

function roundToTwo(value: number) {
  return Number(value.toFixed(2));
}

function roundToFour(value: number) {
  return Number(value.toFixed(4));
}

function computeBalanceUnits(
  transactions: TransactionRecord[],
  fundsById?: Map<string, FundRecord>
) {
  const ordered = transactions
    .slice()
    .sort((left, right) => sortTransactionsAscending(left, right));
  const balances = new Map<string, number>();

  return ordered.map((transaction) => {
    const previous = balances.get(transaction.fundId) ?? 0;
    const units = Number.isFinite(transaction.units) ? transaction.units : 0;
    const nextRaw =
      transaction.direction === "Redemption" ? previous - units : previous + units;
    const assetType = fundsById?.get(transaction.fundId)?.assetType ?? "";
    const next = roundUnitsByAssetType(Math.max(0, nextRaw), assetType);
    balances.set(transaction.fundId, next);
    return { ...transaction, balanceUnits: next };
  });
}

function applyBalanceUnitsNumberFormat(
  sheet: XLSX.WorkSheet | undefined,
  transactions: TransactionRecord[],
  fundsById: Map<string, FundRecord>
) {
  if (!sheet || transactions.length <= 0) {
    return;
  }

  // Balance Units is the 15th column (0-based index 14) in the AOA above.
  const balanceUnitsColumnIndex = 14;
  for (let index = 0; index < transactions.length; index += 1) {
    const address = XLSX.utils.encode_cell({ r: index + 1, c: balanceUnitsColumnIndex });
    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell || cell.t !== "n") {
      continue;
    }
    const assetType = fundsById.get(transactions[index]?.fundId)?.assetType ?? "";
    cell.z = assetType.toLowerCase() === "mutual fund" ? "0.000" : "0.0000";
  }
}

function normalizeCashAmount(value: number) {
  const rounded = Math.round(value);
  return snapNearMultiple(rounded, 100, 2);
}

function roundUnitsByAssetType(value: number, assetType: string) {
  const normalizedAssetType = String(assetType || "").toLowerCase();
  if (normalizedAssetType === "mutual fund") {
    return roundToThree(value);
  }
  if (normalizedAssetType.startsWith("bank account")) {
    return roundToTwo(value);
  }
  return roundToFour(value);
}

function isBankAccountAssetType(assetType: string) {
  return String(assetType || "").toLowerCase().startsWith("bank account");
}

function getStaticHoldingCurrentValue(fund: FundRecord) {
  const assetType = (fund.assetType || "").toLowerCase();
  if (assetType === "bank account (inr)") {
    return roundToTwo(fund.currentUnits);
  }
  if (assetType === "bank account (usd)") {
    return roundToTwo(fund.currentUnits * fund.latestNav);
  }
  return fund.currentValue;
}

function snapNearMultiple(value: number, multiple: number, tolerance: number) {
  if (multiple <= 1) {
    return value;
  }

  const snapped = Math.round(value / multiple) * multiple;
  return Math.abs(value - snapped) <= tolerance ? snapped : value;
}

function roundToThree(value: number) {
  return Number(value.toFixed(3));
}
