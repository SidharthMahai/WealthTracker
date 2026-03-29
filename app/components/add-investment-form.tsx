"use client";

import { useMemo, useState } from "react";
import type { DashboardData, FundOption } from "@/lib/types";

type AddInvestmentFormProps = {
  funds: FundOption[];
  onSaved?: () => Promise<boolean | void> | boolean | void;
  onDashboardUpdated?: (dashboard: DashboardData) => void;
};

export function AddInvestmentForm({
  funds,
  onSaved,
  onDashboardUpdated,
}: AddInvestmentFormProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [form, setForm] = useState({
    transactionDate: today,
    fundId: funds[0]?.fundId ?? "",
    transactionType: "Purchase",
    amountInvested: "",
    units: "",
    nav: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedFund = useMemo(
    () => funds.find((fund) => fund.fundId === form.fundId) ?? null,
    [funds, form.fundId]
  );
  const isMutualFund =
    (selectedFund?.assetType || "").toLowerCase() === "mutual fund";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setNotice("Saving…");

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          amountInvested: Number(form.amountInvested),
          units: form.units ? Number(form.units) : undefined,
          nav: form.nav ? Number(form.nav) : undefined,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        dashboard?: DashboardData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save the investment.");
      }

      setForm((current) => ({
        ...current,
        transactionType: "Purchase",
        amountInvested: "",
        units: "",
        nav: "",
      }));
      if (payload.dashboard) {
        onDashboardUpdated?.(payload.dashboard);
        setNotice("Saved.");
      } else {
        setNotice("Saved. Updating dashboard…");
        const refreshed = await onSaved?.();
        setNotice(
          refreshed === false
            ? "Saved, but the dashboard didn't refresh (try again)."
            : "Saved."
        );
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unable to save the investment."
      );
      setNotice("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function computeUnits(amountRaw: string, navRaw: string) {
    const amount = Number(amountRaw);
    const nav = Number(navRaw);
    if (!Number.isFinite(amount) || !Number.isFinite(nav) || amount <= 0 || nav <= 0) {
      return "";
    }
    return (amount / nav).toFixed(4);
  }

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <h2>Add a new entry</h2>
        </div>
        <p className="muted">
          Add one row for every new contribution I make. The app writes directly
          into the <code>Transactions</code> sheet and keeps the purchase amount
          rounded the way you asked.
        </p>
      </div>

      <div className="form-grid">
        <label>
          <span>Date</span>
          <input
            type="date"
            value={form.transactionDate}
            onChange={(event) => updateField("transactionDate", event.target.value)}
            required
          />
        </label>

        <label>
          <span>Fund</span>
          <select
            value={form.fundId}
            onChange={(event) => {
              const nextFundId = event.target.value;
              const nextFund =
                funds.find((fund) => fund.fundId === nextFundId) ?? null;
              const nextIsMutualFund =
                (nextFund?.assetType || "").toLowerCase() === "mutual fund";

              setForm((current) => {
                const next = { ...current, fundId: nextFundId };
                if (nextIsMutualFund) {
                  next.units = computeUnits(next.amountInvested, next.nav);
                }
                return next;
              });
            }}
            required
          >
            {funds.map((fund) => (
              <option key={fund.fundId} value={fund.fundId}>
                {fund.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Investment Type</span>
          <select
            value={form.transactionType}
            onChange={(event) => updateField("transactionType", event.target.value)}
            required
          >
            <option value="Purchase">Purchase</option>
            <option value="SIP">SIP</option>
          </select>
        </label>

        <label>
          <span>Purchase Amount</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amountInvested}
            onChange={(event) => {
              const nextAmount = event.target.value;
              setForm((current) => {
                const next = { ...current, amountInvested: nextAmount };
                if (isMutualFund) {
                  next.units = computeUnits(nextAmount, next.nav);
                }
                return next;
              });
            }}
            placeholder="5000"
            required
          />
        </label>

        <label>
          <span>Units</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.units}
            onChange={(event) => updateField("units", event.target.value)}
            placeholder={isMutualFund ? "Auto-calculated" : "Optional"}
            disabled={isMutualFund}
          />
        </label>

        <label>
          <span>NAV</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.nav}
            onChange={(event) => {
              const nextNav = event.target.value;
              setForm((current) => {
                const next = { ...current, nav: nextNav };
                if (isMutualFund) {
                  next.units = computeUnits(next.amountInvested, nextNav);
                }
                return next;
              });
            }}
            placeholder="Optional"
            required={isMutualFund}
          />
        </label>
      </div>

      <div className="form-footer">
        {error ? <p className="error-text">{error}</p> : null}
        {!error && notice ? <p className="muted">{notice}</p> : null}
        <button type="submit" disabled={isSubmitting || !funds.length}>
          Save entry
        </button>
      </div>
    </form>
  );
}
