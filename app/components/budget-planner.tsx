"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BudgetPlannerData, BudgetPlannerItem } from "@/lib/types";

type BudgetPlannerProps = {
  budget: BudgetPlannerData;
};

type BudgetFormState = {
  category: string;
  type: "Fixed" | "Variable";
  monthlyAmountUsd: string;
  notes: string;
};

const emptyBudgetForm: BudgetFormState = {
  category: "",
  type: "Fixed",
  monthlyAmountUsd: "",
  notes: "",
};

export function BudgetPlanner({ budget }: BudgetPlannerProps) {
  const router = useRouter();
  const [currentBudget, setCurrentBudget] = useState(budget);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [newItemForm, setNewItemForm] = useState<BudgetFormState>(emptyBudgetForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<BudgetFormState>(emptyBudgetForm);

  useEffect(() => {
    setCurrentBudget(budget);
  }, [budget]);

  function applyBudgetUpdate(next: BudgetPlannerData) {
    setCurrentBudget(next);
    setLastUpdatedAt(Date.now());
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleCreateItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setRefreshing(true);
      setError("");
      const response = await fetch("/api/budget", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: newItemForm.category,
          type: newItemForm.type,
          monthlyAmountUsd: Number(newItemForm.monthlyAmountUsd),
          notes: newItemForm.notes,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        budget?: BudgetPlannerData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create budget item.");
      }

      if (payload.budget) {
        applyBudgetUpdate(payload.budget);
      }

      setNewItemForm(emptyBudgetForm);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to create budget item."
      );
    } finally {
      setRefreshing(false);
    }
  }

  function startEditingItem(item: BudgetPlannerItem) {
    setEditingItemId(item.itemId);
    setEditingForm({
      category: item.category,
      type: item.type,
      monthlyAmountUsd: String(item.monthlyAmountUsd),
      notes: item.notes,
    });
  }

  async function handleSaveItem(itemId: string) {
    try {
      setRefreshing(true);
      setError("");
      const response = await fetch("/api/budget", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          category: editingForm.category,
          type: editingForm.type,
          monthlyAmountUsd: Number(editingForm.monthlyAmountUsd),
          notes: editingForm.notes,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        budget?: BudgetPlannerData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update budget item.");
      }

      if (payload.budget) {
        applyBudgetUpdate(payload.budget);
      }
      setEditingItemId(null);
      setEditingForm(emptyBudgetForm);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to update budget item."
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!window.confirm("Delete this budget line?")) {
      return;
    }

    try {
      setRefreshing(true);
      setError("");
      const response = await fetch("/api/budget", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        budget?: BudgetPlannerData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete budget item.");
      }

      if (payload.budget) {
        applyBudgetUpdate(payload.budget);
      }
      if (editingItemId === itemId) {
        setEditingItemId(null);
        setEditingForm(emptyBudgetForm);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to delete budget item."
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero budget-hero">
        <div>
          <p className="eyebrow">Budget Planner</p>
          <h1>Plan monthly spending before it shows up in the card statement.</h1>
          <p className="hero-copy">
            Keep a lightweight USD planner for your fixed bills and variable
            spending buckets. This is a planning surface, not expense logging.
          </p>
          {refreshing ? <p className="muted">Updating…</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          {lastUpdatedAt ? (
            <p className="muted">
              Last updated:{" "}
              {new Intl.DateTimeFormat("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(new Date(lastUpdatedAt))}
            </p>
          ) : null}
        </div>

        <div className="hero-card">
          <p className="muted">Workbook</p>
          <h2>{currentBudget.workbookName}</h2>
          <p className="muted hero-path">{currentBudget.workbookPath}</p>
          <div className="workbook-actions">
            <a className="workbook-link" href="/api/workbook" target="_blank" rel="noreferrer">
              Open .xlsx
            </a>
          </div>
        </div>
      </section>

      <section className="metrics-grid budget-metrics-grid">
        <MetricCard
          label="Fixed monthly"
          value={formatUsd(currentBudget.totals.fixedMonthlyUsd)}
          detail="Recurring monthly commitments"
        />
        <MetricCard
          label="Variable monthly"
          value={formatUsd(currentBudget.totals.variableMonthlyUsd)}
          detail="Flexible monthly buckets"
        />
        <MetricCard
          label="Planned monthly total"
          value={formatUsd(currentBudget.totals.totalMonthlyUsd)}
          detail="Combined monthly budget"
        />
      </section>

      <section className="wide-grid">
        <form className="panel inset-panel" onSubmit={handleCreateItem}>
          <div className="panel-heading compact-heading">
            <div>
              <h2>Add budget line</h2>
            </div>
            <p className="muted">Use one line per category or spending bucket.</p>
          </div>

          <div className="form-grid">
            <label>
              <span>Category</span>
              <input
                type="text"
                value={newItemForm.category}
                onChange={(event) =>
                  setNewItemForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label>
              <span>Type</span>
              <select
                value={newItemForm.type}
                onChange={(event) =>
                  setNewItemForm((current) => ({
                    ...current,
                    type: event.target.value as "Fixed" | "Variable",
                  }))
                }
              >
                <option value="Fixed">Fixed</option>
                <option value="Variable">Variable</option>
              </select>
            </label>

            <label>
              <span>Monthly Amount (USD)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newItemForm.monthlyAmountUsd}
                onChange={(event) =>
                  setNewItemForm((current) => ({
                    ...current,
                    monthlyAmountUsd: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label>
              <span>Notes</span>
              <input
                type="text"
                value={newItemForm.notes}
                onChange={(event) =>
                  setNewItemForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </label>
          </div>

          <div className="form-footer">
            <p className="muted">Stored in the workbook’s `Budget Planner` sheet.</p>
            <button type="submit" disabled={refreshing}>
              Add budget line
            </button>
          </div>
        </form>

        <section className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Monthly Plan</p>
              <h2>Budget categories</h2>
            </div>
            <p className="muted">
              Fixed items and variable buckets together give you the monthly picture.
            </p>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Monthly Amount</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentBudget.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No budget lines yet.
                    </td>
                  </tr>
                ) : (
                  currentBudget.items.map((item) => {
                    const isEditing = editingItemId === item.itemId;

                    return (
                      <tr key={item.itemId}>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingForm.category}
                              onChange={(event) =>
                                setEditingForm((current) => ({
                                  ...current,
                                  category: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            <strong>{item.category}</strong>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select
                              value={editingForm.type}
                              onChange={(event) =>
                                setEditingForm((current) => ({
                                  ...current,
                                  type: event.target.value as "Fixed" | "Variable",
                                }))
                              }
                            >
                              <option value="Fixed">Fixed</option>
                              <option value="Variable">Variable</option>
                            </select>
                          ) : (
                            item.type
                          )}
                        </td>
                        <td className="numeric-cell">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingForm.monthlyAmountUsd}
                              onChange={(event) =>
                                setEditingForm((current) => ({
                                  ...current,
                                  monthlyAmountUsd: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            formatUsd(item.monthlyAmountUsd)
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingForm.notes}
                              onChange={(event) =>
                                setEditingForm((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                            />
                          ) : (
                            item.notes || "—"
                          )}
                        </td>
                        <td className="actions-cell">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => handleSaveItem(item.itemId)}
                                disabled={refreshing}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                  setEditingItemId(null);
                                  setEditingForm(emptyBudgetForm);
                                }}
                                disabled={refreshing}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => startEditingItem(item)}
                                disabled={refreshing}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="link-button danger-button"
                                onClick={() => handleDeleteItem(item.itemId)}
                                disabled={refreshing}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <h2>{value}</h2>
      <span className="metric-detail">{detail}</span>
    </article>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
