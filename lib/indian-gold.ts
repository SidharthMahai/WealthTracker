export const GOLD_RATE_SOURCE = "https://ratetoday.co.in/gold/delhi";

export function parseDelhiGoldRate(html: string, now = Date.now()) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    let data;
    try { data = JSON.parse(script[1]); } catch { continue; }
    const page = (data["@graph"] ?? []).find((item: Record<string, unknown>) =>
      item["@type"] === "WebPage" && item.url === GOLD_RATE_SOURCE);
    if (!page) continue;
    const match = String(page.name).match(/24K\s+Rs\.\s*([\d,]+(?:\.\d+)?)\/g/);
    const rate = Number(match?.[1].replaceAll(",", ""));
    const timestamp = Date.parse(page.dateModified);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(timestamp) ||
        timestamp > now + 300000 || now - timestamp > 4 * 86400000) {
      throw new Error("Delhi gold quote is invalid or stale.");
    }
    return { rate, asOf: new Date(timestamp).toISOString() };
  }
  throw new Error("Delhi 24K per-gram quote was not found.");
}

export async function fetchDelhiGoldRate() {
  const response = await fetch(GOLD_RATE_SOURCE, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "text/html" },
  });
  if (!response.ok) throw new Error("Delhi gold rate unavailable.");
  return parseDelhiGoldRate(await response.text());
}
