"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal } from "../store/terminal";

type Status = {
  ok: boolean;
  providers: Array<{ name: string; ok: number; failed: number; lastLatencyMs: number | null }>;
  ai: boolean;
};

function Clock({ tz, label }: { tz: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const zoneName = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value;
  const localDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  return (
    <span className="dim" title={`${localDate} · ${tz}`} aria-label={`${label} ${localTime} ${zoneName ?? tz}`}>
      {label}{" "}
      <span className="text-[var(--text)]">
        {localTime}
      </span>
      <span className="ml-1 text-[9px]">{zoneName}</span>
    </span>
  );
}

function marketStateNY(): { label: string; open: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const weekday = part("weekday");
  const day = weekday === "Sun" ? 0 : weekday === "Mon" ? 1 : weekday === "Tue" ? 2 : weekday === "Wed" ? 3 : weekday === "Thu" ? 4 : weekday === "Fri" ? 5 : 6;
  const mins = Number(part("hour")) * 60 + Number(part("minute"));
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 09:30–16:00
  return { label: open ? "NYSE OPEN" : "NYSE CLOSED", open };
}

export default function TopBar() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const [theme, setTheme] = useState(() => {
    try { return typeof window === "undefined" ? "terminal" : localStorage.getItem("openterminal-theme") ?? "terminal"; }
    catch { return "terminal"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const changeTheme = (next: string) => {
    setTheme(next);
    localStorage.setItem("openterminal-theme", next);
  };
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<Status>("/api/status"),
    refetchInterval: 30_000,
  });

  const market = marketStateNY();
  const feedNames: Record<string, string> = { hyperliquid: "HL", "binance-futures": "BF" };
  const feeds = status?.providers.filter((p) => p.ok > 0 || p.name === "hyperliquid" || p.name === "binance-futures") ?? [];

  return (
    <header className="flex items-center gap-4 px-3 h-8 bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px] shrink-0">
      <span className="amber font-bold tracking-widest">OPENTERMINAL</span>
      <span className={market.open ? "up" : "down"}>● {market.label}</span>
      <Clock tz="America/New_York" label="NY" />
      <Clock tz="Europe/Rome" label="MIL" />
      <Clock tz="Europe/London" label="LDN" />
      <Clock tz="Asia/Tokyo" label="TYO" />
      <button
        className="term-btn flex-1 max-w-md text-left dim"
        onClick={() => setCommandOpen(true)}
      >
        {activeSymbol} — search symbol… <span className="float-right">⌘K</span>
      </button>
      <span className="dim ml-auto">
        feeds:{" "}
        {feeds.length > 0
          ? feeds.map((p) => `${feedNames[p.name] ?? p.name} ${p.lastLatencyMs ?? "—"}ms`).join(" · ")
          : "connecting…"}
      </span>
      <select aria-label="Dashboard theme" value={theme} onChange={(e) => changeTheme(e.target.value)} title="Dashboard color theme">
        <option value="terminal">Amber Terminal</option>
        <option value="ocean">Ocean Blue</option>
        <option value="violet">Violet Night</option>
        <option value="graphite">Graphite Green</option>
        <option value="paper">Paper Light</option>
        <option value="paper-dark">Paper Dark</option>
      </select>
      <span className={status?.ai ? "up" : "dim"}>AI {status?.ai ? "●" : "○"}</span>
    </header>
  );
}
