"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  LineStyle,
  BarSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { EMA, VWAP, Supertrend, WaveTrend, indicatorRegistry } from "lightweight-charts-indicators";
import { apiGet, fmt, fmtBig, type Candle } from "../../lib/api";
import { sma, dailyProfileLevels, splitProfileLinesByUtcDay, volumeProfile, rsi, macd, bollinger, type CandleSource, type Point } from "../../lib/indicators";
import { VolumeProfilePrimitive, type ProfileBox, type ProfileLine } from "../../lib/volumeProfilePrimitive";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const TIMEFRAMES = ["Auto", "1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "EMA50", "EMA200", "WVWAP", "SUPERTREND", "WAVETREND", "POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL", "FRVP", "PVP", "BOLL", "RSI", "MACD"] as const;

type Range = (typeof RANGES)[number];
type Timeframe = (typeof TIMEFRAMES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.filter((p) => p != null && Number.isFinite(p.time) && Number.isFinite(p.value)).map((p) => [p.time, p.value]));

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd966", SMA50: "#4fc3f7", SMA200: "#ba68c8", EMA20: "#ff8a65", EMA50: "#4fc3f7", EMA200: "#ba68c8", EMA20_MA: "#ffe082", EMA50_MA: "#80deea", EMA200_MA: "#ce93d8", EMA20_U: "#ffab91", EMA20_L: "#ffab91", EMA50_U: "#80deea", EMA50_L: "#80deea", EMA200_U: "#ce93d8", EMA200_L: "#ce93d8",
  WVWAP: "#26a69a", WVWAP_U: "#80cbc4", WVWAP_L: "#80cbc4", SUPERTREND_UP: "#26a69a", SUPERTREND_DOWN: "#ef5350", WAVETREND: "#26a69a", WAVETREND_SIGNAL: "#b0bec5", WAVETREND_OB: "#ef5350", WAVETREND_OS: "#26a69a", POC: "#ff5252", VAH: "#ab47bc", VAL: "#ab47bc",
  PDPOC: "#ef5350", PDVAH: "#7e57c2", PDVAL: "#7e57c2", FRVP_VAL: "#4caf50", FRVP_VAH: "#ff9800", FRVP_POC: "#f23645", PVP_POC: "#f23645", PVP_VAH: "#ff9800", PVP_VAL: "#4caf50", RSI: "#ff9900", BOLL: "#ff9900", MACD: "#4fc3f7", MACD_SIGNAL: "#b0bec5",
};
const FRVP_INDICATOR = indicatorRegistry.find((entry) => entry.id === "fixed-range-volume-profile-zones");
const PVP_INDICATOR = indicatorRegistry.find((entry) => entry.id === "price-volume-profile");
type UserLineStyle = "solid" | "dotted" | "dashed";
type LineConfig = { color: string; width: number; style: UserLineStyle };
const DEFAULT_LINE_CONFIGS: Record<string, LineConfig> = Object.fromEntries(
  Object.entries(INDICATOR_COLOR).map(([name, color]) => [name, { color, width: 1, style: "solid" }])
);
const SHARED_SETTINGS_KEY = "openterminal:chart-settings:shared";
const SETTINGS_EVENT = "openterminal:chart-settings-changed";
const DEFAULT_INDICATOR_PARAMS = { source: "close" as CandleSource, sma20: 20, sma50: 50, sma200: 200, smaOffset: 0, ema20: 20, ema50: 50, ema200: 200, emaMaType: "None" as "None" | "SMA" | "SMA + Bollinger Bands" | "EMA" | "SMMA (RMA)" | "WMA" | "VWMA", emaMaLength: 14, emaBbMult: 2, vwapAnchor: "1W" as "1D" | "1W" | "1M", vwapBands: true, emaOffset: 0, vwapDeviation: 1, supertrendAtr: 10, supertrendFactor: 3, waveChannel: 10, waveAverage: 21, waveOverbought: 60, waveOversold: -60, bollPeriod: 20, bollMult: 2, rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, profileBins: 48, profileValueArea: 70, frvpLookback: 30, frvpUpper: 95, frvpLower: 5, pvpLookback: 200, pvpDisplay: "Volume" as "Volume" | "Counter", pvpView: "profile" as "profile" | "levels", pvpValueArea: 70, pvpOffset: 0 };
type IndicatorParams = typeof DEFAULT_INDICATOR_PARAMS;

const validInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
const validNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const fromPlot = (plots: Record<string, Point[]>, plot: string) =>
  (plots[plot] ?? []).filter((point) => point != null && typeof point.time === "number" && Number.isFinite(point.time) && typeof point.value === "number" && Number.isFinite(point.value));
const shiftPoints = (candles: Candle[], points: Point[], offset: number) => {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  return points.flatMap((point) => {
    const target = (index.get(point.time) ?? -1) + offset;
    return target >= 0 && target < candles.length ? [{ time: candles[target].time, value: point.value }] : [];
  });
};
const contiguousSegments = (candles: Candle[], points: Point[], color: string, width: number, style: UserLineStyle): ProfileLine[] => {
  const byTime = new Map(fromPlot({ line: points }, "line").map((point) => [point.time, point.value]));
  const lines: ProfileLine[] = [];
  for (let index = 1; index < candles.length; index++) {
    const first = candles[index - 1];
    const second = candles[index];
    const price1 = byTime.get(first.time);
    const price2 = byTime.get(second.time);
    if (price1 == null || price2 == null) continue;
    lines.push({ time1: first.time, time2: second.time, price1, price2, color, width, style });
  }
  return lines;
};

type ChartSeries = Pick<ISeriesApi<"Candlestick">, "priceToCoordinate" | "attachPrimitive">;

