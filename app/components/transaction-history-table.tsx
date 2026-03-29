"use client";

import { useMemo, useState } from "react";
import type { DashboardData, FundOption, TransactionRecord } from "@/lib/types";

type TransactionHistoryTableProps = {
  transactions: TransactionRecord[];
  funds: FundOption[];
  onChanged?: () => Promise<boolean | void> | boolean | void;
  onDashboardUpdated?: (dashboard: DashboardData) => void;
};

type EditableTransaction = {
  transactionDate: string;
  fundId: string;
  transactionType: string;
  direction: "Contribution" | "Redemption";
  amountInvested: string;
  units: string;
  nav: string;
};

type FundFilterOption = {
  fundId: string;
  fundName: string;
};

export function TransactionHistoryTable({
  transactions,
  funds,
  onChanged,
  onDashboardUpdated,
}: TransactionHistoryTableProps) {
  const [search, setSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [fundFilter, setFundFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [entryTypeFilter, setEntryTypeFilter] = useState("all");
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableTransaction | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fundOptions = useMemo(() => {
    const optionMap = new Map<string, FundFilterOption>();

    for (const transaction of transactions) {
      if (!optionMap.has(transaction.fundName)) {
        optionMap.set(transaction.fundName, {
          fundId: transaction.fundId,
          fundName: transaction.fundName,
        });
      }
    }

    return Array.from(optionMap.values()).sort((left, right) =>
      left.fundName.localeCompare(right.fundName)
    );
  }, [transactions]);

  const assetTypeByFundId = useMemo(() => {
    const map = new Map<string, string>();
    for (const fund of funds) {
      map.set(fund.fundId, (fund.assetType || "").toLowerCase());
    }
    return map;
  }, [funds]);

  const yearOptions = useMemo(
    () =>
      Array.from(
        new Set(transactions.map((transaction) => transaction.financialYear.trim()))
      ).sort((left, right) => right.localeCompare(left)),
    [transactions]
  );

  const monthOptions = useMemo(() => {
    const monthKeys = new Set<string>();

    for (const transaction of transactions) {
      const key = getMonthKey(transaction.transactionDate);
      if (key) {
        monthKeys.add(key);
      }
    }

    return Array.from(monthKeys).sort((left, right) => right.localeCompare(left));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = normalizeValue(search);

    return transactions.filter((transaction) => {
      const type = assetTypeByFundId.get(transaction.fundId) ?? "";
      const sameType = assetTypeFilter === "all" || type === assetTypeFilter;
      const sameFund =
        fundFilter === "all" || transaction.fundName === fundFilter;
      const sameYear =
        yearFilter === "all" || transaction.financialYear.trim() === yearFilter;
      const sameMonth =
        monthFilter === "all" ||
        getMonthKey(transaction.transactionDate) === monthFilter;
      const sameDirection =
        directionFilter === "all" || transaction.direction === directionFilter;
      const sameEntryType =
        entryTypeFilter === "all" || transaction.transactionType === entryTypeFilter;

      if (
        !sameType ||
        !sameFund ||
        !sameYear ||
        !sameMonth ||
        !sameDirection ||
        !sameEntryType
      ) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const searchText = [
        transaction.entryId,
        transaction.transactionDate,
        transaction.financialYear,
        transaction.fundName,
        transaction.transactionType,
        transaction.direction,
        transaction.folioNumber,
        type,
      ]
        .join(" ")
        .toLowerCase();

      return searchText.includes(normalizedSearch);
    });
  }, [
    assetTypeByFundId,
    assetTypeFilter,
    directionFilter,
    entryTypeFilter,
    fundFilter,
    monthFilter,
    search,
    transactions,
    yearFilter,
  ]);

  const totals = useMemo(
    () =>
      filteredTransactions.reduce(
        (accumulator, transaction) => {
          const sign = transaction.direction === "Redemption" ? -1 : 1;
          accumulator.amount += sign * transaction.normalizedAmount;
          accumulator.units += sign * transaction.units;
          accumulator.contributions +=
            transaction.direction === "Contribution"
              ? transaction.normalizedAmount
              : 0;
          accumulator.redemptions +=
            transaction.direction === "Redemption" ? transaction.normalizedAmount : 0;
          accumulator.rows += 1;
          return accumulator;
        },
        { amount: 0, units: 0, contributions: 0, redemptions: 0, rows: 0 }
      ),
    [filteredTransactions]
  );

  function beginEdit(transaction: TransactionRecord) {
    setError("");
    setNotice("");
    setEditingRowId(transaction.rowId);
    setDraft({
      transactionDate: transaction.transactionDate,
      fundId: transaction.fundId,
      transactionType: transaction.transactionType || "Purchase",
      direction: transaction.direction,
      amountInvested: String(transaction.normalizedAmount || ""),
      units: transaction.units ? String(transaction.units) : "",
      nav: transaction.nav ? String(transaction.nav) : "",
    });
  }

  function cancelEdit() {
    setEditingRowId(null);
    setDraft(null);
    setError("");
    setNotice("");
  }

  function updateDraft(field: keyof EditableTransaction, value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveEdit(rowId: string) {
    if (!draft) {
      return;
    }

    setBusyRowId(rowId);
    setError("");
    setNotice("Saving…");

    try {
      const response = await fetch("/api/transactions", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rowId,
          transaction: {
            transactionDate: draft.transactionDate,
            fundId: draft.fundId,
            transactionType: draft.transactionType,
            direction: draft.direction,
            amountInvested: Number(draft.amountInvested),
            units: draft.units ? Number(draft.units) : undefined,
            nav: draft.nav ? Number(draft.nav) : undefined,
          },
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        dashboard?: DashboardData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update the transaction.");
      }

      cancelEdit();
      if (payload.dashboard) {
        onDashboardUpdated?.(payload.dashboard);
        setNotice("Saved.");
      } else {
        setNotice("Saved. Updating dashboard…");
        const refreshed = await onChanged?.();
        setNotice(
          refreshed === false
            ? "Saved, but the dashboard didn't refresh (try again)."
            : "Saved."
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update the transaction."
      );
      setNotice("");
    } finally {
      setBusyRowId(null);
    }
  }

  async function removeTransaction(rowId: string) {
    if (!window.confirm("Delete this transaction from the workbook?")) {
      return;
    }

    setBusyRowId(rowId);
    setError("");
    setNotice("Deleting…");

    try {
      const response = await fetch(
        `/api/transactions?rowId=${encodeURIComponent(rowId)}`,
        { method: "DELETE", credentials: "include" }
      );

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        dashboard?: DashboardData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete the transaction.");
      }

      if (editingRowId === rowId) {
        cancelEdit();
      }
      if (payload.dashboard) {
        onDashboardUpdated?.(payload.dashboard);
        setNotice("Deleted.");
      } else {
        setNotice("Deleted. Updating dashboard…");
        const refreshed = await onChanged?.();
        setNotice(
          refreshed === false
            ? "Deleted, but the dashboard didn't refresh (try again)."
            : "Deleted."
        );
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the transaction."
      );
      setNotice("");
    } finally {
      setBusyRowId(null);
    }
  }

  function resetFilters() {
    setSearch("");
    setAssetTypeFilter("all");
    setFundFilter("all");
    setYearFilter("all");
    setMonthFilter("all");
    setDirectionFilter("all");
    setEntryTypeFilter("all");
  }

  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>Transaction history</h2>
        </div>
        <p className="muted">
          Exact filters apply to the visible transactions only, and the totals update with
          them.
        </p>
      </div>

      <div className="filter-grid">
        <label>
          <span>Search</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find by fund, type, folio, id or date..."
          />
        </label>

        <label>
          <span>Fund</span>
          <select
            value={fundFilter}
            onChange={(event) => setFundFilter(event.target.value)}
          >
            <option value="all">All funds</option>
            {fundOptions.map((fund) => (
              <option key={fund.fundId} value={fund.fundName}>
                {fund.fundName}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Fund Type</span>
          <select
            value={assetTypeFilter}
            onChange={(event) => setAssetTypeFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="mutual fund">Mutual funds</option>
            <option value="govt scheme">Govt schemes</option>
            <option value="stock">Stocks</option>
          </select>
        </label>

        <label>
          <span>Financial Year</span>
          <select
            value={yearFilter}
            onChange={(event) => setYearFilter(event.target.value)}
          >
            <option value="all">All years</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Month</span>
          <select
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
          >
            <option value="all">All months</option>
            {monthOptions.map((monthKey) => (
              <option key={monthKey} value={monthKey}>
                {formatMonthLabel(monthKey)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Direction</span>
          <select
            value={directionFilter}
            onChange={(event) => setDirectionFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="Contribution">Contribution</option>
            <option value="Redemption">Redemption</option>
          </select>
        </label>

        <label>
          <span>Entry Type</span>
          <select
            value={entryTypeFilter}
            onChange={(event) => setEntryTypeFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="Purchase">Purchase</option>
            <option value="SIP">SIP</option>
          </select>
        </label>
      </div>

      <div className="history-summary">
        <div className="history-chip">
          <strong>{totals.rows}</strong>
          <span>visible transactions</span>
        </div>
        <div className="history-chip">
          <strong>{formatInrFull(totals.contributions)}</strong>
          <span>filtered contributions</span>
        </div>
        <div className="history-chip">
          <strong>{formatInrFull(totals.redemptions)}</strong>
          <span>filtered redemptions</span>
        </div>
        <div className="history-chip">
          <strong>{formatUnits(totals.units)}</strong>
          <span>filtered units</span>
        </div>
        <button type="button" className="secondary-button" onClick={resetFilters}>
          Reset filters
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {!error && notice ? <p className="muted">{notice}</p> : null}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="date-col">Date</th>
              <th className="fy-col">FY</th>
              <th className="fund-col">Fund</th>
              <th>Type</th>
              <th>Direction</th>
              <th>Amount</th>
              <th>Units</th>
              <th>NAV</th>
              <th className="folio-col">Folio</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody
            key={`${search}|${assetTypeFilter}|${fundFilter}|${yearFilter}|${monthFilter}|${directionFilter}|${entryTypeFilter}`}
          >
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={10}>No transactions match these filters.</td>
              </tr>
            ) : null}

            {filteredTransactions.map((transaction) => {
              const isEditing = editingRowId === transaction.rowId && draft;
              const signedAmount =
                transaction.direction === "Redemption"
                  ? -transaction.normalizedAmount
                  : transaction.normalizedAmount;
              const signedUnits =
                transaction.direction === "Redemption"
                  ? -transaction.units
                  : transaction.units;

              if (isEditing) {
                return (
                  <tr key={transaction.rowId}>
                    <td className="numeric-cell date-col">
                      <input
                        type="date"
                        value={draft.transactionDate}
                        onChange={(event) =>
                          updateDraft("transactionDate", event.target.value)
                        }
                      />
                    </td>
                    <td className="numeric-cell fy-col">
                      {getFinancialYearLabel(draft.transactionDate)}
                    </td>
                    <td className="fund-col">
                      <select
                        value={draft.fundId}
                        onChange={(event) => updateDraft("fundId", event.target.value)}
                      >
                        {funds.map((fund) => (
                          <option key={fund.fundId} value={fund.fundId}>
                            {fund.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={draft.transactionType}
                        onChange={(event) =>
                          updateDraft("transactionType", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={draft.direction}
                        onChange={(event) =>
                          updateDraft(
                            "direction",
                            event.target.value as EditableTransaction["direction"]
                          )
                        }
                      >
                        <option value="Contribution">Contribution</option>
                        <option value="Redemption">Redemption</option>
                      </select>
                    </td>
                    <td className="numeric-cell">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.amountInvested}
                        onChange={(event) =>
                          updateDraft("amountInvested", event.target.value)
                        }
                      />
                    </td>
                    <td className="numeric-cell">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={draft.units}
                        onChange={(event) => updateDraft("units", event.target.value)}
                      />
                    </td>
                    <td className="numeric-cell">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={draft.nav}
                        onChange={(event) => updateDraft("nav", event.target.value)}
                      />
                    </td>
                    <td
                      className="numeric-cell folio-col"
                      title={transaction.folioNumber}
                    >
                      {transaction.folioNumber}
                    </td>
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="link-button"
                        disabled={busyRowId === transaction.rowId}
                        onClick={() => saveEdit(transaction.rowId)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        disabled={busyRowId === transaction.rowId}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={transaction.rowId}>
                  <td className="numeric-cell date-col">
                    {formatFriendlyDate(transaction.transactionDate)}
                  </td>
                  <td className="numeric-cell fy-col">{transaction.financialYear}</td>
                  <td className="fund-col">{transaction.fundName}</td>
                  <td>{transaction.transactionType}</td>
                  <td>{transaction.direction}</td>
                  <td
                    className={`numeric-cell ${
                      signedAmount >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatInrFull(signedAmount)}
                  </td>
                  <td className="numeric-cell">{formatUnits(signedUnits)}</td>
                  <td className="numeric-cell">{formatNav(transaction.nav)}</td>
                  <td
                    className="numeric-cell folio-col"
                    title={transaction.folioNumber}
                  >
                    {transaction.folioNumber}
                  </td>
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="link-button"
                      disabled={busyRowId === transaction.rowId}
                      onClick={() => beginEdit(transaction)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-button danger-button"
                      disabled={busyRowId === transaction.rowId}
                      onClick={() => removeTransaction(transaction.rowId)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                <strong>Filtered totals</strong>
                <span className="subtle-line">
                  Contribution {formatInrFull(totals.contributions)} · Redemption{" "}
                  {formatInrFull(totals.redemptions)}
                </span>
              </td>
              <td className="numeric-cell">
                <strong>{formatInrFull(totals.amount)}</strong>
              </td>
              <td className="numeric-cell">
                <strong>{formatUnits(totals.units)}</strong>
              </td>
              <td className="numeric-cell">—</td>
              <td className="numeric-cell">—</td>
              <td className="numeric-cell">
                <strong>{totals.rows} transactions</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function formatInrFull(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUnits(value: number) {
  const truncated = truncateDecimals(value, 8);
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  }).format(truncated);
}

function truncateDecimals(value: number, decimals: number) {
  if (!Number.isFinite(value) || !Number.isFinite(decimals) || decimals <= 0) {
    return value;
  }
  const factor = 10 ** Math.min(12, Math.floor(decimals));
  return Math.trunc(value * factor) / factor;
}

function formatNav(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(value);
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

function getFinancialYearLabel(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startYear = month >= 3 ? year : year - 1;
  const endYear = String(startYear + 1).slice(-2);
  return `${startYear}-${endYear}`;
}

function getMonthKey(dateString: string) {
  const match = dateString.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) {
    return null;
  }

  const month = Number(match[2]);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return `${match[1]}-${match[2]}`;
}

function formatMonthLabel(monthKey: string) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return "";
  }

  return `${MONTH_SHORT[monthIndex] ?? ""} ${year}`;
}

function formatFriendlyDate(dateString: string) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateString;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = match[3];
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return dateString;
  }

  return `${day} ${MONTH_SHORT[monthIndex] ?? ""} ${year}`;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
