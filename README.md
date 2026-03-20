# WealthTracker (Investment Dashboard)

A personal Next.js dashboard for tracking investments (transactions, units, NAV) with charts and summaries.

This repo **does not commit your workbook**. The workbook is treated as private data.

## Workbook storage

### Vercel (recommended)

1. Create a **Vercel Blob** store (Storage → Create → Blob). Use **Private**.
2. Upload your workbook to Blob.
3. Set these environment variables in your Vercel project:

- `PORTFOLIO_BLOB_PATHNAME` (example: `wealthtracker/Investment-Tracker.xlsx`)
- `PORTFOLIO_BLOB_ACCESS=private`
- `WEALTHTRACKER_PASSWORD` (required to access the app)

The app downloads the XLSX from Blob on each request and **overwrites the same pathname** after add/edit/delete actions.

### Local dev

1. Copy `.env.example` → `.env.local`
2. Either set `PORTFOLIO_WORKBOOK_PATH` to your `.xlsx`, or generate the default workbook:

```bash
npm run rebuild:workbook
```

## Run

```bash
npm install
npm run dev
```

## What the app shows

- Portfolio totals: purchase value, current value, P/L, return.
- Fund-level purchase vs current value chart.
- Portfolio flow chart over time.
- Yearly contribution totals.
- Category allocation.
- Transaction history table with filters.
- In-browser workbook preview at `/workbook`.