function candleCloseTime(lastOpenSeconds: number, range: Range, timeframe: Timeframe, symbol: string): number {
  const crypto = /^(HL:|BNF:|BTC$|ETH$|SOL$|BNB$|XRP$|ADA$|DOGE$|AVAX$|DOT$|LINK$|LTC$|MATIC$)/i.test(symbol);
  const autoIntervals = crypto
    ? ({ "1D": "5m", "5D": "15m", "1M": "1h", "6M": "4h", YTD: "1d", "1Y": "1d", "5Y": "1w", MAX: "1M" } as const)
    : ({ "1D": "1d", "5D": "1d", "1M": "1h", "6M": "1d", YTD: "1d", "1Y": "1d", "5Y": "1w", MAX: "1M" } as const);
  const selected = timeframe === "Auto" ? autoIntervals[range] : timeframe;
  const openMs = lastOpenSeconds * 1_000;
  if (selected === "1M") {
    const open = new Date(openMs);
    return Date.UTC(open.getUTCFullYear(), open.getUTCMonth() + 1, 1);
  }
  if (selected === "1w") {
    const daySeconds = 86_400;
    const day = Math.floor(lastOpenSeconds / daySeconds);
    const daysUntilMonday = (7 - ((day + 3) % 7)) % 7 || 7;
    return (day + daysUntilMonday) * daySeconds * 1_000;
  }
  const seconds: Record<string, number> = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1_800, "1h": 3_600, "2h": 7_200, "4h": 14_400, "6h": 21_600, "8h": 28_800, "12h": 43_200, "1d": 86_400, "3d": 259_200 };
  const interval = seconds[selected] ?? 86_400;
  return (Math.floor(lastOpenSeconds / interval) * interval + interval) * 1_000;
}

