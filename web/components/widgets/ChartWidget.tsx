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
  type UTCTimestamp,
} from "lightweight-charts";
import { EMA, VWAP, Supertrend, WaveTrend } from "lightweight-charts-indicators";
import { apiGet, fmt, fmtBig, type Candle } from "../../lib/api";
import { sma, dailyProfileLevels, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "EMA50", "EMA200", "WVWAP", "SUPERTREND", "WAVETREND", "POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL", "BOLL", "RSI", "MACD"] as const;

type Range = (typeof RANGES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.map((p) => [p.time, p.value]));

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd966", SMA50: "#4fc3f7", SMA200: "#ba68c8", EMA20: "#ff8a65", EMA50: "#4fc3f7", EMA200: "#ba68c8",
  WVWAP: "#26a69a", WVWAP_U: "#80cbc4", WVWAP_L: "#80cbc4", SUPERTREND_UP: "#26a69a", SUPERTREND_DOWN: "#ef5350", WAVETREND: "#26a69a", WAVETREND_SIGNAL: "#b0bec5", POC: "#ff5252", VAH: "#ab47bc", VAL: "#ab47bc",
  PDPOC: "#ef5350", PDVAH: "#7e57c2", PDVAL: "#7e57c2", RSI: "#ff9900", BOLL: "#ff9900", MACD: "#4fc3f7", MACD_SIGNAL: "#b0bec5",
};
type UserLineStyle = "solid" | "dotted" | "dashed";
type LineConfig = { color: string; width: number; style: UserLineStyle };
const DEFAULT_LINE_CONFIGS: Record<string, LineConfig> = Object.fromEntries(
  Object.entries(INDICATOR_COLOR).map(([name, color]) => [name, { color, width: 1, style: "solid" }])
);
const SHARED_SETTINGS_KEY = "openterminal:chart-settings:shared";
const SETTINGS_EVENT = "openterminal:chart-settings-changed";
const DEFAULT_INDICATOR_PARAMS = { sma20: 20, sma50: 50, sma200: 200, ema20: 20, ema50: 50, ema200: 200, vwapDeviation: 1, supertrendAtr: 10, supertrendFactor: 3, waveChannel: 10, waveAverage: 21, bollPeriod: 20, bollMult: 2, rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, profileBins: 48 };
type IndicatorParams = typeof DEFAULT_INDICATOR_PARAMS;

const validInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
const validNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const fromPlot = (plots: Record<string, Point[]>, plot: string) =>
  (plots[plot] ?? []).filter((point) => Number.isFinite(point.value));

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [range, setRange] = useState<Range>("6M");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [active, setActive] = useState<Set<Indicator>>(new Set(["EMA20"]));
  const [legend, setLegend] = useState<Candle | null>(null);
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
        const parsed = JSON.parse(saved) as { background?: string; rightOffset?: number; lineConfigs?: Record<string, LineConfig>; indicatorParams?: Partial<IndicatorParams> };
        if (typeof parsed.background === "string" && /^#[0-9a-f]{6}$/i.test(parsed.background) && parsed.background.toLowerCase() !== "#0a0a0a") setChartBackground(parsed.background);
        if (typeof parsed.rightOffset === "number" && Number.isFinite(parsed.rightOffset)) setRightOffset(Math.max(0, Math.min(20, parsed.rightOffset)));
        if (parsed.lineConfigs && typeof parsed.lineConfigs === "object") setLineConfigs((current) => {
          const next = { ...current };
          for (const [name, value] of Object.entries(parsed.lineConfigs!)) {
            if (next[name] && value && /^#[0-9a-f]{6}$/i.test(value.color) && ["solid", "dotted", "dashed"].includes(value.style)) {
              next[name] = { color: value.color, width: validInt(value.width, 1, 4, 1), style: value.style };
            }
          }
          return next;
        });
        if (parsed.indicatorParams) setIndicatorParams({
          sma20: validInt(parsed.indicatorParams.sma20, 2, 500, 20), sma50: validInt(parsed.indicatorParams.sma50, 2, 500, 50), sma200: validInt(parsed.indicatorParams.sma200, 2, 500, 200),
          ema20: validInt(parsed.indicatorParams.ema20, 2, 500, 20), ema50: validInt(parsed.indicatorParams.ema50, 2, 500, 50),
          ema200: validInt(parsed.indicatorParams.ema200, 2, 500, 200), vwapDeviation: validNumber(parsed.indicatorParams.vwapDeviation, 0.1, 5, 1),
          supertrendAtr: validInt(parsed.indicatorParams.supertrendAtr, 2, 100, 10), supertrendFactor: validNumber(parsed.indicatorParams.supertrendFactor, 0.1, 20, 3),
          waveChannel: validInt(parsed.indicatorParams.waveChannel, 2, 100, 10), waveAverage: validInt(parsed.indicatorParams.waveAverage, 2, 100, 21),
          bollPeriod: validInt(parsed.indicatorParams.bollPeriod, 2, 500, 20), bollMult: validNumber(parsed.indicatorParams.bollMult, 0.1, 10, 2),
          rsiPeriod: validInt(parsed.indicatorParams.rsiPeriod, 2, 100, 14), macdFast: validInt(parsed.indicatorParams.macdFast, 2, 100, 12),
          macdSlow: validInt(parsed.indicatorParams.macdSlow, 3, 200, 26), macdSignal: validInt(parsed.indicatorParams.macdSignal, 2, 100, 9),
          profileBins: validInt(parsed.indicatorParams.profileBins, 8, 128, 48),
        });
      }
    } catch { /* Keep usable defaults when local settings are unavailable. */ }
    setSettingsReady(true);
  }, [settingsKey]);

  useEffect(() => {
    const syncSettings = (event?: Event) => {
      const custom = event as CustomEvent<{ background?: string | null; rightOffset?: number; lineConfigs?: Record<string, LineConfig>; indicatorParams?: Partial<IndicatorParams> }> | undefined;
      const saved = custom?.detail ?? (() => {
        try { return JSON.parse(localStorage.getItem(settingsKey) ?? "null"); } catch { return null; }
      })();
      if (!saved) return;
      const background = typeof saved.background === "string" ? saved.background : null;
      setChartBackground((current) => current === background ? current : background);
      if (typeof saved.rightOffset === "number") setRightOffset((current) => current === validInt(saved.rightOffset, 0, 20, 5) ? current : validInt(saved.rightOffset, 0, 20, 5));
      if (saved.lineConfigs) setLineConfigs((current) => JSON.stringify(current) === JSON.stringify({ ...current, ...saved.lineConfigs }) ? current : ({ ...current, ...saved.lineConfigs }));
      if (saved.indicatorParams) setIndicatorParams((current) => JSON.stringify(current) === JSON.stringify({ ...current, ...saved.indicatorParams }) ? current : ({ ...current, ...saved.indicatorParams }));
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
      const saved = { ...(chartBackground ? { background: chartBackground } : {}), rightOffset, lineConfigs, indicatorParams };
      localStorage.setItem(settingsKey, JSON.stringify(saved));
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: saved }));
    }
    catch { /* Settings remain active for this session when storage is unavailable. */ }
  }, [chartBackground, rightOffset, settingsKey, settingsReady, lineConfigs, indicatorParams]);

  useEffect(() => {
    chartSettingsRef.current = { chartBackground, themePanel, rightOffset };
  }, [chartBackground, themePanel, rightOffset]);

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range],
    queryFn: () => apiGet<Candle[]>(`/api/history/${symbol}?range=${range}`),
    refetchInterval: range === "1D" ? 8_000 : 60_000,
  });

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
    const calculateEma = (length: number) => fromPlot({ plot0: EMA.calculate(bars, { length, src: "close" }).plots.plot0 ?? [] }, "plot0");
    const vwap = active.has("WVWAP") ? VWAP.calculate(bars, { anchor: "1W", showBands: true, bandMult: indicatorParams.vwapDeviation }).plots : null;
    const supertrend = active.has("SUPERTREND") ? Supertrend.calculate(bars, { atrPeriod: indicatorParams.supertrendAtr, factor: indicatorParams.supertrendFactor }).plots : null;
    const wave = active.has("WAVETREND") ? WaveTrend.calculate(bars, { channelLength: indicatorParams.waveChannel, averageLength: indicatorParams.waveAverage }).plots : null;
    return {
      SMA20: active.has("SMA20") ? sma(candles, indicatorParams.sma20) : null,
      SMA50: active.has("SMA50") ? sma(candles, indicatorParams.sma50) : null,
      SMA200: active.has("SMA200") ? sma(candles, indicatorParams.sma200) : null,
      EMA20: active.has("EMA20") ? calculateEma(indicatorParams.ema20) : null,
      EMA50: active.has("EMA50") ? calculateEma(indicatorParams.ema50) : null,
      EMA200: active.has("EMA200") ? calculateEma(indicatorParams.ema200) : null,
      WVWAP: vwap ? { center: fromPlot(vwap, "plot0"), upper: fromPlot(vwap, "plot1"), lower: fromPlot(vwap, "plot2") } : null,
      SUPERTREND: supertrend ? { up: fromPlot(supertrend, "plot0"), down: fromPlot(supertrend, "plot1") } : null,
      WAVETREND: wave ? { wt1: fromPlot(wave, "plot0"), wt2: fromPlot(wave, "plot1") } : null,
      PROFILE: (active.has("POC") || active.has("VAH") || active.has("VAL") || active.has("PDPOC") || active.has("PDVAH") || active.has("PDVAL")) ? dailyProfileLevels(candles, indicatorParams.profileBins) : null,
      RSI: active.has("RSI") ? rsi(candles, indicatorParams.rsiPeriod) : null,
      BOLL: active.has("BOLL") ? bollinger(candles, indicatorParams.bollPeriod, indicatorParams.bollMult) : null,
      MACD: active.has("MACD") ? macd(candles, Math.min(indicatorParams.macdFast, indicatorParams.macdSlow - 1), indicatorParams.macdSlow, indicatorParams.macdSignal) : null,
    };
  }, [candles, active, indicatorParams]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.EMA50) maps.EMA50 = toMap(indicatorData.EMA50);
    if (indicatorData.EMA200) maps.EMA200 = toMap(indicatorData.EMA200);
    if (indicatorData.WVWAP) {
      maps.WVWAP = toMap(indicatorData.WVWAP.center);
      maps.WVWAP_U = toMap(indicatorData.WVWAP.upper);
      maps.WVWAP_L = toMap(indicatorData.WVWAP.lower);
    }
    if (indicatorData.SUPERTREND) { maps.SUPERTREND_U = toMap(indicatorData.SUPERTREND.up); maps.SUPERTREND_D = toMap(indicatorData.SUPERTREND.down); }
    if (indicatorData.WAVETREND) { maps.WAVETREND_1 = toMap(indicatorData.WAVETREND.wt1); maps.WAVETREND_2 = toMap(indicatorData.WAVETREND.wt2); }
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
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "EMA50", "EMA200", "WVWAP", "WVWAP_U", "WVWAP_L", "POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL"] as const) {
      const v = get(key);
      if (v !== undefined) rows.push({ label: key, value: fmt(v), color: lineConfigs[key]?.color ?? INDICATOR_COLOR[key] });
    }
    const rsiV = get("RSI");
    if (rsiV !== undefined) rows.push({ label: "RSI", value: fmt(rsiV, 1), color: INDICATOR_COLOR.RSI });
    const bollM = get("BOLL_M");
    if (bollM !== undefined) {
      rows.push({
        label: "BOLL",
        value: `${fmt(get("BOLL_U"))} / ${fmt(bollM)} / ${fmt(get("BOLL_L"))}`,
        color: INDICATOR_COLOR.BOLL,
      });
    }
    const macdM = get("MACD_M");
    if (macdM !== undefined) {
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
      layout: { background: { color: chartSettings.chartBackground ?? chartSettings.themePanel }, textColor: chartText, fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: chartGrid }, horzLines: { color: chartGrid } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: chartBorder, timeVisible: range === "1D" || range === "5D", rightOffset: chartSettings.rightOffset },
      rightPriceScale: { borderColor: chartBorder },
      autoSize: true,
      // Mouse-wheel is left free for page scrolling — zoom via drag, pinch, or the range buttons instead.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    if (chartType === "candles") {
      chart
        .addSeries(CandlestickSeries, {
          upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor: upColor, wickDownColor: downColor,
        })
        .setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "bars") {
      chart
        .addSeries(BarSeries, { upColor, downColor })
        .setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "line") {
      chart
        .addSeries(LineSeries, { color: accent, lineWidth: 1 })
        .setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    } else {
      chart
        .addSeries(AreaSeries, { lineColor: accent, topColor: accentSoft, bottomColor: accentTransparent })
        .setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
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
        .setData(points.map((p) => ({ time: ts(p.time), value: p.value })));
    };

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, "SMA20");
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, "SMA50");
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, "SMA200");
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, "EMA20");
    if (indicatorData?.EMA50) overlay(indicatorData.EMA50, "EMA50");
    if (indicatorData?.EMA200) overlay(indicatorData.EMA200, "EMA200");
    if (indicatorData?.WVWAP) {
      overlay(indicatorData.WVWAP.center, "WVWAP");
      overlay(indicatorData.WVWAP.upper, "WVWAP_U");
      overlay(indicatorData.WVWAP.lower, "WVWAP_L");
    }
    if (indicatorData?.SUPERTREND) {
      overlay(indicatorData.SUPERTREND.up, "SUPERTREND_UP");
      overlay(indicatorData.SUPERTREND.down, "SUPERTREND_DOWN");
    }
    if (indicatorData?.PROFILE) for (const key of ["POC", "VAH", "VAL", "PDPOC", "PDVAH", "PDVAL"] as const) {
      if (active.has(key)) overlay(indicatorData.PROFILE[key], key);
    }
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, "BOLL");
      overlay(indicatorData.BOLL.middle, "BOLL");
      overlay(indicatorData.BOLL.lower, "BOLL");
    }

    let paneIdx = 1;
    if (indicatorData?.RSI) {
      const s = chart.addSeries(LineSeries, { color: lineConfigs.RSI.color, lineWidth: lineConfigs.RSI.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.RSI.style === "dotted" ? LineStyle.Dotted : lineConfigs.RSI.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
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
      const pane = paneIdx++;
      chart.addSeries(LineSeries, { color: lineConfigs.WAVETREND.color, lineWidth: lineConfigs.WAVETREND.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.WAVETREND.style === "dotted" ? LineStyle.Dotted : lineConfigs.WAVETREND.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, pane)
        .setData(indicatorData.WAVETREND.wt1.map((p) => ({ time: ts(p.time), value: p.value })));
      chart.addSeries(LineSeries, { color: lineConfigs.WAVETREND_SIGNAL.color, lineWidth: lineConfigs.WAVETREND_SIGNAL.width as 1 | 2 | 3 | 4, lineStyle: lineConfigs.WAVETREND_SIGNAL.style === "dotted" ? LineStyle.Dotted : lineConfigs.WAVETREND_SIGNAL.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid }, pane)
        .setData(indicatorData.WAVETREND.wt2.map((p) => ({ time: ts(p.time), value: p.value })));
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setLegend(candles[candles.length - 1]);
        return;
      }
      const hit = byTime.get(param.time as number);
      if (hit) setLegend(hit);
    });

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, chartType, indicatorData, range, byTime, themeRevision, lineConfigs, active]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { background: { color: chartBackground ?? themePanel } },
      timeScale: { rightOffset },
    });
  }, [chartBackground, rightOffset, themePanel]);

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
          <button key={ind} className={`term-btn ${active.has(ind) ? "active" : ""}`} onClick={() => toggleIndicator(ind)}>
            {ind}
          </button>
        ))}
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
              ["sma20", "SMA 20 length", 2, 500, 1], ["sma50", "SMA 50 length", 2, 500, 1], ["sma200", "SMA 200 length", 2, 500, 1],
              ["ema20", "EMA 20 length", 2, 500, 1], ["ema50", "EMA 50 length", 2, 500, 1], ["ema200", "EMA 200 length", 2, 500, 1],
              ["vwapDeviation", "Weekly VWAP deviation", 0.1, 5, 0.1], ["supertrendAtr", "Supertrend ATR length", 2, 100, 1], ["supertrendFactor", "Supertrend factor", 0.1, 20, 0.1],
              ["waveChannel", "WaveTrend channel", 2, 100, 1], ["waveAverage", "WaveTrend average", 2, 100, 1], ["bollPeriod", "Bollinger period", 2, 500, 1],
              ["bollMult", "Bollinger multiplier", 0.1, 10, 0.1], ["rsiPeriod", "RSI period", 2, 100, 1],
              ["macdFast", "MACD fast", 2, 100, 1], ["macdSlow", "MACD slow", 3, 200, 1], ["macdSignal", "MACD signal", 2, 100, 1],
              ["profileBins", "Volume Profile bins", 8, 128, 1],
            ] as Array<[keyof IndicatorParams, string, number, number, number]>).map(([key, label, min, max, step]) => (
              <label key={key} className="flex items-center justify-between gap-2">{label}
                <input type="number" min={min} max={max} step={step} value={indicatorParams[key]} onChange={(e) => setIndicatorParams((current) => ({ ...current, [key]: step < 1 ? validNumber(Number(e.target.value), min, max, current[key]) : validInt(Number(e.target.value), min, max, current[key]) }))} className="w-20 bg-[var(--panel)] border border-[var(--border)] px-1" />
              </label>
            ))}
          </div>
        </div>
      )}
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="relative flex-1 min-h-0">
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
