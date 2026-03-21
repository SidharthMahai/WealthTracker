type FxQuote = {
  inrPerUsd: number;
  asOf: string;
  source: string;
};

type StockQuote = {
  ticker: string;
  priceUsd: number;
  asOf: string;
  source: string;
};

const DEFAULT_TIMEOUT_MS = 6500;
const FX_CACHE_TTL_MS = 10 * 60 * 1000;
const STOCK_CACHE_TTL_MS = 5 * 60 * 1000;

let fxCache: { fetchedAt: number; quote: FxQuote } | null = null;
const stockCache = new Map<string, { fetchedAt: number; quote: StockQuote }>();

function formatIsoDateUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "text/plain,*/*",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function toNumber(value: unknown) {
  const numeric = typeof value === "string" ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchUsdInrFx(): Promise<FxQuote> {
  const now = new Date();
  if (fxCache && Date.now() - fxCache.fetchedAt < FX_CACHE_TTL_MS) {
    return fxCache.quote;
  }

  try {
    const payload = await fetchJson<{
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    }>("https://open.er-api.com/v6/latest/USD");

    const inrPerUsd = toNumber(payload.rates?.INR);
    if (!inrPerUsd) {
      throw new Error("INR rate missing.");
    }

    const quote = {
      inrPerUsd,
      asOf: payload.time_last_update_utc || formatIsoDateUtc(now),
      source: "open.er-api.com",
    };
    fxCache = { fetchedAt: Date.now(), quote };
    return quote;
  } catch {
    const payload = await fetchJson<{
      success?: boolean;
      base?: string;
      date?: string;
      rates?: Record<string, number>;
    }>("https://api.exchangerate.host/latest?base=USD&symbols=INR");

    const inrPerUsd = toNumber(payload.rates?.INR);
    if (!inrPerUsd) {
      throw new Error("INR rate missing.");
    }

    const quote = {
      inrPerUsd,
      asOf: payload.date || formatIsoDateUtc(now),
      source: "exchangerate.host",
    };
    fxCache = { fetchedAt: Date.now(), quote };
    return quote;
  }
}

async function fetchStooqDailyClose(symbol: string): Promise<{ close: number; date: string }> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2c&h&e=csv`;
  const csv = await fetchText(url);
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("Unexpected CSV.");
  }

  const header = lines[0].split(",");
  const row = lines[1].split(",");
  const closeIndex = header.findIndex((col) => col.toLowerCase() === "close");
  const dateIndex = header.findIndex((col) => col.toLowerCase() === "date");
  const close = closeIndex >= 0 ? toNumber(row[closeIndex]) : 0;
  const date = dateIndex >= 0 ? String(row[dateIndex] || "") : "";
  if (!close) {
    throw new Error("Close missing.");
  }

  return { close, date };
}

async function fetchYahooQuote(ticker: string): Promise<{ price: number; time: number }> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
  const payload = await fetchJson<{
    quoteResponse?: { result?: Array<{ regularMarketPrice?: number; regularMarketTime?: number }> };
  }>(url);

  const result = payload.quoteResponse?.result?.[0];
  const price = toNumber(result?.regularMarketPrice);
  const time = toNumber(result?.regularMarketTime);
  if (!price) {
    throw new Error("Yahoo price missing.");
  }

  return { price, time };
}

async function fetchStockQuoteUsd(ticker: string): Promise<StockQuote> {
  const now = new Date();
  const upper = ticker.trim().toUpperCase();
  const cached = stockCache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < STOCK_CACHE_TTL_MS) {
    return cached.quote;
  }

  try {
    const symbol = `${upper.toLowerCase()}.us`;
    const { close, date } = await fetchStooqDailyClose(symbol);
    const quote = {
      ticker: upper,
      priceUsd: close,
      asOf: date || formatIsoDateUtc(now),
      source: "stooq.com",
    };
    stockCache.set(upper, { fetchedAt: Date.now(), quote });
    return quote;
  } catch {
    const { price, time } = await fetchYahooQuote(upper);
    const asOf = time ? formatIsoDateUtc(new Date(time * 1000)) : formatIsoDateUtc(now);
    const quote = {
      ticker: upper,
      priceUsd: price,
      asOf,
      source: "finance.yahoo.com",
    };
    stockCache.set(upper, { fetchedAt: Date.now(), quote });
    return quote;
  }
}

export async function fetchStockInrQuote(ticker: string) {
  const [fx, stock] = await Promise.all([fetchUsdInrFx(), fetchStockQuoteUsd(ticker)]);
  const priceInr = stock.priceUsd * fx.inrPerUsd;

  return {
    ticker: stock.ticker,
    priceUsd: stock.priceUsd,
    fxInrPerUsd: fx.inrPerUsd,
    priceInr,
    asOf: `${stock.asOf} · ${fx.asOf}`,
    source: `${stock.source} + ${fx.source}`,
  };
}
