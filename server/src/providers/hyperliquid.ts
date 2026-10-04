import type { CryptoRow } from "./coingecko.js";
import type { Candle, Quote } from "./yahoo.js";

const INFO_URL = "https://api.hyperliquid.xyz/info";

type PerpDex = { name: string; fullName?: string };
type PerpMeta = { universe: Array<{ name: string; isDelisted?: boolean }> };
type AssetContext = {
  markPx?: string | null;
  prevDayPx?: string | null;
  dayNtlVlm?: string | null;
};
type MarketData = [PerpMeta, AssetContext[]];

const marketDataCache = new Map<string, { expires: number; promise: Promise<MarketData> }>();

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`hyperliquid ${response.status}`);
  return response.json() as Promise<T>;
}

function marketData(dex: string): Promise<MarketData> {
  const now = Date.now();
  const cached = marketDataCache.get(dex);
  if (cached && cached.expires > now) return cached.promise;
  const promise = info<MarketData>({ type: "metaAndAssetCtxs", ...(dex ? { dex } : {}) });
  marketDataCache.set(dex, { expires: now + 15_000, promise });
  promise.catch(() => {
    if (marketDataCache.get(dex)?.promise === promise) marketDataCache.delete(dex);
  });
  return promise;
}

/** Symbols are namespaced in the app so a futures chart cannot be mistaken for a spot ticker. */
export function parseSymbol(input: string): { dex: string; coin: string } | null {
  const match = /^HL:(.+)$/i.exec(input.trim());
  if (!match) return null;
  const rawCoin = match[1];
  const separator = rawCoin.indexOf(":");
  if (separator < 0) return { dex: "", coin: rawCoin.toUpperCase() };
  const dex = rawCoin.slice(0, separator).toLowerCase();
  return { dex, coin: `${dex}:${rawCoin.slice(separator + 1).toUpperCase()}` };
}

export async function dexes(): Promise<Array<{ id: string; label: string }>> {
  const rows = await info<Array<PerpDex | null>>({ type: "perpDexs" });
  return rows.map((dex, index) => ({
    id: dex?.name ?? "",
    label: dex?.fullName ?? dex?.name ?? "Hyperliquid",
  })).filter((dex, index, all) => all.findIndex((item) => item.id === dex.id) === index);
}

export async function markets(dex = ""): Promise<CryptoRow[]> {
  const [meta, contexts] = await marketData(dex);
  if (!meta || !Array.isArray(meta.universe) || !Array.isArray(contexts)) {
    throw new Error("hyperliquid returned invalid perpetual market data");
  }
  return meta.universe.flatMap((asset, index) => {
    const context = contexts[index];
    const price = Number(context?.markPx);
    if (asset.isDelisted || !Number.isFinite(price) || price <= 0) return [];
    const previous = Number(context?.prevDayPx);
    return [{
      id: `hyperliquid:${asset.name}`,
      symbol: asset.name,
      name: `${asset.name} Perpetual`,
      price,
      changePercent24h: Number.isFinite(previous) && previous > 0 ? ((price - previous) / previous) * 100 : null,
      marketCap: null,
      volume24h: Number.isFinite(Number(context?.dayNtlVlm)) ? Number(context?.dayNtlVlm) : null,
      rank: null,
      sparkline: [],
    }];
  }).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export async function quote(input: string): Promise<Quote> {
  const parsed = parseSymbol(input);
  if (!parsed) throw new Error("invalid Hyperliquid symbol");
  const [meta, contexts] = await marketData(parsed.dex);
  const index = meta.universe.findIndex((asset) => asset.name.toUpperCase() === parsed.coin);
  const context = contexts[index];
  const price = Number(context?.markPx);
  if (index < 0 || !Number.isFinite(price) || price <= 0) throw new Error(`hyperliquid market not found: ${parsed.coin}`);
  const previousClose = Number(context.prevDayPx);
  const change = Number.isFinite(previousClose) ? price - previousClose : null;
  return {
    symbol: input.toUpperCase(),
    name: `${parsed.coin} Perpetual`,
    price,
    change,
    changePercent: Number.isFinite(previousClose) && previousClose > 0 ? (change! / previousClose) * 100 : null,
    open: null, high: null, low: null, previousClose: Number.isFinite(previousClose) ? previousClose : null,
    bid: null, ask: null, volume: Number(context.dayNtlVlm) || null, avgVolume: null,
    marketCap: null, pe: null, eps: null, dividendYield: null, week52High: null, week52Low: null,
    beta: null, sharesOutstanding: null, currency: "USD", exchange: "Hyperliquid Perpetuals",
    marketState: "Open", time: null, source: "hyperliquid",
  };
}

const RANGE_TO_CANDLE: Record<string, { interval: string; durationMs: number }> = {
  "1D": { interval: "5m", durationMs: 24 * 60 * 60_000 },
  "5D": { interval: "15m", durationMs: 5 * 24 * 60 * 60_000 },
  "1M": { interval: "1h", durationMs: 30 * 24 * 60 * 60_000 },
  "6M": { interval: "4h", durationMs: 183 * 24 * 60 * 60_000 },
  YTD: { interval: "1d", durationMs: 366 * 24 * 60 * 60_000 },
  "1Y": { interval: "1d", durationMs: 366 * 24 * 60 * 60_000 },
  "5Y": { interval: "1w", durationMs: 5 * 366 * 24 * 60 * 60_000 },
  MAX: { interval: "1M", durationMs: 20 * 366 * 24 * 60 * 60_000 },
};

export async function history(input: string, range: string): Promise<Candle[]> {
  const parsed = parseSymbol(input);
  if (!parsed) throw new Error("invalid Hyperliquid symbol");
  const config = RANGE_TO_CANDLE[range] ?? RANGE_TO_CANDLE["6M"];
  const endTime = Date.now();
  const rows = await info<Array<{ t: number; o: string; h: string; l: string; c: string; v: string }>>({
    type: "candleSnapshot",
    req: { coin: parsed.coin, interval: config.interval, startTime: endTime - config.durationMs, endTime },
  });
  return rows.map((row) => ({
    time: Math.floor(row.t / 1000), open: Number(row.o), high: Number(row.h),
    low: Number(row.l), close: Number(row.c), volume: Number(row.v),
  }));
}

export async function orderBook(input: string): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  const parsed = parseSymbol(input);
  if (!parsed) throw new Error("invalid Hyperliquid symbol");
  const book = await info<{ levels: Array<Array<{ px: string; sz: string }>> }>({ type: "l2Book", coin: parsed.coin });
  return {
    bids: (book.levels?.[0] ?? []).map(({ px, sz }) => [px, sz]),
    asks: (book.levels?.[1] ?? []).map(({ px, sz }) => [px, sz]),
  };
}
