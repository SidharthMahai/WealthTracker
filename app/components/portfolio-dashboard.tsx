"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AddInvestmentForm } from "@/app/components/add-investment-form";
import { TransactionHistoryTable } from "@/app/components/transaction-history-table";
import { NavHistoryChart } from "@/app/components/nav-history-chart";
import type { DashboardData } from "@/lib/types";

type PortfolioDashboardProps = {
  dashboard: DashboardData;
};

const allocationColors = [
  "#22577a",
  "#57cc99",
  "#c7d2fe",
  "#c44536",
  "#7b6d8d",
  "#2a9d8f",
];

const RADIAN = Math.PI / 180;

export function PortfolioDashboard({ dashboard }: PortfolioDashboardProps) {
  const [currentDashboard, setCurrentDashboard] = useState(dashboard);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setCurrentDashboard(dashboard);
  }, [dashboard]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("investment-theme");
    const preferredTheme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    setTheme(preferredTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("investment-theme", theme);
  }, [theme]);

  async function fetchDashboardSnapshot(): Promise<DashboardData> {
    const response = await fetch(`/api/dashboard?ts=${Date.now()}`, {
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error("Could not refresh the dashboard data.");
    }

    return (await response.json()) as DashboardData;
  }

  async function refreshDashboard(): Promise<boolean> {
    setRefreshing(true);
    setRefreshError("");

    try {
      const payload = await fetchDashboardSnapshot();
      setCurrentDashboard(payload);
      setLastUpdatedAt(Date.now());

      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 180);
      });

      const secondPayload = await fetchDashboardSnapshot();
      setCurrentDashboard(secondPayload);
      setLastUpdatedAt(Date.now());
      return true;
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Could not refresh the dashboard data."
      );
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  const fundChartWidth = useMemo(
    () => Math.max(1760, currentDashboard.fundChart.length * 200),
    [currentDashboard.fundChart.length]
  );

  const workbookConfigured =
    currentDashboard.workbookName !== "No workbook configured";

  function applyDashboardUpdate(next: DashboardData) {
    setCurrentDashboard(next);
    setLastUpdatedAt(Date.now());
  }

  async function updateLatestNavForFund(fund: {
    fundId: string;
    name: string;
    latestNav: number;
  }) {
    const navInput = window.prompt(
      `Update latest NAV for ${fund.name} (INR):`,
      fund.latestNav ? String(fund.latestNav) : ""
    );

    if (navInput === null) {
      return;
    }

    const nextNav = Number(navInput);
    if (!Number.isFinite(nextNav) || nextNav <= 0) {
      window.alert("Please enter a valid NAV number.");
      return;
    }

    const dateDefault = new Date().toISOString().slice(0, 10);
    const dateInput = window.prompt(
      "NAV date (YYYY-MM-DD):",
      dateDefault
    );
    if (dateInput === null) {
      return;
    }

    try {
      setRefreshing(true);
      setRefreshError("");
      const response = await fetch("/api/funds", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId: fund.fundId,
          latestNav: nextNav,
          latestNavDate: dateInput || dateDefault,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        dashboard?: DashboardData;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update NAV.");
      }

      if (payload.dashboard) {
        applyDashboardUpdate(payload.dashboard);
      } else {
        await refreshDashboard();
      }
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : "Unable to update NAV."
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">My Investment Tracker</p>
          <h1>One place for my workbook, entries, and charts.</h1>
          <p className="hero-copy">
            This is a personal dashboard for my own investments, with INR-first
            numbers, rounded purchase amounts, and clear units and NAV tracking.
          </p>
          {refreshing ? <p className="muted">Updating…</p> : null}
          {refreshError ? <p className="error-text">{refreshError}</p> : null}
          {lastUpdatedAt ? (
            <p className="muted">
              Last updated:{" "}
              {new Intl.DateTimeFormat("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(new Date(lastUpdatedAt))}
            </p>
          ) : null}
        </div>

        <div className="hero-card">
          <div className="hero-card-row">
            <div>
              <p className="muted">Workbook</p>
              <h2>{currentDashboard.workbookName}</h2>
            </div>
            <button
              type="button"
              className="theme-toggle"
              onClick={() =>
                setTheme((currentTheme) =>
                  currentTheme === "light" ? "dark" : "light"
                )
              }
            >
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
          </div>

          <p className="muted hero-path">{currentDashboard.workbookPath}</p>
          <div className="workbook-actions">
            <a className="workbook-link" href="/workbook" target="_blank" rel="noreferrer">
              Open workbook viewer
            </a>
            {workbookConfigured ? (
              <a
                className="workbook-link workbook-link-secondary"
                href="/api/workbook"
                target="_blank"
                rel="noreferrer"
              >
                Open .xlsx
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="Net worth (current)"
          value={formatInrCompact(currentDashboard.metrics.netWorthCurrentValue)}
          detail={formatInrFull(currentDashboard.metrics.netWorthCurrentValue)}
        />
        <MetricCard
          label="Mutual funds (purchase)"
          value={formatInrCompact(currentDashboard.metrics.mutualFundPurchaseValue)}
          detail={formatInrFull(currentDashboard.metrics.mutualFundPurchaseValue)}
        />
        <MetricCard
          label="Mutual funds (current)"
          value={formatInrCompact(currentDashboard.metrics.mutualFundCurrentValue)}
          detail={
            <>
              {formatInrFull(currentDashboard.metrics.mutualFundCurrentValue)} ·{" "}
              <strong>
                Return {formatPercent(currentDashboard.metrics.mutualFundAbsoluteReturn)}
              </strong>
            </>
          }
        />
        <MetricCard
          label="Mutual funds (profit/loss)"
          value={formatInrCompact(currentDashboard.metrics.mutualFundProfitLoss)}
          detail={
            <>
              {formatInrFull(currentDashboard.metrics.mutualFundProfitLoss)} ·{" "}
              <strong>
                Return {formatPercent(currentDashboard.metrics.mutualFundAbsoluteReturn)}
              </strong>
            </>
          }
          tone={
            currentDashboard.metrics.mutualFundProfitLoss >= 0 ? "positive" : "negative"
          }
        />
        <MetricCard
          label="Stocks (current)"
          value={formatInrCompact(currentDashboard.metrics.stockCurrentValue)}
          detail={formatInrFull(currentDashboard.metrics.stockCurrentValue)}
          tone="positive"
        />
        <MetricCard
          label="Govt schemes (purchase)"
          value={formatInrCompact(currentDashboard.metrics.schemePurchaseValue)}
          detail={formatInrFull(currentDashboard.metrics.schemePurchaseValue)}
        />
        <MetricCard
          label="Govt schemes (current)"
          value={formatInrCompact(currentDashboard.metrics.schemeCurrentValue)}
          detail={
            <>
              {formatInrFull(currentDashboard.metrics.schemeCurrentValue)} ·{" "}
              <strong>
                Return {formatPercent(currentDashboard.metrics.schemeAbsoluteReturn)}
              </strong>
            </>
          }
        />
        <MetricCard
          label="Govt schemes (interest)"
          value={formatInrCompact(currentDashboard.metrics.schemeInterestCredited)}
          detail={
            <>
              {formatInrFull(currentDashboard.metrics.schemeInterestCredited)} ·{" "}
              <strong>
                Return {formatPercent(currentDashboard.metrics.schemeAbsoluteReturn)}
              </strong>
            </>
          }
          tone={
            currentDashboard.metrics.schemeInterestCredited >= 0 ? "positive" : "negative"
          }
        />
      </section>

      <section className="wide-grid">
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">By Fund</p>
              <h2>Purchase value vs current value</h2>
            </div>
            <p className="muted">
              Full fund names stay readable here, even when the list gets long.
            </p>
          </div>

          <div className="chart-scroll">
            <div className="chart-frame wide-chart-frame" style={{ width: `${fundChartWidth}px` }}>
              <BarChart
                id="fund-bar-chart"
                width={fundChartWidth}
                height={400}
                data={currentDashboard.fundChart}
                margin={{ top: 26, right: 20, left: 8, bottom: 54 }}
                barCategoryGap={24}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  height={120}
                  angle={-45}
                  textAnchor="end"
                  tickMargin={16}
                  tick={renderFundTick}
                />
                <YAxis
                  tickFormatter={(value) => formatAxisLakhs(value)}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(34, 87, 122, 0.05)" }}
                  formatter={(value: number, _name: string, item) => {
                    const label =
                      item?.dataKey === "invested" ? "Purchase value" : "Current value";
                    return [formatInrFull(Number(value)), label];
                  }}
                />
                <Bar
                  dataKey="invested"
                  isAnimationActive={false}
                  name="Purchase value"
                  fill="#22577a"
                  radius={[8, 8, 0, 0]}
                  activeBar={{
                    fill: "#1f4d6d",
                    stroke: "rgba(31, 77, 109, 0.25)",
                    strokeWidth: 1,
                    filter: "drop-shadow(0px 8px 14px rgba(31, 77, 109, 0.22))",
                  }}
                >
                  <LabelList
                    dataKey="invested"
                    position="top"
                    formatter={(value: number) => formatChartTopLabel(value)}
                    className="chart-label"
                  />
                </Bar>
                <Bar
                  dataKey="currentValue"
                  isAnimationActive={false}
                  name="Current value"
                  radius={[8, 8, 0, 0]}
                  activeBar={{
                    stroke: "rgba(34, 87, 122, 0.2)",
                    strokeWidth: 1,
                    filter: "drop-shadow(0px 8px 14px rgba(34, 87, 122, 0.16))",
                  }}
                >
                  <LabelList
                    dataKey="currentValue"
                    position="top"
                    formatter={(value: number) => formatChartTopLabel(value)}
                    className="chart-label"
                  />
                  {currentDashboard.fundChart.map((fund) => (
                    <Cell
                      key={fund.fundId}
                      fill={fund.currentValue >= fund.invested ? "#57cc99" : "#c44536"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Portfolio Flow</p>
              <h2>Purchase value vs current value flow</h2>
            </div>
            <p className="muted">Current value uses the latest statement NAV for held units.</p>
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                id="portfolio-flow-chart"
                data={currentDashboard.portfolioFlowChart}
              >
                <defs>
                  <linearGradient id="purchaseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22577a" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#22577a" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="currentGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#57cc99" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#57cc99" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="period"
                  tickFormatter={formatPeriodTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(value) => formatAxisLakhs(value)}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatInrFull(value),
                    name === "Purchase value" ? "Purchase value" : "Current value",
                  ]}
                  labelFormatter={(label) => `Period: ${formatPeriodLabel(label)}`}
                />
                <Area
                  type="monotone"
                  dataKey="purchaseValue"
                  isAnimationActive={false}
                  name="Purchase value"
                  stroke="#22577a"
                  fillOpacity={1}
                  fill="url(#purchaseGradient)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#22577a", fill: "#ffffff" }}
                />
                <Area
                  type="monotone"
                  dataKey="currentValueGain"
                  isAnimationActive={false}
                  name="Current value"
                  stroke="#57cc99"
                  fillOpacity={0.9}
                  fill="url(#currentGradient)"
                  connectNulls
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#57cc99", fill: "#ffffff" }}
                />
                <Area
                  type="monotone"
                  dataKey="currentValueLoss"
                  isAnimationActive={false}
                  name="Current value"
                  stroke="#c44536"
                  fillOpacity={0.12}
                  fill="#f5b0a7"
                  connectNulls
                  legendType="none"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#c44536", fill: "#ffffff" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {workbookConfigured ? (
          <AddInvestmentForm
            funds={currentDashboard.funds}
            onSaved={refreshDashboard}
            onDashboardUpdated={applyDashboardUpdate}
          />
        ) : null}
      </section>

      <section className="content-grid">
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Every Year</p>
              <h2>Yearly contribution bar chart</h2>
            </div>
            <p className="muted">One bar for each financial year&apos;s total invested amount.</p>
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                id="yearly-contrib-chart"
                data={currentDashboard.yearlyChart}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="financialYear" tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(value) => formatAxisLakhs(value)}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(34, 87, 122, 0.05)" }}
                  formatter={(value: number) => [formatInrFull(value), "Invested"]}
                />
                <Bar
                  dataKey="contributions"
                  isAnimationActive={false}
                  name="Yearly contributions"
                  fill="#22577a"
                  radius={[8, 8, 0, 0]}
                  activeBar={{
                    fill: "#1f4d6d",
                    stroke: "rgba(31, 77, 109, 0.25)",
                    strokeWidth: 1,
                    filter: "drop-shadow(0px 8px 14px rgba(31, 77, 109, 0.22))",
                  }}
                >
                  <LabelList
                    dataKey="contributions"
                    position="top"
                    formatter={(value: number) => formatChartTopLabel(value)}
                    className="chart-label"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Allocation</p>
              <h2>Current value by category</h2>
            </div>
            <p className="muted">Category values are shown here even without hover.</p>
          </div>

          <div className="allocation-layout">
            <div className="allocation-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart id="allocation-pie-chart" margin={{ top: 8, right: 28, bottom: 8, left: 28 }}>
                  <Pie
                    data={currentDashboard.categoryChart}
                    isAnimationActive={false}
                    dataKey="currentValue"
                    nameKey="category"
                    innerRadius={62}
                    outerRadius={106}
                    paddingAngle={4}
                    labelLine
                    label={renderAllocationOutsidePercentLabel}
                  >
                    {currentDashboard.categoryChart.map((entry, index) => (
                      <Cell
                        key={entry.category}
                        fill={allocationColors[index % allocationColors.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatInrFull(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="allocation-legend">
              {currentDashboard.categoryChart.map((category, index) => {
                const share =
                  currentDashboard.metrics.netWorthCurrentValue === 0
                    ? 0
                    : category.currentValue /
                      currentDashboard.metrics.netWorthCurrentValue;

                return (
                  <div className="allocation-item" key={category.category}>
                    <span
                      className="allocation-swatch"
                      style={{
                        backgroundColor:
                          allocationColors[index % allocationColors.length],
                      }}
                    />
                    <div>
                      <strong>{category.category}</strong>
                      <p>
                        {formatInrFull(category.currentValue)} · {formatPercent(share)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {workbookConfigured ? (
        <section className="wide-grid">
          <NavHistoryChart
            transactions={currentDashboard.transactions}
            funds={currentDashboard.funds}
          />
        </section>
      ) : null}

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Holdings</p>
            <h2>Fund summary</h2>
          </div>
          <p className="muted">
            Purchase value is recalculated from the transaction history, and current
            value uses the latest NAV for the remaining units.
          </p>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fund</th>
                <th>Category</th>
                <th>Type</th>
                <th>Purchase Value</th>
                <th>Current Value</th>
                <th>Profit or Loss</th>
                <th>Return</th>
                <th>Update</th>
              </tr>
            </thead>
            <tbody>
              {currentDashboard.fundSummaries.map((fund) => (
                <tr key={fund.fundId}>
                  <td>
                    <strong>{fund.name}</strong>
                    <span className="subtle-line">Folio {fund.folioNumber}</span>
                  </td>
                  <td>{fund.category}</td>
                  <td>{fund.assetType || "—"}</td>
                  <td className="numeric-cell">
                    {fund.assetType === "Stock" ? "—" : formatInrFull(fund.totalInvested)}
                  </td>
                  <td className="numeric-cell">{formatInrFull(fund.currentValue)}</td>
                  <td
                    className={`numeric-cell ${
                      fund.profitLoss >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {fund.assetType === "Stock" ? "—" : formatInrFull(fund.profitLoss)}
                  </td>
                  <td
                    className={`numeric-cell ${
                      fund.absoluteReturn >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {fund.assetType === "Stock" ? "—" : formatPercent(fund.absoluteReturn)}
                  </td>
                  <td className="actions-cell">
                    {fund.assetType === "Mutual Fund" ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => updateLatestNavForFund(fund)}
                        disabled={refreshing}
                      >
                        Edit NAV
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {workbookConfigured ? (
        <TransactionHistoryTable
          transactions={currentDashboard.transactions}
          funds={currentDashboard.funds}
          onChanged={refreshDashboard}
          onDashboardUpdated={applyDashboardUpdate}
        />
      ) : null}
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <p>{label}</p>
      <h2>{value}</h2>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </article>
  );
}

function formatInrFull(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInrCompact(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 10000000) {
    return `₹${(value / 10000000).toFixed(2)} crore`;
  }
  if (absoluteValue >= 100000) {
    return `₹${(value / 100000).toFixed(2)} lakh`;
  }
  if (absoluteValue >= 1000) {
    return `₹${(value / 1000).toFixed(1)}k`;
  }
  return formatInrFull(value);
}

function formatAxisLakhs(value: number) {
  if (Math.abs(value) >= 100000) {
    return `${(value / 100000).toFixed(1)}L`;
  }
  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(Math.round(value));
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatChartTopLabel(value: number) {
  if (Math.abs(value) >= 100000) {
    return `₹${(value / 100000).toFixed(1)}L`;
  }
  if (Math.abs(value) >= 1000) {
    return `₹${Math.round(value / 1000)}k`;
  }
  return `₹${Math.round(value)}`;
}

function formatAllocationLabel(value: number) {
  if (value < 0.05) {
    return "";
  }

  return formatPercent(value);
}

function renderAllocationOutsidePercentLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
}) {
  const {
    cx = 0,
    cy = 0,
    midAngle = 0,
    innerRadius = 0,
    outerRadius = 0,
    percent = 0,
  } = props;

  const label = formatAllocationLabel(percent);
  if (!label) {
    return null;
  }

  const radius = outerRadius + 18;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      style={{
        fill: "var(--text)",
        fontSize: 13,
        fontWeight: 700,
        pointerEvents: "none",
      }}
    >
      {label}
    </text>
  );
}

function renderFundTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const { x = 0, y = 0, payload } = props;
  const value = payload?.value ?? "";
  const [firstLine, secondLine] = splitFundLabel(value);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="end"
        fill="var(--muted)"
        fontSize={12}
        transform="rotate(-45)"
      >
        <tspan x={0} dy={0}>
          {firstLine}
        </tspan>
        {secondLine ? (
          <tspan x={0} dy={14}>
            {secondLine}
          </tspan>
        ) : null}
      </text>
    </g>
  );
}

function splitFundLabel(name: string) {
  const words = name.split(" ");
  if (words.length <= 2) {
    return [name, ""] as const;
  }

  const maxLineLength = 18;
  let firstLineWords: string[] = [];
  let secondLineWords: string[] = [];

  for (const word of words) {
    if (secondLineWords.length > 0) {
      secondLineWords.push(word);
      continue;
    }

    const candidate = [...firstLineWords, word].join(" ");
    if (candidate.length <= maxLineLength || firstLineWords.length === 0) {
      firstLineWords.push(word);
      continue;
    }

    secondLineWords = [word];
  }

  if (secondLineWords.length === 0) {
    const midpoint = Math.ceil(words.length / 2);
    firstLineWords = words.slice(0, midpoint);
    secondLineWords = words.slice(midpoint);
  }

  return [firstLineWords.join(" "), secondLineWords.join(" ")] as const;
}

function formatPeriodTick(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return value;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return value;
  }

  return `${MONTH_SHORT[monthIndex] ?? ""} ${year}`;
}

function formatPeriodLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return value;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return value;
  }

  return `${MONTH_LONG[monthIndex] ?? ""} ${year}`;
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

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
