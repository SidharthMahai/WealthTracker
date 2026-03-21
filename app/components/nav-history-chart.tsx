"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FundOption, TransactionRecord } from "@/lib/types";

type NavHistoryChartProps = {
  transactions: TransactionRecord[];
  funds: FundOption[];
};

type NavPoint = {
  ts: number;
  date: string;
  nav: number;
};

export function NavHistoryChart({ transactions, funds }: NavHistoryChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fundNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const fund of funds) {
      map.set(fund.fundId, fund.name);
    }
    return map;
  }, [funds]);

  const navSeriesByFundId = useMemo(() => {
    const byFund = new Map<string, NavPoint[]>();

    for (const transaction of transactions) {
      if (!transaction.transactionDate) continue;
      if (!(transaction.nav > 0)) continue;

      const ts = Date.parse(`${transaction.transactionDate}T00:00:00Z`);
      if (Number.isNaN(ts)) continue;

      const point: NavPoint = {
        ts,
        date: transaction.transactionDate,
        nav: transaction.nav,
      };

      const points = byFund.get(transaction.fundId);
      if (points) {
        points.push(point);
      } else {
        byFund.set(transaction.fundId, [point]);
      }
    }

    for (const [fundId, points] of byFund.entries()) {
      points.sort((a, b) => a.ts - b.ts);

      // De-dupe by date and keep the latest NAV captured for that date.
      const deduped = new Map<string, NavPoint>();
      for (const point of points) {
        deduped.set(point.date, point);
      }

      byFund.set(
        fundId,
        Array.from(deduped.values()).sort((a, b) => a.ts - b.ts)
      );
    }

    return byFund;
  }, [transactions]);

  const fundIdsWithNav = useMemo(() => {
    const ids = Array.from(navSeriesByFundId.keys());
    ids.sort((a, b) => {
      const left = fundNameById.get(a) || a;
      const right = fundNameById.get(b) || b;
      return left.localeCompare(right);
    });
    return ids;
  }, [fundNameById, navSeriesByFundId]);

  const [activeFundId, setActiveFundId] = useState<string>(() => fundIdsWithNav[0] ?? "");

  useEffect(() => {
    if (!fundIdsWithNav.length) {
      if (activeFundId) setActiveFundId("");
      return;
    }

    if (!activeFundId || !fundIdsWithNav.includes(activeFundId)) {
      setActiveFundId(fundIdsWithNav[0]);
    }
  }, [activeFundId, fundIdsWithNav]);

  const activeSeries = activeFundId ? navSeriesByFundId.get(activeFundId) || [] : [];

  const domains = useMemo(() => {
    if (!activeSeries.length) {
      return {
        x: [0, 1] as [number, number],
        y: [0, 1] as [number, number],
        rangeLabel: "—",
      };
    }

    let minTs = activeSeries[0].ts;
    let maxTs = activeSeries[activeSeries.length - 1].ts;

    let minNav = activeSeries[0].nav;
    let maxNav = activeSeries[0].nav;

    for (const point of activeSeries) {
      minTs = Math.min(minTs, point.ts);
      maxTs = Math.max(maxTs, point.ts);
      minNav = Math.min(minNav, point.nav);
      maxNav = Math.max(maxNav, point.nav);
    }

    if (minTs === maxTs) {
      const month = 1000 * 60 * 60 * 24 * 30;
      minTs -= month;
      maxTs += month;
    }

    const navSpan = Math.max(0.001, maxNav - minNav);
    const navPad = Math.max(0.25, navSpan * 0.12);

    const yMin = Math.max(0, minNav - navPad);
    const yMax = maxNav + navPad;

    return {
      x: [minTs, maxTs] as [number, number],
      y: [yMin, yMax] as [number, number],
      rangeLabel: `${formatMonthYear(minTs)} – ${formatMonthYear(maxTs)}`,
    };
  }, [activeSeries]);

  return (
    <div className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NAV</p>
          <h2>NAV history (per fund)</h2>
        </div>
        <p className="muted">
          Select a fund to see NAV values only for the period you actually have transactions.
        </p>
      </div>

      <div className="fund-select-row">
        <label className="fund-select">
          <span>Fund</span>
          <select
            value={activeFundId}
            onChange={(event) => setActiveFundId(event.target.value)}
            disabled={fundIdsWithNav.length === 0}
          >
            {fundIdsWithNav.map((fundId) => (
              <option key={fundId} value={fundId}>
                {fundNameById.get(fundId) || fundId}
              </option>
            ))}
          </select>
        </label>

        <div className="fund-range">
          <p className="muted">Range</p>
          <strong>{domains.rangeLabel}</strong>
        </div>
      </div>

      <div className="chart-frame nav-chart-frame">
        {fundIdsWithNav.length === 0 ? (
          <p className="muted">No transaction NAV values found yet.</p>
        ) : activeSeries.length === 0 ? (
          <p className="muted">No NAV points found for this fund yet.</p>
        ) : !mounted ? (
          <p className="muted">Loading chart…</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart id="nav-line-chart" data={activeSeries} margin={{ top: 18, right: 20, left: 6, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={domains.x}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tickFormatter={(value) => formatDateTick(Number(value))}
              />
              <YAxis
                type="number"
                domain={domains.y}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatNav(Number(value))}
                width={68}
              />
              <Tooltip
                formatter={(value: number) => [formatNav(value), "NAV"]}
                labelFormatter={(label) => `Date: ${formatDateFull(Number(label))}`}
              />
              <Line
                type="monotone"
                dataKey="nav"
                name="NAV"
                stroke="#22577a"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function formatDateTick(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = MONTH_SHORT[date.getUTCMonth()] ?? "";
  return `${month} ${year}`;
}

function formatDateFull(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = MONTH_SHORT[date.getUTCMonth()] ?? "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day} ${month} ${year}`;
}

function formatMonthYear(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = MONTH_SHORT[date.getUTCMonth()] ?? "";
  return `${month} ${year}`;
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

function formatNav(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(value);
}
