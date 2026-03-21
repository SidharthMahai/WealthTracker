export type FundRecord = {
  fundId: string;
  name: string;
  category: string;
  assetType: string;
  folioNumber: string;
  startDate: string;
  statementDate: string;
  latestNavDate: string;
  currentUnits: number;
  latestNav: number;
  holdingCost: number;
  currentValue: number;
  profitLoss: number;
  absoluteReturn: number;
};

export type TransactionRecord = {
  rowId: string;
  entryId: string;
  transactionDate: string;
  financialYear: string;
  fundId: string;
  fundName: string;
  transactionType: string;
  direction: "Contribution" | "Redemption";
  normalizedAmount: number;
  cashAmountExact: number;
  statementAmount: number;
  charges: number;
  units: number;
  nav: number;
  balanceUnits: number;
  folioNumber: string;
  notes: string;
  sourceFile: string;
};

export type FundSummary = {
  fundId: string;
  name: string;
  category: string;
  assetType: string;
  folioNumber: string;
  statementDate: string;
  currentUnits: number;
  latestNav: number;
  totalContributions: number;
  totalRedemptions: number;
  netCashFlow: number;
  totalInvested: number;
  currentValue: number;
  profitLoss: number;
  absoluteReturn: number;
  transactionCount: number;
};

export type FundOption = {
  fundId: string;
  name: string;
};

export type DashboardData = {
  workbookName: string;
  workbookPath: string;
  metrics: {
    totalInvested: number;
    currentValue: number;
    profitLoss: number;
    absoluteReturn: number;
    stockCurrentValue: number;
  };
  funds: FundOption[];
  fundSummaries: FundSummary[];
  fundChart: Array<{
    fundId: string;
    name: string;
    invested: number;
    currentValue: number;
  }>;
  portfolioFlowChart: Array<{
    period: string;
    purchaseValue: number;
    currentValue: number;
    currentValueGain: number | null;
    currentValueLoss: number | null;
  }>;
  yearlyChart: Array<{
    financialYear: string;
    contributions: number;
    redemptions: number;
    netCashFlow: number;
    transactionCount: number;
  }>;
  categoryChart: Array<{
    category: string;
    currentValue: number;
  }>;
  transactions: TransactionRecord[];
};

export type NewTransactionInput = {
  transactionDate: string;
  fundId: string;
  amountInvested: number;
  direction?: "Contribution" | "Redemption";
  transactionType?: string;
  units?: number;
  nav?: number;
};
