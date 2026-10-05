import type { CryptoRow } from "./coingecko.js";
import type { Quote, Candle } from "./yahoo.js";

const NAMES: Record<string, string> = {
  BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum", SOLUSDT: "Solana", BNBUSDT: "BNB",
  XRPUSDT: "XRP", ADAUSDT: "Cardano", DOGEUSDT: "Dogecoin", AVAXUSDT: "Avalanche",
  DOTUSDT: "Polkadot", LINKUSDT: "Chainlink", LTCUSDT: "Litecoin", MATICUSDT: "Polygon",
};

/** Plain tickers (BTC, ETH, ...) this app treats as crypto for routing quotes/history. */
export const CRYPTO_SYMBOLS = new Set(Object.keys(NAMES).map((s) => s.replace("USDT", "")));

/** Fallback crypto board built from Binance public 24hr tickers (no key required). */
export async function markets(): Promise<CryptoRow[]> {
  const symbols = Object.keys(NAMES);
  const url =
    "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(symbols));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const rows: any[] = await res.json();
  return rows
    .map((r) => ({
      id: r.symbol,
      symbol: r.symbol.replace("USDT", ""),
      name: NAMES[r.symbol] ?? r.symbol,
      price: +r.lastPrice,
      changePercent24h: +r.priceChangePercent,
      marketCap: null,
      volume24h: +r.quoteVolume,
      rank: null,
      sparkline: [],
    }))
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export async function orderBook(symbol: string, limit = 20): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  const pair = encodeURIComponent(symbol.toUpperCase() + "USDT");
  const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=${limit}`);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const d = await res.json();
  return { bids: d.bids ?? [], asks: d.asks ?? [] };
}

/** Single-symbol quote so crypto tickers can flow through the same /api/quotes path as stocks. */
export async function quote(symbol: string): Promise<Quote> {
  const pair = symbol.toUpperCase() + "USDT";
  const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`);
  if (!res.ok) throw new Error(`binance ticker ${res.status}`);
  const d = await res.json();
  return {
    symbol: symbol.toUpperCase(),
    name: NAMES[pair] ?? symbol.toUpperCase(),
    price: +d.lastPrice,
    change: +d.priceChange,
    changePercent: +d.priceChangePercent,
    open: +d.openPrice,
    high: +d.highPrice,
    low: +d.lowPrice,
    previousClose: +d.prevClosePrice,
    bid: +d.bidPrice || null,
    ask: +d.askPrice || null,
    // The quote-asset turnover is denominated in USDT, which is a close USD
    // proxy and matches the notional shown in the crypto market list.
    volume: +d.quoteVolume,
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: "Binance",
    marketState: "Open",
    time: null,
    source: "binance",
  };
}

const RANGE_TO_KLINE: Record<string, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "5D": { interval: "15m", limit: 480 },
  "1M": { interval: "1h", limit: 720 },
  "6M": { interval: "4h", limit: 1080 },
  YTD: { interval: "1d", limit: 400 },
  "1Y": { interval: "1d", limit: 365 },
  "5Y": { interval: "1w", limit: 260 },
  MAX: { interval: "1M", limit: 200 },
};

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000, "1M": 2_592_000_000,
};

function klineConfig(rangeKey: string, requestedInterval?: string) {
  const fallback = RANGE_TO_KLINE[rangeKey] ?? RANGE_TO_KLINE["6M"];
  if (!requestedInterval || !INTERVAL_MS[requestedInterval]) return fallback;
  const rangeDays: Record<string, number> = { "1D": 1, "5D": 5, "1M": 30, "6M": 183, YTD: 366, "1Y": 366, "5Y": 1830, MAX: 3650 };
  const duration = (rangeDays[rangeKey] ?? 183) * 86_400_000;
  return { interval: requestedInterval, limit: Math.max(1, Math.min(1000, Math.ceil(duration / INTERVAL_MS[requestedInterval]))) };
}

export async function history(symbol: string, rangeKey: string, requestedInterval?: string): Promise<Candle[]> {
  const { interval, limit } = klineConfig(rangeKey, requestedInterval);
  const pair = symbol.toUpperCase() + "USDT";
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`binance klines ${res.status}`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({
    time: Math.round(r[0] / 1000),
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
  }));
}

