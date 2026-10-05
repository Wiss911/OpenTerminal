import type { Candle } from "./api";

export type Point = { time: number; value: number };

export function sma(candles: Candle[], period: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function ema(candles: Candle[], period: number): Point[] {
  const out: Point[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (const c of candles) {
    prev = prev === null ? c.close : c.close * k + prev * (1 - k);
    out.push({ time: c.time, value: prev });
  }
  return out.slice(period - 1);
}

export type ProfileLevels = { poc: number; vah: number; val: number };

/**
 * Estimate volume-at-price by spreading each OHLCV bar's volume uniformly
 * across its high-low range. These are candle-derived estimates, not trade-
 * level volume profile values.
 */
export function volumeProfile(candles: Candle[], bins = 48): ProfileLevels | null {
  const valid = candles.filter((c) => c.volume > 0 && Number.isFinite(c.low) && Number.isFinite(c.high));
  if (!valid.length) return null;
  let low = Math.min(...valid.map((c) => c.low));
  let high = Math.max(...valid.map((c) => c.high));
  if (high <= low) return { poc: low, vah: low, val: low };
  bins = Math.max(8, Math.min(128, Math.floor(bins)));
  const step = (high - low) / bins;
  const volume = new Array<number>(bins).fill(0);
  for (const candle of valid) {
    const first = Math.max(0, Math.min(bins - 1, Math.floor((candle.low - low) / step)));
    const last = Math.max(first, Math.min(bins - 1, Math.floor((candle.high - low) / step)));
    const share = candle.volume / (last - first + 1);
    for (let i = first; i <= last; i++) volume[i] += share;
  }
  const pocIndex = volume.indexOf(Math.max(...volume));
  const target = volume.reduce((a, b) => a + b, 0) * 0.70;
  let first = pocIndex, last = pocIndex, included = volume[pocIndex];
  while (included < target && (first > 0 || last < bins - 1)) {
    const below = first > 0 ? volume[first - 1] : -1;
    const above = last < bins - 1 ? volume[last + 1] : -1;
    if (above > below) { last++; included += volume[last]; }
    else { first--; included += volume[first]; }
  }
  return {
    poc: low + (pocIndex + 0.5) * step,
    val: low + first * step,
    vah: low + (last + 1) * step,
  };
}

/** Current daily profile and the previous UTC day's POC/VAH/VAL, extended as lines. */
export function dailyProfileLevels(candles: Candle[], bins = 48): Record<"POC" | "VAH" | "VAL" | "PDPOC" | "PDVAH" | "PDVAL", Point[]> {
  const result = { POC: [] as Point[], VAH: [] as Point[], VAL: [] as Point[], PDPOC: [] as Point[], PDVAH: [] as Point[], PDVAL: [] as Point[] };
  const days = new Map<string, Candle[]>();
  for (const candle of candles) {
    const d = new Date(candle.time * 1000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    const rows = days.get(key) ?? [];
    rows.push(candle);
    days.set(key, rows);
  }
  const ordered = [...days.values()];
  for (let i = 0; i < ordered.length; i++) {
    const previous = i > 0 ? volumeProfile(ordered[i - 1], bins) : null;
    const accumulated: Candle[] = [];
    for (const c of ordered[i]) {
      accumulated.push(c);
      const current = volumeProfile(accumulated, bins);
      if (current) {
        result.POC.push({ time: c.time, value: current.poc });
        result.VAH.push({ time: c.time, value: current.vah });
        result.VAL.push({ time: c.time, value: current.val });
      }
      if (previous) {
        result.PDPOC.push({ time: c.time, value: previous.poc });
        result.PDVAH.push({ time: c.time, value: previous.vah });
        result.PDVAL.push({ time: c.time, value: previous.val });
      }
    }
  }
  return result;
}

export function rsi(candles: Candle[], period = 14): Point[] {
  const out: Point[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) {
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
    }
  }
  return out;
}

export function macd(candles: Candle[], fast = 12, slow = 26, signal = 9): {
  macd: Point[];
  signal: Point[];
  histogram: Point[];
} {
  const emaAll = (period: number): number[] => {
    const k = 2 / (period + 1);
    const vals: number[] = [];
    let prev: number | null = null;
    for (const c of candles) {
      prev = prev === null ? c.close : c.close * k + prev * (1 - k);
      vals.push(prev);
    }
    return vals;
  };
  const fastE = emaAll(fast);
  const slowE = emaAll(slow);
  const macdLine: Point[] = candles.map((c, i) => ({ time: c.time, value: fastE[i] - slowE[i] })).slice(slow - 1);
  const k = 2 / (signal + 1);
  let prev: number | null = null;
  const signalLine: Point[] = macdLine.map((p) => {
    prev = prev === null ? p.value : p.value * k + prev * (1 - k);
    return { time: p.time, value: prev };
  });
  const histogram = macdLine.map((p, i) => ({ time: p.time, value: p.value - signalLine[i].value }));
  return { macd: macdLine, signal: signalLine, histogram };
}

export function bollinger(candles: Candle[], period = 20, mult = 2): { upper: Point[]; middle: Point[]; lower: Point[] } {
  const middle = sma(candles, period);
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const mean = middle[i - period + 1].value;
    const variance = slice.reduce((acc, c) => acc + (c.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push({ time: candles[i].time, value: mean + mult * sd });
    lower.push({ time: candles[i].time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}
