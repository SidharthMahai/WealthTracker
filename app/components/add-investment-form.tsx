"use client";

import { useMemo, useState } from "react";
import type { DashboardData, FundOption } from "@/lib/types";

type AddInvestmentFormProps = {
  onAssetsUpdated?: () => Promise<void>;
  funds: FundOption[];
  onSaved?: () => Promise<boolean | void> | boolean | void;
  onDashboardUpdated?: (dashboard: DashboardData) => void;
};

export function AddInvestmentForm({
  funds,
  onSaved,
  onDashboardUpdated,
  onAssetsUpdated,
}: AddInvestmentFormProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [form, setForm] = useState({
    transactionDate: today,
    fundId: funds[0]?.fundId ?? "",
    transactionType: "Purchase",
    direction: "Contribution" as "Contribution" | "Redemption",
    amountInvested: "",
    units: "",
    nav: "",
    currentNav: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [karat, setKarat] = useState("22");
  const isGold = form.fundId === "__physical_gold__";

  const selectedFund = useMemo(
    () => funds.find((fund) => fund.fundId === form.fundId) ?? null,
    [funds, form.fundId]
  );
  const selectedAssetType = (selectedFund?.assetType || "").toLowerCase();
  const isMutualFund = selectedAssetType === "mutual fund";
  const isGovtScheme = selectedAssetType === "govt scheme";
  const isInterestCredited = form.transactionType === "Interest Credited";
  const entryTypeOptions = useMemo(() => {
    if (isGold) return [{ label: "Purchase", value: "Purchase" }, { label: "Gift", value: "Gift" }];
    const options = [{ label: "Lumpsum", value: "Purchase" }];
    if (isMutualFund) {
      options.push({ label: "SIP", value: "SIP" });
    }
    if (isGovtScheme) {
      options.push({ label: "Interest Credited", value: "Interest Credited" });
    }
    options.push({ label: "Redemption", value: "Redemption" });
    return options;
  }, [isGovtScheme, isMutualFund, isGold]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setNotice("Saving…");

    try {
      if (isGold) {
        const response = await fetch("/api/assets", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "gold", acquisition: form.transactionType, date: form.transactionDate, grams: Number(form.units), karat: Number(karat) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to save gold.");
        await onAssetsUpdated?.();
        setForm(current => ({ ...current, units: "" }));
        setNotice("Saved.");
        return;
      }
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
          currentNav: form.currentNav ? Number(form.currentNav) : undefined,
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
        direction: "Contribution",
        amountInvested: "",
        units: "",
        nav: "",
        currentNav: "",
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
    const units = amount / nav;
    if (!Number.isFinite(units) || units <= 0) {
      return "";
    }
    return String(roundUnitsForDisplay(units, isMutualFund ? 3 : 4));
  }

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <h2>Add new transaction</h2>
        </div>
        <p className="muted">
          Add investments, interest, redemptions, or gold purchases and gifts.
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
          <span>Asset</span>
          <select
            value={form.fundId}
            onChange={(event) => {
              const nextFundId = event.target.value;
              const nextFund =
                funds.find((fund) => fund.fundId === nextFundId) ?? null;
              const nextIsMutualFund =
                (nextFund?.assetType || "").toLowerCase() === "mutual fund";
              const nextIsGovtScheme =
                (nextFund?.assetType || "").toLowerCase() === "govt scheme";

              setForm((current) => {
                const next = { ...current, fundId: nextFundId, transactionType: "Purchase", direction: "Contribution" as const, units: "", amountInvested: "", nav: "" };
                if (!nextIsMutualFund && next.transactionType === "SIP") {
                  next.transactionType = "Purchase";
                }
                if (!nextIsGovtScheme && next.transactionType === "Interest Credited") {
                  next.transactionType = "Purchase";
                }
                if (nextIsMutualFund) {
                  next.units = computeUnits(next.amountInvested, next.nav);
                }
                return next;
              });
            }}
            required
          >
            {[...funds, { fundId: "__physical_gold__", name: "Physical gold", assetType: "Gold" }]
              .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base", numeric: true }))
              .map((fund) => (
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
            onChange={(event) => {
              const nextType = event.target.value;
              setForm((current) => ({
                ...current,
                transactionType: nextType,
                direction:
                  nextType === "Redemption" ? "Redemption" : "Contribution",
              }));
            }}
            required
          >
            {entryTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {isGold ? (
          <>
            <label><span>Purity (KT)</span><input type="number" min="1" max="24" step="1" value={karat} onChange={event => setKarat(event.target.value)} required /></label>
            <label><span>Weight (grams)</span><input type="number" min="0.001" step="0.001" value={form.units} onChange={event => updateField("units", event.target.value)} required /></label>
            <p className="muted">Current value uses the Delhi 24K rate per gram, adjusted for weight and purity. Excludes making charges and taxes.</p>
          </>
        ) : (<>
        <label>
          <span>
            {form.direction === "Redemption"
              ? "Redemption Amount"
              : isInterestCredited
                ? "Credited Amount"
                : "Purchase Amount"}
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amountInvested}
            onChange={(event) => {
              const nextAmount = event.target.value;
              setForm((current) => {
                const next = { ...current, amountInvested: nextAmount };
                if (isMutualFund || isGovtScheme) {
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
            step={isMutualFund ? "0.001" : "0.0001"}
            value={form.units}
            onChange={(event) => updateField("units", event.target.value)}
            placeholder={isMutualFund ? "Auto-calculated" : "Optional"}
            disabled={isMutualFund}
          />
        </label>

        <label>
          <span>{isMutualFund ? "Transaction NAV" : "NAV"}</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.nav}
            onChange={(event) => {
              const nextNav = event.target.value;
              setForm((current) => {
                const next = { ...current, nav: nextNav };
                if (isMutualFund || isGovtScheme) {
                  next.units = computeUnits(next.amountInvested, nextNav);
                }
                return next;
              });
            }}
            placeholder="Optional"
            required={isMutualFund}
          />
        </label>

        {isMutualFund ? (
          <label>
            <span>Current NAV</span>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={form.currentNav}
              onChange={(event) => updateField("currentNav", event.target.value)}
              placeholder="Optional"
            />
          </label>
        ) : null}
        </>)}
      </div>

      <div className="form-footer">
        {error ? <p className="error-text">{error}</p> : null}
        {!error && notice ? <p className="muted">{notice}</p> : null}
        <button type="submit" disabled={isSubmitting || (!isGold && !funds.length)}>
          Save entry
        </button>
      </div>
    </form>
  );
}

function roundUnitsForDisplay(value: number, decimals: number) {
  return Number(value.toFixed(decimals));
}
