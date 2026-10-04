"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BarSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, type Candle } from "../../lib/api";
import { sma, ema, vwap, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;

type Range = (typeof RANGES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.map((p) => [p.time, p.value]));

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd966", SMA50: "#4fc3f7", SMA200: "#ba68c8", EMA20: "#ff8a65",
  VWAP: "#80cbc4", RSI: "#ff9900", BOLL: "#ff9900", MACD: "#4fc3f7",
};

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [range, setRange] = useState<Range>("6M");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [active, setActive] = useState<Set<Indicator>>(new Set(["SMA20"]));
  const [legend, setLegend] = useState<Candle | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chartBackground, setChartBackground] = useState<string | null>(null);
  const [themePanel, setThemePanel] = useState("#0a0a0a");
  const [themeRevision, setThemeRevision] = useState(0);
  const [rightOffset, setRightOffset] = useState(5);
  const [settingsReady, setSettingsReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const settingsKey = `openterminal:chart-settings:${widget.id}`;
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
        const parsed = JSON.parse(saved) as { background?: string; rightOffset?: number };
        if (typeof parsed.background === "string" && /^#[0-9a-f]{6}$/i.test(parsed.background) && parsed.background.toLowerCase() !== "#0a0a0a") setChartBackground(parsed.background);
        if (typeof parsed.rightOffset === "number" && Number.isFinite(parsed.rightOffset)) setRightOffset(Math.max(0, Math.min(20, parsed.rightOffset)));
      }
    } catch { /* Keep usable defaults when local settings are unavailable. */ }
    setSettingsReady(true);
  }, [settingsKey]);

  useEffect(() => {
    if (!settingsReady) return;
    try { localStorage.setItem(settingsKey, JSON.stringify({ ...(chartBackground ? { background: chartBackground } : {}), rightOffset })); }
    catch { /* Settings remain active for this session when storage is unavailable. */ }
  }, [chartBackground, rightOffset, settingsKey, settingsReady]);

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
    return {
      SMA20: active.has("SMA20") ? sma(candles, 20) : null,
      SMA50: active.has("SMA50") ? sma(candles, 50) : null,
      SMA200: active.has("SMA200") ? sma(candles, 200) : null,
      EMA20: active.has("EMA20") ? ema(candles, 20) : null,
      VWAP: active.has("VWAP") ? vwap(candles) : null,
      RSI: active.has("RSI") ? rsi(candles) : null,
      BOLL: active.has("BOLL") ? bollinger(candles) : null,
      MACD: active.has("MACD") ? macd(candles) : null,
    };
  }, [candles, active]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.VWAP) maps.VWAP = toMap(indicatorData.VWAP);
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
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP"] as const) {
      const v = get(key);
      if (v !== undefined) rows.push({ label: key, value: fmt(v), color: INDICATOR_COLOR[key] });
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
  }, [legend, indicatorMaps]);

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

    const overlay = (points: Point[], color: string) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(points.map((p) => ({ time: ts(p.time), value: p.value })));

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, INDICATOR_COLOR.SMA20);
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, INDICATOR_COLOR.SMA50);
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, INDICATOR_COLOR.SMA200);
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, INDICATOR_COLOR.EMA20);
    if (indicatorData?.VWAP) overlay(indicatorData.VWAP, INDICATOR_COLOR.VWAP);
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, accentSoft);
      overlay(indicatorData.BOLL.middle, accent);
      overlay(indicatorData.BOLL.lower, accentSoft);
    }

    let paneIdx = 1;
    if (indicatorData?.RSI) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLOR.RSI, lineWidth: 1 }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
      const m = indicatorData.MACD;
      const pane = paneIdx++;
      chart.addSeries(HistogramSeries, { color: accent }, pane).setData(
        m.histogram.map((p) => ({ time: ts(p.time), value: p.value, color: p.value >= 0 ? volumeUpStrong : volumeDownStrong }))
      );
      chart.addSeries(LineSeries, { color: accent, lineWidth: 1 }, pane).setData(
        m.macd.map((p) => ({ time: ts(p.time), value: p.value }))
      );
      chart.addSeries(LineSeries, { color: chartText, lineWidth: 1 }, pane).setData(
        m.signal.map((p) => ({ time: ts(p.time), value: p.value }))
      );
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
  }, [candles, chartType, indicatorData, range, byTime, themeRevision]);

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
        <div className="flex gap-4 items-center flex-wrap px-2 py-1 border-b border-[var(--border)] text-xs shrink-0">
          <label className="flex items-center gap-2">Background
            <input type="color" value={chartBackground ?? themePanel} onChange={(e) => setChartBackground(e.target.value)} className="w-7 h-6 p-0 border-0 bg-transparent" />
            <span className="dim">{chartBackground ?? themePanel}</span>
          </label>
          <label className="flex items-center gap-2">Space after last candle
            <input type="range" min="0" max="20" value={rightOffset} onChange={(e) => setRightOffset(Number(e.target.value))} />
            <span className="dim w-8">{rightOffset} bars</span>
          </label>
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
