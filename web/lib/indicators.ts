import type { Candle } from "./api";

export type Point = { time: number; value: number };
export type CandleSource = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4";

export function candleSource(candle: Candle, source: CandleSource): number {
  switch (source) {
    case "open": return candle.open;
    case "high": return candle.high;
    case "low": return candle.low;
    case "hl2": return (candle.high + candle.low) / 2;
    case "hlc3": return (candle.high + candle.low + candle.close) / 3;
    case "ohlc4": return (candle.open + candle.high + candle.low + candle.close) / 4;
    default: return candle.close;
  }
}

export function sma(candles: Candle[], period: number, source: CandleSource = "close"): Point[] {
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candleSource(candles[i], source);
    if (i >= period) sum -= candleSource(candles[i - period], source);
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
export type ProfileDistribution = "volume" | "count";

/**
 * Candle-based volume profile matching the community Price & Volume Profile
 * approach: assign each candle's full volume to the bin containing its close.
 * OHLC candles cannot reproduce trade-level volume at price.
 */
export function volumeProfile(candles: Candle[], bins = 48, valueAreaPercent = 70, distribution: ProfileDistribution = "volume"): ProfileLevels | null {
  const valid = candles.filter((c) => Number.isFinite(c.low) && Number.isFinite(c.high) && Number.isFinite(c.close));
  if (!valid.length) return null;
  const contributors = valid.filter((c) => distribution === "count" || (Number.isFinite(c.volume) && c.volume > 0));
  if (!contributors.length) return null;
  const low = Math.min(...valid.map((c) => c.low));
  const high = Math.max(...valid.map((c) => c.high));
  if (high <= low) return { poc: low, vah: low, val: low };
  bins = Math.max(8, Math.min(128, Math.floor(bins)));
  const step = (high - low) / bins;
  const volume = new Array<number>(bins).fill(0);
  for (const candle of contributors) {
    // Match Price & Volume Profile (Expo): each interval is (lower, upper],
    // with an exact lowest-price close assigned to the first interval.
    const index = Math.max(0, Math.min(bins - 1, Math.ceil((candle.close - low) / step) - 1));
    volume[index] += distribution === "count" ? 1 : candle.volume;
  }
  const pocIndex = volume.indexOf(Math.max(...volume));
  const target = volume.reduce((a, b) => a + b, 0) * Math.max(0.01, Math.min(1, valueAreaPercent / 100));
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

export type ProfileSegment = { time1: number; time2: number; price1: number; price2: number };

/** Split indicator paths at UTC day boundaries so levels never bridge sessions. */
export function splitProfileLinesByUtcDay(
  candles: Candle[],
  levels: Record<"POC" | "VAH" | "VAL" | "PDPOC" | "PDVAH" | "PDVAL", Point[]>,
): Record<keyof typeof levels, ProfileSegment[]> {
  const output: Record<keyof typeof levels, ProfileSegment[]> = { POC: [], VAH: [], VAL: [], PDPOC: [], PDVAH: [], PDVAL: [] };
  if (candles.length < 2) return output;
  const dayKey = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
  const deltas = candles.slice(1).map((candle, index) => candle.time - candles[index].time).filter((delta) => delta > 0).sort((a, b) => a - b);
  const lastBarDuration = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 86_400;
  for (const key of Object.keys(output) as Array<keyof typeof output>) {
    const points = new Map(levels[key].filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)).map((p) => [p.time, p.value]));
    for (let i = 0; i < candles.length; i++) {
      const current = candles[i];
      const price1 = points.get(current.time);
      if (price1 == null) continue;
      const next = candles[i + 1];
      const time2 = next?.time ?? current.time + lastBarDuration;
      const sameDay = next && dayKey(current.time) === dayKey(next.time);
      const price2 = sameDay ? points.get(next.time) : price1;
      if (price2 == null || time2 <= current.time) continue;
      output[key].push({ time1: current.time, time2, price1, price2 });
    }
  }
  return output;
}

/** Current daily profile and the previous UTC day's POC/VAH/VAL, extended as lines. */
export function dailyProfileLevels(candles: Candle[], bins = 48, valueAreaPercent = 70): Record<"POC" | "VAH" | "VAL" | "PDPOC" | "PDVAH" | "PDVAL", Point[]> {
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
    const previous = i > 0 ? volumeProfile(ordered[i - 1], bins, valueAreaPercent) : null;
    const accumulated: Candle[] = [];
    for (const c of ordered[i]) {
      accumulated.push(c);
      const current = volumeProfile(accumulated, bins, valueAreaPercent);
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

export function rsi(candles: Candle[], period = 14, source: CandleSource = "close"): Point[] {
  const out: Point[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < candles.length; i++) {
    const diff = candleSource(candles[i], source) - candleSource(candles[i - 1], source);
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

export function macd(candles: Candle[], fast = 12, slow = 26, signal = 9, source: CandleSource = "close"): {
  macd: Point[];
  signal: Point[];
  histogram: Point[];
} {
  const emaAll = (period: number): number[] => {
    const k = 2 / (period + 1);
    const vals: number[] = [];
    let prev: number | null = null;
    for (const c of candles) {
      const value = candleSource(c, source);
      prev = prev === null ? value : value * k + prev * (1 - k);
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

export function bollinger(candles: Candle[], period = 20, mult = 2, source: CandleSource = "close"): { upper: Point[]; middle: Point[]; lower: Point[] } {
  const middle = sma(candles, period, source);
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const mean = middle[i - period + 1].value;
    const variance = slice.reduce((acc, c) => acc + (candleSource(c, source) - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push({ time: candles[i].time, value: mean + mult * sd });
    lower.push({ time: candles[i].time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}
