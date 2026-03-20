"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FundOption } from "@/lib/types";

type AddInvestmentFormProps = {
  funds: FundOption[];
};

export function AddInvestmentForm({ funds }: AddInvestmentFormProps) {
  const router = useRouter();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [form, setForm] = useState({
    transactionDate: today,
    fundId: funds[0]?.fundId ?? "",
    amountInvested: "",
    units: "",
    nav: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
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

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save the investment.");
      }

      setForm((current) => ({
        ...current,
        amountInvested: "",
        units: "",
        nav: "",
      }));
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unable to save the investment."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
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
            onChange={(event) => updateField("fundId", event.target.value)}
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
          <span>Purchase Amount</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amountInvested}
            onChange={(event) => updateField("amountInvested", event.target.value)}
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
            placeholder="Optional"
          />
        </label>

        <label>
          <span>NAV</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.nav}
            onChange={(event) => updateField("nav", event.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="form-footer">
        {error ? (
          <p className="error-text">{error}</p>
        ) : (
          <p className="muted">Saved entries appear after refresh.</p>
        )}
        <button type="submit" disabled={isSubmitting || !funds.length}>
          {isSubmitting ? "Saving..." : "Save new entry"}
        </button>
      </div>
    </form>
  );
}