// Public, read-only Binance USDⓈ-M perpetual market data. The BNF: namespace
// keeps futures instruments distinct from Binance spot pairs throughout the app.
export function parseFuturesSymbol(input: string): string | null {
  const match = /^BNF:([A-Z0-9]{2,32})$/.exec(input.trim().toUpperCase());
  return match ? match[1] : null;
}

type FuturesSymbolInfo = { symbol: string; baseAsset: string; quoteAsset: string; contractType: string; status: string };
let futuresInfoCache: { at: number; symbols: FuturesSymbolInfo[] } | null = null;
async function futuresExchangeSymbols(): Promise<FuturesSymbolInfo[]> {
  if (futuresInfoCache && Date.now() - futuresInfoCache.at < 300_000) return futuresInfoCache.symbols;
  const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
  if (!res.ok) throw new Error(`binance futures exchangeInfo ${res.status}`);
  const payload = await res.json() as { symbols: FuturesSymbolInfo[] };
  futuresInfoCache = { at: Date.now(), symbols: payload.symbols };
  return payload.symbols;
}

export async function futuresMarkets(): Promise<CryptoRow[]> {
  const [symbols, tickerRes] = await Promise.all([
    futuresExchangeSymbols(), fetch("https://fapi.binance.com/fapi/v1/ticker/24hr"),
  ]);
  if (!tickerRes.ok) throw new Error(`binance futures ticker ${tickerRes.status}`);
  const tickers = await tickerRes.json() as Array<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }>;
  const eligible = new Map(symbols.filter((s) => s.status === "TRADING" && s.contractType === "PERPETUAL" && s.quoteAsset === "USDT").map((s) => [s.symbol, s]));
  return tickers.flatMap((r) => {
    const market = eligible.get(r.symbol);
    if (!market) return [];
    return [{
      id: `binance-futures:${r.symbol}`, symbol: `BNF:${r.symbol}`,
      name: `${market.baseAsset}/USDT Perpetual`, price: Number(r.lastPrice),
      changePercent24h: Number(r.priceChangePercent), marketCap: null,
      volume24h: Number(r.quoteVolume), rank: null, sparkline: [],
    }];
  }).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export async function futuresQuote(input: string): Promise<Quote> {
  const symbol = parseFuturesSymbol(input);
  if (!symbol) throw new Error("invalid Binance futures symbol");
  const [tickerRes, symbols] = await Promise.all([
    fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`),
    futuresExchangeSymbols(),
  ]);
  if (!tickerRes.ok) throw new Error(`binance futures ticker ${tickerRes.status}`);
  const d = await tickerRes.json() as any;
  const base = symbols.find((s) => s.symbol === symbol)?.baseAsset ?? symbol.replace(/USDT$/, "");
  return {
    symbol: input.toUpperCase(), name: `${base}/USDT Perpetual`, price: +d.lastPrice,
    change: +d.priceChange, changePercent: +d.priceChangePercent, open: +d.openPrice,
    high: +d.highPrice, low: +d.lowPrice, previousClose: +d.prevClosePrice,
    bid: +d.bidPrice || null, ask: +d.askPrice || null, volume: +d.quoteVolume,
    avgVolume: null, marketCap: null, pe: null, eps: null, dividendYield: null,
    week52High: null, week52Low: null, beta: null, sharesOutstanding: null,
    currency: "USDT", exchange: "Binance USDⓈ-M", marketState: "Open", time: null, source: "binance-futures",
  };
}

export async function futuresHistory(input: string, rangeKey: string, requestedInterval?: string): Promise<Candle[]> {
  const symbol = parseFuturesSymbol(input);
  if (!symbol) throw new Error("invalid Binance futures symbol");
  const { interval, limit } = klineConfig(rangeKey, requestedInterval);
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`binance futures klines ${res.status}`);
  const rows = await res.json() as any[];
  return rows.map((r) => ({ time: Math.round(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[7] }));
}

export async function futuresOrderBook(input: string, limit = 20): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  const symbol = parseFuturesSymbol(input);
  if (!symbol) throw new Error("invalid Binance futures symbol");
  const res = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  if (!res.ok) throw new Error(`binance futures depth ${res.status}`);
  const d = await res.json();
  return { bids: d.bids ?? [], asks: d.asks ?? [] };
}
