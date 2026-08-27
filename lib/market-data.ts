import YahooFinance from "yahoo-finance2";

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
const yahooFinance = new YahooFinance();

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

function toNumber(value: unknown) {
  const numeric = typeof value === "string" ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function fetchUsdInrFx(): Promise<FxQuote> {
  const now = new Date();

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
    return quote;
  }
}

async function fetchStockQuoteUsd(ticker: string): Promise<StockQuote> {
  const now = new Date();
  const upper = ticker.trim().toUpperCase();
  const quote = await yahooFinance.quote(upper);
  const price = toNumber(
    quote.regularMarketPrice ??
      quote.postMarketPrice ??
      quote.preMarketPrice ??
      quote.bid ??
      quote.ask
  );
  const time = toNumber(
    quote.regularMarketTime ??
      quote.postMarketTime ??
      quote.preMarketTime
  );

  if (!price) {
    throw new Error("Yahoo Finance quote price missing.");
  }

  return {
    ticker: upper,
    priceUsd: price,
    asOf: time ? formatIsoDateUtc(new Date(time * 1000)) : formatIsoDateUtc(now),
    source: "yahoo-finance2",
  };
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