function countdownLabel(closeAtMs: number, nowMs: number): string {
  const total = Math.max(0, Math.ceil((closeAtMs - nowMs) / 1_000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [range, setRange] = useState<Range>("6M");
  const [timeframe, setTimeframe] = useState<Timeframe>("Auto");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [active, setActive] = useState<Set<Indicator>>(new Set(["EMA20"]));
  const [legend, setLegend] = useState<Candle | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [countdownY, setCountdownY] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineConfigs, setLineConfigs] = useState<Record<string, LineConfig>>(DEFAULT_LINE_CONFIGS);
  const [indicatorParams, setIndicatorParams] = useState<IndicatorParams>(DEFAULT_INDICATOR_PARAMS);
  const [chartBackground, setChartBackground] = useState<string | null>(null);
  const [themePanel, setThemePanel] = useState("#0a0a0a");
  const [themeRevision, setThemeRevision] = useState(0);
  const [rightOffset, setRightOffset] = useState(5);
  const [settingsReady, setSettingsReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ChartSeries | null>(null);
  const viewportRef = useRef<{ key: string; from: number; to: number; count: number; followingLatest: boolean } | null>(null);
  const paneHeightsRef = useRef<Record<string, number>>({});
  const paneKeysRef = useRef<string[]>([]);
  const settingsKey = SHARED_SETTINGS_KEY;
  const chartSettingsRef = useRef({ chartBackground, themePanel, rightOffset });

  useEffect(() => {
    let currentTheme = document.documentElement.dataset.theme;
    let hasSynced = false;
    const updateTheme = () => {
      const nextTheme = document.documentElement.dataset.theme;
      if (hasSynced && nextTheme === currentTheme) return;
      hasSynced = true;
      currentTheme = nextTheme;
      setThemePanel(getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#0a0a0a");
      setThemeRevision((revision) => revision + 1);
    };
    const initialFrame = requestAnimationFrame(updateTheme);
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelAnimationFrame(initialFrame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { background?: string; rightOffset?: number; paneHeights?: Record<string, number>; lineConfigs?: Record<string, LineConfig>; indicatorParams?: Partial<IndicatorParams>; active?: unknown; range?: unknown; chartType?: unknown; timeframe?: unknown };
        if (typeof parsed.background === "string" && /^#[0-9a-f]{6}$/i.test(parsed.background) && parsed.background.toLowerCase() !== "#0a0a0a") setChartBackground(parsed.background);
        if (typeof parsed.rightOffset === "number" && Number.isFinite(parsed.rightOffset)) setRightOffset(Math.max(0, Math.min(20, parsed.rightOffset)));
        if (Array.isArray(parsed.active)) setActive(new Set(parsed.active.filter((item): item is Indicator => typeof item === "string" && (INDICATORS as readonly string[]).includes(item))));
        if (typeof parsed.range === "string" && (RANGES as readonly string[]).includes(parsed.range)) setRange(parsed.range as Range);
        if (typeof parsed.chartType === "string" && (CHART_TYPES as readonly string[]).includes(parsed.chartType)) setChartType(parsed.chartType as ChartType);
        if (typeof parsed.timeframe === "string" && (TIMEFRAMES as readonly string[]).includes(parsed.timeframe)) setTimeframe(parsed.timeframe as Timeframe);
        if (parsed.paneHeights && typeof parsed.paneHeights === "object") paneHeightsRef.current = Object.fromEntries(Object.entries(parsed.paneHeights).filter(([, height]) => typeof height === "number" && Number.isFinite(height)).map(([key, height]) => [key, Math.max(60, Math.min(600, height))]));
        if (parsed.lineConfigs && typeof parsed.lineConfigs === "object") setLineConfigs((current) => {
          const next = { ...current };
          for (const [name, value] of Object.entries(parsed.lineConfigs!)) {
            if (next[name] && value && /^#[0-9a-f]{6}$/i.test(value.color) && ["solid", "dotted", "dashed"].includes(value.style)) {
              next[name] = { color: value.color, width: validInt(value.width, 1, 4, 1), style: value.style };
            }
          }
          return next;
        });
        if (parsed.indicatorParams) {
          const p = parsed.indicatorParams;
          setIndicatorParams({
            ...DEFAULT_INDICATOR_PARAMS,
            source: (["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"].includes(String(p.source)) ? p.source : "close") as CandleSource,
            sma20: validInt(p.sma20, 2, 500, 20), sma50: validInt(p.sma50, 2, 500, 50), sma200: validInt(p.sma200, 2, 500, 200),
            smaOffset: validInt(p.smaOffset, -500, 500, 0),
            ema20: validInt(p.ema20, 2, 500, 20), ema50: validInt(p.ema50, 2, 500, 50), ema200: validInt(p.ema200, 2, 500, 200),
            emaMaType: (["None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA"].includes(String(p.emaMaType)) ? p.emaMaType : "None") as IndicatorParams["emaMaType"], emaMaLength: validInt(p.emaMaLength, 1, 500, 14), emaBbMult: validNumber(p.emaBbMult, 0.001, 50, 2),
            vwapAnchor: (["1D", "1W", "1M"].includes(String(p.vwapAnchor)) ? p.vwapAnchor : "1W") as "1D" | "1W" | "1M",
            vwapBands: typeof p.vwapBands === "boolean" ? p.vwapBands : true,
            emaOffset: validInt(p.emaOffset, -100, 100, 0), vwapDeviation: validNumber(p.vwapDeviation, 0.1, 5, 1),
            supertrendAtr: validInt(p.supertrendAtr, 2, 100, 10), supertrendFactor: validNumber(p.supertrendFactor, 0.1, 20, 3),
            waveChannel: validInt(p.waveChannel, 2, 100, 10), waveAverage: validInt(p.waveAverage, 2, 100, 21),
            waveOverbought: validNumber(p.waveOverbought, 1, 100, 60), waveOversold: validNumber(p.waveOversold, -100, -1, -60),
            bollPeriod: validInt(p.bollPeriod, 2, 500, 20), bollMult: validNumber(p.bollMult, 0.1, 10, 2),
            rsiPeriod: validInt(p.rsiPeriod, 2, 100, 14), macdFast: validInt(p.macdFast, 2, 100, 12), macdSlow: validInt(p.macdSlow, 3, 200, 26), macdSignal: validInt(p.macdSignal, 2, 100, 9),
            profileBins: validInt(p.profileBins, 8, 128, 48), profileValueArea: validNumber(p.profileValueArea, 50, 95, 70),
            frvpLookback: validInt(p.frvpLookback, 5, 5000, 30), frvpUpper: validNumber(p.frvpUpper, 50, 100, 95), frvpLower: validNumber(p.frvpLower, 0, 50, 5),
            pvpLookback: validInt(p.pvpLookback, 10, 5000, 200), pvpDisplay: p.pvpDisplay === "Counter" ? "Counter" : "Volume", pvpView: p.pvpView === "levels" ? "levels" : "profile",
            pvpValueArea: validNumber(p.pvpValueArea, 50, 95, 70), pvpOffset: validInt(p.pvpOffset, 0, 100, 0),
          });
        }
      }
    } catch { /* Keep usable defaults when local settings are unavailable. */ }
    setSettingsReady(true);
  }, [settingsKey]);

  useEffect(() => {
    const syncSettings = (event?: Event) => {
      const custom = event as CustomEvent<{ background?: string | null; rightOffset?: number; paneHeights?: Record<string, number>; lineConfigs?: Record<string, LineConfig>; indicatorParams?: Partial<IndicatorParams>; active?: unknown; range?: unknown; chartType?: unknown; timeframe?: unknown }> | undefined;
      const saved: { background?: string | null; rightOffset?: number; paneHeights?: Record<string, number>; lineConfigs?: Record<string, LineConfig>; indicatorParams?: Partial<IndicatorParams>; active?: unknown; range?: unknown; chartType?: unknown; timeframe?: unknown } | null = custom?.detail ?? (() => {
        try { return JSON.parse(localStorage.getItem(settingsKey) ?? "null"); } catch { return null; }
      })();
      if (!saved) return;
      const background = typeof saved.background === "string" ? saved.background : null;
      setChartBackground((current) => current === background ? current : background);
      if (typeof saved.rightOffset === "number") setRightOffset((current) => current === validInt(saved.rightOffset, 0, 20, 5) ? current : validInt(saved.rightOffset, 0, 20, 5));
      if (saved.paneHeights) {
        paneHeightsRef.current = { ...paneHeightsRef.current, ...saved.paneHeights };
        chartRef.current?.panes().forEach((pane, index) => {
          const key = paneKeysRef.current[index - 1];
          const height = key ? saved.paneHeights?.[key] : undefined;
          if (height && Math.abs(pane.getHeight() - height) > 3) pane.setHeight(height);
        });
      }
      if (saved.lineConfigs) setLineConfigs((current) => JSON.stringify(current) === JSON.stringify({ ...current, ...saved.lineConfigs }) ? current : ({ ...current, ...saved.lineConfigs }));
      if (saved.indicatorParams) setIndicatorParams((current) => JSON.stringify(current) === JSON.stringify({ ...current, ...saved.indicatorParams }) ? current : ({ ...current, ...saved.indicatorParams }));
      if (Array.isArray(saved.active)) {
        const next = saved.active.filter((item: unknown): item is Indicator => typeof item === "string" && (INDICATORS as readonly string[]).includes(item));
        setActive((current) => [...current].sort().join("|") === [...next].sort().join("|") ? current : new Set(next));
      }
      if (typeof saved.range === "string" && (RANGES as readonly string[]).includes(saved.range)) setRange((current) => current === saved.range ? current : saved.range as Range);
      if (typeof saved.chartType === "string" && (CHART_TYPES as readonly string[]).includes(saved.chartType)) setChartType((current) => current === saved.chartType ? current : saved.chartType as ChartType);
      if (typeof saved.timeframe === "string" && (TIMEFRAMES as readonly string[]).includes(saved.timeframe)) setTimeframe((current) => current === saved.timeframe ? current : saved.timeframe as Timeframe);
    };
    window.addEventListener("storage", syncSettings);
    window.addEventListener(SETTINGS_EVENT, syncSettings);
    return () => {
      window.removeEventListener("storage", syncSettings);
      window.removeEventListener(SETTINGS_EVENT, syncSettings);
    };
  }, [settingsKey]);

  useEffect(() => {
    if (!settingsReady) return;
    try {
      const saved = { ...(chartBackground ? { background: chartBackground } : {}), rightOffset, paneHeights: paneHeightsRef.current, lineConfigs, indicatorParams, active: [...active], range, chartType, timeframe };
      localStorage.setItem(settingsKey, JSON.stringify(saved));
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: saved }));
    }
    catch { /* Settings remain active for this session when storage is unavailable. */ }
  }, [chartBackground, rightOffset, settingsKey, settingsReady, lineConfigs, indicatorParams, active, range, chartType, timeframe]);

  useEffect(() => {
    chartSettingsRef.current = { chartBackground, themePanel, rightOffset };
  }, [chartBackground, themePanel, rightOffset]);

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range, timeframe],
    queryFn: () => apiGet<Candle[]>(`/api/history/${symbol}?range=${range}${timeframe === "Auto" ? "" : `&interval=${encodeURIComponent(timeframe)}`}`),
    refetchInterval: range === "1D" || (timeframe !== "Auto" && ["1m", "5m", "15m"].includes(timeframe)) ? 8_000 : 60_000,
    enabled: settingsReady,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const mainPaneHeight = chartRef.current?.panes()[0]?.getHeight();
      setCountdownY(typeof mainPaneHeight === "number" ? Math.max(18, mainPaneHeight - 9) : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [clockNow, candles, chartType, themeRevision]);

  // Fast time -> candle lookup for the crosshair legend, independent of chart type.
  const byTime = useMemo(() => {
    const m = new Map<number, Candle>();
    for (const c of candles ?? []) m.set(c.time, c);
    return m;
  }, [candles]);

  // Computed once per candles/active change, shared by both the chart overlays
  // below and the hover legend — avoids recomputing the same series twice.
  const indicatorData = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    const bars = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const calculateEma = (length: number) => {
      const plots = EMA.calculate(bars, { length, src: indicatorParams.source, maType: indicatorParams.emaMaType, maLength: indicatorParams.emaMaLength, bbMult: indicatorParams.emaBbMult }).plots;
      const shift = (name: string) => shiftPoints(candles, fromPlot(plots, name), indicatorParams.emaOffset);
      return { line: shift("plot0"), smooth: shift("plot1"), upper: shift("plot2"), lower: shift("plot3") };
    };
    const ema20 = active.has("EMA20") ? calculateEma(indicatorParams.ema20) : null;
    const ema50 = active.has("EMA50") ? calculateEma(indicatorParams.ema50) : null;
    const ema200 = active.has("EMA200") ? calculateEma(indicatorParams.ema200) : null;
    const vwap = active.has("WVWAP") ? VWAP.calculate(bars, { anchor: indicatorParams.vwapAnchor, src: indicatorParams.source, showBands: indicatorParams.vwapBands, bandMult: indicatorParams.vwapDeviation }).plots : null;
    const supertrend = active.has("SUPERTREND") ? Supertrend.calculate(bars, { atrPeriod: indicatorParams.supertrendAtr, factor: indicatorParams.supertrendFactor }).plots : null;
    const wave = active.has("WAVETREND") ? WaveTrend.calculate(bars, { channelLength: indicatorParams.waveChannel, averageLength: indicatorParams.waveAverage, obLevel1: indicatorParams.waveOverbought, osLevel1: indicatorParams.waveOversold }).plots : null;
    const frvp = active.has("FRVP") && FRVP_INDICATOR ? FRVP_INDICATOR.calculate(bars, { lookbackDays: Math.min(indicatorParams.frvpLookback, bars.length), numBins: indicatorParams.profileBins, percentileUpper: indicatorParams.frvpUpper, percentileLower: indicatorParams.frvpLower }) : null;
    const pvpBars = bars.slice(-Math.min(indicatorParams.pvpLookback, bars.length));
    const pvp = active.has("PVP") && PVP_INDICATOR ? PVP_INDICATOR.calculate(bars, { rows: indicatorParams.profileBins, display: indicatorParams.pvpDisplay, lookback: pvpBars.length, poc: true }) : null;
    const pvpBoxes: ProfileBox[] = Array.isArray(pvp?.boxes) ? pvp.boxes.filter((box: ProfileBox) => box && [box.time1, box.time2, box.price1, box.price2].every((value) => typeof value === "number" && Number.isFinite(value))) : [];
    const pvpProfile = volumeProfile(pvpBars, indicatorParams.profileBins, indicatorParams.pvpValueArea, indicatorParams.pvpDisplay === "Counter" ? "count" : "volume");
    const pvpTimes = pvpBars.length > 1 ? { time1: pvpBars[0].time, time2: pvpBars[pvpBars.length - 1].time } : null;
    const pvpLevels: ProfileLine[] = active.has("PVP") && pvpProfile && pvpTimes ? ([
      { ...pvpTimes, price1: pvpProfile.poc, price2: pvpProfile.poc, color: lineConfigs.PVP_POC?.color ?? "#f23645", width: lineConfigs.PVP_POC?.width ?? 1, style: lineConfigs.PVP_POC?.style, offsetBars: indicatorParams.pvpOffset },
      { ...pvpTimes, price1: pvpProfile.vah, price2: pvpProfile.vah, color: lineConfigs.PVP_VAH?.color ?? "#ff9800", width: lineConfigs.PVP_VAH?.width ?? 1, style: lineConfigs.PVP_VAH?.style, offsetBars: indicatorParams.pvpOffset },
      { ...pvpTimes, price1: pvpProfile.val, price2: pvpProfile.val, color: lineConfigs.PVP_VAL?.color ?? "#4caf50", width: lineConfigs.PVP_VAL?.width ?? 1, style: lineConfigs.PVP_VAL?.style, offsetBars: indicatorParams.pvpOffset },
    ]) : [];
    const profile = (active.has("POC") || active.has("VAH") || active.has("VAL") || active.has("PDPOC") || active.has("PDVAH") || active.has("PDVAL")) ? dailyProfileLevels(candles, indicatorParams.profileBins, indicatorParams.profileValueArea) : null;
    return {
      SMA20: active.has("SMA20") ? shiftPoints(candles, sma(candles, indicatorParams.sma20, indicatorParams.source), indicatorParams.smaOffset) : null,
      SMA50: active.has("SMA50") ? shiftPoints(candles, sma(candles, indicatorParams.sma50, indicatorParams.source), indicatorParams.smaOffset) : null,
      SMA200: active.has("SMA200") ? shiftPoints(candles, sma(candles, indicatorParams.sma200, indicatorParams.source), indicatorParams.smaOffset) : null,
      EMA20: ema20?.line ?? null, EMA20_MA: ema20?.smooth ?? null, EMA20_U: ema20?.upper ?? null, EMA20_L: ema20?.lower ?? null,
      EMA50: ema50?.line ?? null, EMA50_MA: ema50?.smooth ?? null, EMA50_U: ema50?.upper ?? null, EMA50_L: ema50?.lower ?? null,
      EMA200: ema200?.line ?? null, EMA200_MA: ema200?.smooth ?? null, EMA200_U: ema200?.upper ?? null, EMA200_L: ema200?.lower ?? null,
      WVWAP: vwap ? { center: fromPlot(vwap, "plot0"), upper: fromPlot(vwap, "plot1"), lower: fromPlot(vwap, "plot2") } : null,
      SUPERTREND: supertrend ? { up: fromPlot(supertrend, "plot0"), down: fromPlot(supertrend, "plot1") } : null,
      WAVETREND: wave ? { wt1: fromPlot(wave, "plot0"), wt2: fromPlot(wave, "plot1") } : null,
      FRVP: frvp ? { val: fromPlot(frvp.plots ?? {}, "plot0"), vah: fromPlot(frvp.plots ?? {}, "plot1"), poc: fromPlot(frvp.plots ?? {}, "plot2") } : null,
      PVP: { boxes: indicatorParams.pvpView === "profile" ? pvpBoxes : [], levels: pvpLevels, offset: indicatorParams.pvpOffset },
      PROFILE: profile ? { ...profile, segments: splitProfileLinesByUtcDay(candles, profile) } : null,
      RSI: active.has("RSI") ? rsi(candles, indicatorParams.rsiPeriod, indicatorParams.source) : null,
      BOLL: active.has("BOLL") ? bollinger(candles, indicatorParams.bollPeriod, indicatorParams.bollMult, indicatorParams.source) : null,
      MACD: active.has("MACD") ? macd(candles, Math.min(indicatorParams.macdFast, indicatorParams.macdSlow - 1), indicatorParams.macdSlow, indicatorParams.macdSignal, indicatorParams.source) : null,
    };
  }, [candles, active, indicatorParams, lineConfigs]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.EMA50) maps.EMA50 = toMap(indicatorData.EMA50);
    if (indicatorData.EMA200) maps.EMA200 = toMap(indicatorData.EMA200);
    for (const key of ["EMA20_MA", "EMA20_U", "EMA20_L", "EMA50_MA", "EMA50_U", "EMA50_L", "EMA200_MA", "EMA200_U", "EMA200_L"] as const) if (indicatorData[key]) maps[key] = toMap(indicatorData[key]);
    if (indicatorData.WVWAP) {
      maps.WVWAP = toMap(indicatorData.WVWAP.center);
      maps.WVWAP_U = toMap(indicatorData.WVWAP.upper);
      maps.WVWAP_L = toMap(indicatorData.WVWAP.lower);
    }
    if (indicatorData.SUPERTREND) { maps.SUPERTREND_U = toMap(indicatorData.SUPERTREND.up); maps.SUPERTREND_D = toMap(indicatorData.SUPERTREND.down); }
    if (indicatorData.WAVETREND) { maps.WAVETREND_1 = toMap(indicatorData.WAVETREND.wt1); maps.WAVETREND_2 = toMap(indicatorData.WAVETREND.wt2); }
    if (indicatorData.FRVP) { maps.FRVP_VAL = toMap(indicatorData.FRVP.val); maps.FRVP_VAH = toMap(indicatorData.FRVP.vah); maps.FRVP_POC = toMap(indicatorData.FRVP.poc); }
    if (indicatorData.PROFILE) for (const key of ["POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL"] as const) maps[key] = toMap(indicatorData.PROFILE[key]);
    if (indicatorData.RSI) maps.RSI = toMap(indicatorData.RSI);
    if (indicatorData.BOLL) {
      maps.BOLL_U = toMap(indicatorData.BOLL.upper);
      maps.BOLL_M = toMap(indicatorData.BOLL.middle);
      maps.BOLL_L = toMap(indicatorData.BOLL.lower);
    }
    if (indicatorData.MACD) {
      maps.MACD_M = toMap(indicatorData.MACD.macd);
      maps.MACD_S = toMap(indicatorData.MACD.signal);
      maps.MACD_H = toMap(indicatorData.MACD.histogram);
    }
    return maps;
  }, [indicatorData]);

  const indicatorRows = useMemo(() => {
    if (!legend) return [];
    const t = legend.time;
    const get = (key: string) => indicatorMaps[key]?.get(t);
    const rows: Array<{ label: string; value: string; color: string }> = [];
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "EMA50", "EMA200", "WVWAP", "WVWAP_U", "WVWAP_L", "POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL", "FRVP_VAL", "FRVP_VAH", "FRVP_POC"] as const) {
      const v = get(key);
      if (typeof v === "number" && Number.isFinite(v)) rows.push({ label: key, value: fmt(v), color: lineConfigs[key]?.color ?? INDICATOR_COLOR[key] });
    }
    const rsiV = get("RSI");
    if (typeof rsiV === "number" && Number.isFinite(rsiV)) rows.push({ label: "RSI", value: fmt(rsiV, 1), color: INDICATOR_COLOR.RSI });
    const bollM = get("BOLL_M");
    if (typeof bollM === "number" && Number.isFinite(bollM) && Number.isFinite(get("BOLL_U")) && Number.isFinite(get("BOLL_L"))) {
      rows.push({
        label: "BOLL",
        value: `${fmt(get("BOLL_U"))} / ${fmt(bollM)} / ${fmt(get("BOLL_L"))}`,
        color: INDICATOR_COLOR.BOLL,
      });
    }
    const macdM = get("MACD_M");
    if (typeof macdM === "number" && Number.isFinite(macdM) && Number.isFinite(get("MACD_S")) && Number.isFinite(get("MACD_H"))) {
      rows.push({
        label: "MACD",
        value: `${fmt(macdM, 2)} / ${fmt(get("MACD_S"), 2)} / ${fmt(get("MACD_H"), 2)}`,
        color: INDICATOR_COLOR.MACD,
      });
    }
    return rows;
  }, [legend, indicatorMaps, lineConfigs]);

  useEffect(() => {
    setLegend(candles && candles.length > 0 ? candles[candles.length - 1] : null);
  }, [candles]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const css = getComputedStyle(document.documentElement);
    const cssColor = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const accent = cssColor("--amber", "#ff9900");
    const upColor = cssColor("--up", "#00c853");
    const downColor = cssColor("--down", "#ff3d3d");
    const chartText = cssColor("--chart-text", "#808080");
    const chartGrid = cssColor("--chart-grid", "#1a1a1a");
    const chartBorder = cssColor("--border", "#262626");
    const volumeUp = cssColor("--chart-volume-up", "rgba(0,200,83,0.4)");
    const volumeDown = cssColor("--chart-volume-down", "rgba(255,61,61,0.4)");
    const volumeUpStrong = cssColor("--chart-volume-up-strong", "rgba(0,200,83,0.6)");
    const volumeDownStrong = cssColor("--chart-volume-down-strong", "rgba(255,61,61,0.6)");
    const accentSoft = cssColor("--chart-accent-soft", "rgba(255,153,0,0.25)");
    const accentTransparent = cssColor("--chart-accent-transparent", "rgba(255,153,0,0)");
    const chartSettings = chartSettingsRef.current;

    const chart = createChart(el, {
      layout: { background: { color: chartSettings.chartBackground ?? chartSettings.themePanel }, textColor: chartText, fontSize: 10, attributionLogo: false, panes: { enableResize: true } },
      grid: { vertLines: { color: chartGrid }, horzLines: { color: chartGrid } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: chartBorder, timeVisible: timeframe === "Auto" ? range === "1D" || range === "5D" : !["1d", "1w"].includes(timeframe), rightOffset: Math.max(chartSettings.rightOffset, active.has("PVP") ? indicatorParams.pvpOffset + 1 : 0) },
      rightPriceScale: { borderColor: chartBorder },
      autoSize: true,
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });
    chartRef.current = chart;

    if (chartType === "candles") {
      const primary = chart.addSeries(CandlestickSeries, {
          upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor: upColor, wickDownColor: downColor,
        });
      priceSeriesRef.current = primary;
      primary.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "bars") {
      const primary = chart.addSeries(BarSeries, { upColor, downColor });
      priceSeriesRef.current = primary;
      primary.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "line") {
      const primary = chart.addSeries(LineSeries, { color: accent, lineWidth: 1 });
      priceSeriesRef.current = primary;
      primary.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    } else {
      const primary = chart.addSeries(AreaSeries, { lineColor: accent, topColor: accentSoft, bottomColor: accentTransparent });
      priceSeriesRef.current = primary;
      primary.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    }

    // volume histogram on its own scale at the bottom of the main pane
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(
      candles.map((c) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? volumeUp : volumeDown }))
    );

    const overlay = (points: Point[], key: string, colorOverride?: string) => {
      const config = lineConfigs[key] ?? DEFAULT_LINE_CONFIGS[key] ?? { color: colorOverride ?? accent, width: 1, style: "solid" as const };
      const styles = { solid: LineStyle.Solid, dotted: LineStyle.Dotted, dashed: LineStyle.Dashed };
      chart.addSeries(LineSeries, { color: colorOverride ?? config.color, lineWidth: config.width as 1 | 2 | 3 | 4, lineStyle: styles[config.style], priceLineVisible: false, lastValueVisible: false })
        .setData(points.filter((p) => p != null && Number.isFinite(p.time) && Number.isFinite(p.value)).map((p) => ({ time: ts(p.time), value: p.value })));
    };

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, "SMA20");
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, "SMA50");
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, "SMA200");
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, "EMA20");
    if (indicatorData?.EMA50) overlay(indicatorData.EMA50, "EMA50");
    if (indicatorData?.EMA200) overlay(indicatorData.EMA200, "EMA200");
    for (const key of ["EMA20_MA", "EMA20_U", "EMA20_L", "EMA50_MA", "EMA50_U", "EMA50_L", "EMA200_MA", "EMA200_U", "EMA200_L"] as const) {
      const points = indicatorData?.[key];
      if (points?.length) overlay(points, key);
    }
    if (indicatorData?.WVWAP) {
      overlay(indicatorData.WVWAP.center, "WVWAP");
      overlay(indicatorData.WVWAP.upper, "WVWAP_U");
      overlay(indicatorData.WVWAP.lower, "WVWAP_L");
    }
    const profileLines: ProfileLine[] = [];
    if (indicatorData?.SUPERTREND) {
      for (const [points, key] of [[indicatorData.SUPERTREND.up, "SUPERTREND_UP"], [indicatorData.SUPERTREND.down, "SUPERTREND_DOWN"]] as const) {
        const config = lineConfigs[key] ?? DEFAULT_LINE_CONFIGS[key];
        profileLines.push(...contiguousSegments(candles, points, config.color, config.width, config.style));
      }
    }
    if (indicatorData?.PROFILE) for (const key of ["POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL"] as const) {
      if (!active.has(key)) continue;
      const config = lineConfigs[key] ?? DEFAULT_LINE_CONFIGS[key];
      profileLines.push(...indicatorData.PROFILE.segments[key].map((segment) => ({ ...segment, color: config.color, width: config.width, style: config.style })));
    }
    if (indicatorData?.FRVP) {
      if (active.has("FRVP")) {
        overlay(indicatorData.FRVP.val, "FRVP_VAL");
        overlay(indicatorData.FRVP.vah, "FRVP_VAH");
        overlay(indicatorData.FRVP.poc, "FRVP_POC");
      }
    }
    if (indicatorData?.PVP && priceSeriesRef.current && (indicatorData.PVP.boxes.length > 0 || indicatorData.PVP.levels.length > 0)) {
      priceSeriesRef.current.attachPrimitive(new VolumeProfilePrimitive(indicatorData.PVP.boxes, [...profileLines, ...indicatorData.PVP.levels], indicatorData.PVP.offset));
    } else if (profileLines.length > 0 && priceSeriesRef.current) {
      priceSeriesRef.current.attachPrimitive(new VolumeProfilePrimitive([], profileLines));
    }
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, "BOLL");
      overlay(indicatorData.BOLL.middle, "BOLL");
      overlay(indicatorData.BOLL.lower, "BOLL");
    }

    let paneIdx = 1;
    const paneKeys: string[] = [];
    if (indicatorData?.RSI) {
      paneKeys.push("RSI");
      const s = chart.addSeries(LineSeries, { color: lineConfigs.RSI.color, lineWidth: lineConfigs.RSI.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.RSI.style === "dotted" ? LineStyle.Dotted : lineConfigs.RSI.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
      paneKeys.push("MACD");
      const m = indicatorData.MACD;
      const pane = paneIdx++;
      chart.addSeries(HistogramSeries, { color: accent }, pane).setData(
        m.histogram.map((p) => ({ time: ts(p.time), value: p.value, color: p.value >= 0 ? volumeUpStrong : volumeDownStrong }))
      );
      chart.addSeries(LineSeries, { color: lineConfigs.MACD.color, lineWidth: lineConfigs.MACD.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.MACD.style === "dotted" ? LineStyle.Dotted : lineConfigs.MACD.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, pane).setData(
        m.macd.map((p) => ({ time: ts(p.time), value: p.value }))
      );
      chart.addSeries(LineSeries, { color: lineConfigs.MACD_SIGNAL.color, lineWidth: lineConfigs.MACD_SIGNAL.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.MACD_SIGNAL.style === "dotted" ? LineStyle.Dotted : lineConfigs.MACD_SIGNAL.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, pane).setData(
        m.signal.map((p) => ({ time: ts(p.time), value: p.value }))
      );
    }
    if (indicatorData?.WAVETREND) {
      paneKeys.push("WAVETREND");
      const pane = paneIdx++;
      chart.addSeries(LineSeries, { color: lineConfigs.WAVETREND.color, lineWidth: lineConfigs.WAVETREND.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.WAVETREND.style === "dotted" ? LineStyle.Dotted : lineConfigs.WAVETREND.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, pane)
        .setData(indicatorData.WAVETREND.wt1.map((p) => ({ time: ts(p.time), value: p.value })));
      chart.addSeries(LineSeries, { color: lineConfigs.WAVETREND_SIGNAL.color, lineWidth: lineConfigs.WAVETREND_SIGNAL.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.WAVETREND_SIGNAL.style === "dotted" ? LineStyle.Dotted : lineConfigs.WAVETREND_SIGNAL.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, pane)
        .setData(indicatorData.WAVETREND.wt2.map((p) => ({ time: ts(p.time), value: p.value })));
      const waveLevels = (value: number) => candles.map((c) => ({ time: ts(c.time), value }));
      chart.addSeries(LineSeries, { color: lineConfigs.WAVETREND_OB.color, lineWidth: lineConfigs.WAVETREND_OB.width as 1 | 2 | 3 | 4, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false }, pane).setData(waveLevels(indicatorParams.waveOverbought));
      chart.addSeries(LineSeries, { color: lineConfigs.WAVETREND_OS.color, lineWidth: lineConfigs.WAVETREND_OS.width as 1 | 2 | 3 | 4, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false }, pane).setData(waveLevels(indicatorParams.waveOversold));
    }
    paneKeysRef.current = paneKeys;
    const panes = chart.panes();
    panes.forEach((pane, index) => {
      const key = paneKeys[index - 1];
      const height = key ? paneHeightsRef.current[key] : undefined;
      if (height) pane.setHeight(height);
    });
    const paneObservers: ResizeObserver[] = [];
    panes.forEach((pane, index) => {
      const key = paneKeys[index - 1];
      const element = pane.getHTMLElement();
      if (!key || !element) return;
      let previousHeight = pane.getHeight();
      const observer = new ResizeObserver(() => {
        const height = Math.round(pane.getHeight());
        if (height < 60 || Math.abs(height - previousHeight) < 2) return;
        previousHeight = height;
        paneHeightsRef.current = { ...paneHeightsRef.current, [key]: height };
        try {
          const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "{}");
          const detail = { ...saved, paneHeights: paneHeightsRef.current };
          localStorage.setItem(settingsKey, JSON.stringify(detail));
          window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail }));
        } catch { /* Keep the pane size for the current chart if storage is blocked. */ }
      });
      observer.observe(element);
      paneObservers.push(observer);
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setLegend(candles[candles.length - 1]);
        return;
      }
      const hit = byTime.get(param.time as number);
      if (hit) setLegend(hit);
    });

    const viewKey = `${symbol}|${range}|${timeframe}`;
    const previousView = viewportRef.current?.key === viewKey ? viewportRef.current : null;
    const addedCandles = previousView ? candles.length - previousView.count : 0;
    if (previousView) {
      const offset = previousView.followingLatest ? addedCandles : 0;
      chart.timeScale().setVisibleLogicalRange({ from: previousView.from + offset, to: previousView.to + offset });
    } else {
      chart.timeScale().fitContent();
    }
    const recordViewport = (logicalRange: { from: number; to: number } | null) => {
      if (!logicalRange) return;
      viewportRef.current = {
        key: viewKey, from: logicalRange.from, to: logicalRange.to, count: candles.length,
        followingLatest: logicalRange.to >= candles.length - 2,
      };
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(recordViewport);
    recordViewport(chart.timeScale().getVisibleLogicalRange());
    return () => {
      const visible = chart.timeScale().getVisibleLogicalRange();
      recordViewport(visible);
      chart.panes().forEach((pane, index) => {
        const key = paneKeys[index - 1];
        if (key) paneHeightsRef.current[key] = Math.round(pane.getHeight());
      });
      for (const observer of paneObservers) observer.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
    };
  }, [candles, chartType, indicatorData, range, timeframe, symbol, byTime, themeRevision, lineConfigs, active, indicatorParams.pvpOffset, indicatorParams.waveOverbought, indicatorParams.waveOversold, settingsKey]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { background: { color: chartBackground ?? themePanel } },
      timeScale: { rightOffset: Math.max(rightOffset, active.has("PVP") ? indicatorParams.pvpOffset + 1 : 0) },
    });
  }, [chartBackground, rightOffset, themePanel, active, indicatorParams.pvpOffset]);

  const toggleIndicator = (ind: Indicator) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        {RANGES.map((r) => (
          <button key={r} className={`term-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
        <span className="w-2" />
        {CHART_TYPES.map((t) => (
          <button key={t} className={`term-btn ${chartType === t ? "active" : ""}`} onClick={() => setChartType(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        <span className="w-2" />
        {INDICATORS.map((ind) => (
          <button key={ind} className={`term-btn ${active.has(ind) ? "active" : ""}`} onClick={() => toggleIndicator(ind)} title={ind === "FRVP" ? "Fixed-Range Volume-Profile Zones (Community-Indikator)" : ind === "PVP" ? "Price & Volume Profile (Expo, Community-Indikator)" : ["POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL"].includes(ind) ? "Kerzenbasierte Schätzung: Volumen wird dem Schlusskurs-Bin zugeordnet" : ind}>
            {ind}
          </button>
        ))}
        <label className="flex items-center gap-1 px-1 text-xs dim" title="Candle interval (independent from the visible date range)">
          Kerzen
          <select aria-label="Candle interval" value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="term-btn active">
            {TIMEFRAMES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button className={`term-btn ml-auto ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((open) => !open)} aria-label="Chart settings" title="Chart settings">
          ⚙
        </button>
      </div>
      {settingsOpen && (
        <div className="flex gap-4 items-center flex-wrap px-2 py-1 border-b border-[var(--border)] text-xs shrink-0 max-h-56 overflow-auto">
          <label className="flex items-center gap-2">Background
            <input type="color" value={chartBackground ?? themePanel} onChange={(e) => setChartBackground(e.target.value)} className="w-7 h-6 p-0 border-0 bg-transparent" />
            <span className="dim">{chartBackground ?? themePanel}</span>
          </label>
          <label className="flex items-center gap-2">Space after last candle
            <input type="range" min="0" max="20" value={rightOffset} onChange={(e) => setRightOffset(Number(e.target.value))} />
            <span className="dim w-8">{rightOffset} bars</span>
          </label>
          <div className="basis-full border-t border-[var(--border)] pt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2">
            {Object.entries(lineConfigs).map(([key, config]) => (
              <div key={key} className="flex items-center gap-1.5 min-w-0">
                <span className="w-28 truncate dim" title={key}>{key}</span>
                <input aria-label={`${key} line color`} type="color" value={config.color} onChange={(e) => setLineConfigs((current) => ({ ...current, [key]: { ...current[key], color: e.target.value } }))} className="w-7 h-6 p-0 border-0 bg-transparent" />
                <select aria-label={`${key} line width`} value={config.width} onChange={(e) => setLineConfigs((current) => ({ ...current, [key]: { ...current[key], width: Number(e.target.value) } }))}>
                  {[1, 2, 3, 4].map((width) => <option key={width} value={width}>{width}px</option>)}
                </select>
                <select aria-label={`${key} line style`} value={config.style} onChange={(e) => setLineConfigs((current) => ({ ...current, [key]: { ...current[key], style: e.target.value as UserLineStyle } }))}>
                  <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                </select>
              </div>
            ))}
            {([
              ["sma20", "SMA 20 length", 2, 500, 1], ["sma50", "SMA 50 length", 2, 500, 1], ["sma200", "SMA 200 length", 2, 500, 1], ["smaOffset", "SMA offset bars", -500, 500, 1],
              ["ema20", "EMA 20 length", 2, 500, 1], ["ema50", "EMA 50 length", 2, 500, 1], ["ema200", "EMA 200 length", 2, 500, 1],
              ["emaOffset", "EMA offset bars", -100, 100, 1], ["emaMaLength", "EMA smoothing length", 1, 500, 1], ["emaBbMult", "EMA smoothing BB deviation", 0.001, 50, 0.1], ["vwapDeviation", "VWAP band deviation", 0.1, 5, 0.1], ["supertrendAtr", "Supertrend ATR length", 2, 100, 1], ["supertrendFactor", "Supertrend factor", 0.1, 20, 0.1],
              ["waveChannel", "WaveTrend channel length", 2, 100, 1], ["waveAverage", "WaveTrend average length", 2, 100, 1], ["waveOverbought", "WaveTrend overbought", 1, 100, 1], ["waveOversold", "WaveTrend oversold", -100, -1, 1], ["bollPeriod", "Bollinger period", 2, 500, 1],
              ["bollMult", "Bollinger multiplier", 0.1, 10, 0.1], ["rsiPeriod", "RSI period", 2, 100, 1],
              ["macdFast", "MACD fast", 2, 100, 1], ["macdSlow", "MACD slow", 3, 200, 1], ["macdSignal", "MACD signal", 2, 100, 1],
              ["profileBins", "Volume Profile bins", 8, 128, 1], ["profileValueArea", "Daily profile value area %", 50, 95, 1],
              ["frvpLookback", "FRVP zones lookback bars", 5, 5000, 1], ["frvpUpper", "FRVP upper percentile", 50, 100, 1], ["frvpLower", "FRVP lower percentile", 0, 50, 1],
              ["pvpLookback", "PVP lookback bars", 10, 5000, 1], ["pvpValueArea", "PVP value area %", 50, 95, 1], ["pvpOffset", "PVP shift right (bars)", 0, 100, 1],
            ] as Array<[keyof IndicatorParams, string, number, number, number]>).map(([key, label, min, max, step]) => (
              <label key={key} className="flex items-center justify-between gap-2">{label}
                <input type="number" min={min} max={max} step={step} value={String(indicatorParams[key])} onChange={(e) => setIndicatorParams((current) => ({ ...current, [key]: step < 1 ? validNumber(Number(e.target.value), min, max, typeof current[key] === "number" ? current[key] : 1) : validInt(Number(e.target.value), min, max, typeof current[key] === "number" ? current[key] : 1) } as IndicatorParams))} className="w-20 bg-[var(--panel)] border border-[var(--border)] px-1" />
              </label>
            ))}
            <label className="flex items-center justify-between gap-2">Calculation source
              <select value={indicatorParams.source} onChange={(e) => setIndicatorParams((current) => ({ ...current, source: e.target.value as CandleSource }))}>
                {(["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] as const).map((source) => <option key={source} value={source}>{source.toUpperCase()}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2">VWAP anchor
              <select value={indicatorParams.vwapAnchor} onChange={(e) => setIndicatorParams((current) => ({ ...current, vwapAnchor: e.target.value as IndicatorParams["vwapAnchor"] }))}>
                <option value="1D">Daily</option><option value="1W">Weekly</option><option value="1M">Monthly</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2">EMA smoothing
              <select value={indicatorParams.emaMaType} onChange={(e) => setIndicatorParams((current) => ({ ...current, emaMaType: e.target.value as IndicatorParams["emaMaType"] }))}>
                {(["None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA"] as const).map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={indicatorParams.vwapBands} onChange={(e) => setIndicatorParams((current) => ({ ...current, vwapBands: e.target.checked }))} />VWAP deviation bands</label>
            <label className="flex items-center justify-between gap-2">PVP values
              <select value={indicatorParams.pvpView} onChange={(e) => setIndicatorParams((current) => ({ ...current, pvpView: e.target.value as IndicatorParams["pvpView"] }))}>
                <option value="profile">Profile + levels</option><option value="levels">POC / VAH / VAL only</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2">PVP distribution
              <select value={indicatorParams.pvpDisplay} onChange={(e) => setIndicatorParams((current) => ({ ...current, pvpDisplay: e.target.value as IndicatorParams["pvpDisplay"] }))}>
                <option value="Volume">Volume</option><option value="Counter">Candle count</option>
              </select>
            </label>
          </div>
        </div>
      )}
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="relative flex-1 min-h-0">
        {candles?.length && countdownY !== null && (() => {
          const last = candles[candles.length - 1];
          return (
            <div className="absolute right-0 z-20 -translate-y-1/2 bg-[var(--amber)] px-1 py-0.5 text-[10px] font-semibold text-black pointer-events-none" style={{ top: countdownY }} title="Verbleibende Zeit bis zum Kerzenschluss">
              {countdownLabel(candleCloseTime(last.time, range, timeframe, symbol), clockNow)}
            </div>
          );
        })()}
        {legend && (
          <div className="chart-legend absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-[11px] pointer-events-none px-2 py-1 rounded max-w-[95%]">
            <div className="flex gap-3">
              <span className="dim">O <span className="text-[var(--text)]">{fmt(legend.open)}</span></span>
              <span className="dim">H <span className="up">{fmt(legend.high)}</span></span>
              <span className="dim">L <span className="down">{fmt(legend.low)}</span></span>
              <span className="dim">C <span className={legend.close >= legend.open ? "up" : "down"}>{fmt(legend.close)}</span></span>
              <span className="dim">Vol <span className="text-[var(--text)]">{fmtBig(legend.volume)}</span></span>
            </div>
            {indicatorRows.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {indicatorRows.map((r) => (
                  <span key={r.label} className="dim">
                    {r.label} <span style={{ color: r.color }}>{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
