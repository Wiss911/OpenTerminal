"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type Msg = { role: "user" | "assistant"; content: string };
type ContextOptions = { quote: boolean; watchlist: boolean; crypto: boolean; hyperliquid: boolean; note: string };
const DEFAULT_CONTEXT: ContextOptions = { quote: true, watchlist: false, crypto: false, hyperliquid: false, note: "" };

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [contextOptions, setContextOptions] = useState<ContextOptions>(() => {
    try {
      const saved = typeof window === "undefined" ? null : localStorage.getItem("openterminal-ai-context");
      return saved ? { ...DEFAULT_CONTEXT, ...JSON.parse(saved) } : DEFAULT_CONTEXT;
    } catch { return DEFAULT_CONTEXT; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveContextOptions = (next: ContextOptions) => {
    setContextOptions(next);
    try { localStorage.setItem("openterminal-ai-context", JSON.stringify(next)); }
    catch { /* in-memory settings remain active for this session */ }
  };

  const chat = useMutation({
    mutationFn: async (userText: string) => {
      const context: Record<string, unknown> = {
        activeSymbol,
        dashboard: { watchlistEnabled: contextOptions.watchlist, cryptoEnabled: contextOptions.crypto, hyperliquidEnabled: contextOptions.hyperliquid },
        userInstructions: contextOptions.note,
      };
      const requests: Promise<void>[] = [];
      if (contextOptions.quote) requests.push(apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(activeSymbol)}`).then((rows) => { context.quote = rows[0] ?? null; }).catch(() => {}));
      const watchlist = useTerminal.getState().watchlist;
      if (contextOptions.watchlist && watchlist.length) requests.push(apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(watchlist.slice(0, 40).join(","))}`).then((rows) => { context.watchlist = rows; }).catch(() => {}));
      if (contextOptions.crypto) requests.push(apiGet<unknown[]>("/api/crypto").then((rows) => { context.cryptoTop20 = rows.slice(0, 20); }).catch(() => {}));
      if (contextOptions.hyperliquid) requests.push(apiGet<unknown[]>("/api/crypto/hyperliquid").then((rows) => { context.hyperliquidTop20 = rows.slice(0, 20); }).catch(() => {}));
      await Promise.all(requests);
      const next = [...messages, { role: "user" as const, content: userText }];
      const res = await apiPost<{ text: string }>("/api/ai/chat", { messages: next, context });
      return { next, reply: res.text };
    },
    onSuccess: ({ next, reply }) => {
      setMessages([...next, { role: "assistant", content: reply }]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    chat.mutate(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. The current quote is shared as context.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}
        {chat.isPending && <div className="dim">thinking…</div>}
        {chat.error && <div className="down">{(chat.error as Error).message}</div>}
      </div>
      <details className="px-2 py-1 border-t border-[var(--border)] shrink-0">
        <summary className="dim cursor-pointer">Analysis context settings</summary>
        <div className="grid grid-cols-2 gap-1 py-1">
          {([["quote", "Active quote"], ["watchlist", "Watchlist quotes (up to 40)"], ["crypto", "Top 20 crypto spot"], ["hyperliquid", "Top 20 Hyperliquid markets"]] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 dim"><input type="checkbox" checked={contextOptions[key]} onChange={(e) => saveContextOptions({ ...contextOptions, [key]: e.target.checked })} />{label}</label>
          ))}
        </div>
        <textarea maxLength={2000} className="w-full min-h-12 resize-y" value={contextOptions.note} onChange={(e) => saveContextOptions({ ...contextOptions, note: e.target.value })} placeholder="Your extra analysis instructions…" />
        <div className="dim">Only the selected snapshots and this note are sent with each request.</div>
      </details>
      <div className="flex gap-1 p-1 border-t border-[var(--border)] shrink-0">
        <input
          className="flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Ask about ${activeSymbol}…`}
        />
        <button className="term-btn" onClick={send}>SEND</button>
      </div>
    </div>
  );
}
