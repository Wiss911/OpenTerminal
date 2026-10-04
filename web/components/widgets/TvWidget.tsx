"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Channel =
  | { id: string; label: string; type: "hls"; url: string }
  | { id: string; label: string; type: "youtube"; channelId: string; youtubeUrl: string };

// Keep sources here so channels can be added or changed without touching player logic.
const CHANNELS: Channel[] = [
  { id: "bloomberg", label: "Bloomberg TV", type: "hls", url: "https://liveprodusphoenixeast.global.ssl.fastly.net/USPhx-HD/Channel-TX-USPhx-AWS-virginia-1/Source-USPhx-16k-1-s6lk2-BP-07-02-81ykIWnsMsg_live.m3u8" },
  { id: "yahoo", label: "Yahoo Finance", type: "hls", url: "https://d1ewctnvcwvvvu.cloudfront.net/playlist.m3u8" },
  { id: "cnbc", label: "CNBC", type: "hls", url: "https://gpuserver3.tier1streams.com/CNBC/index.m3u8" },
  { id: "cheddar", label: "Cheddar Business", type: "hls", url: "https://gpuserver3.tier1streams.com/CHEDDAR_BUSINESS/index.m3u8" },
  { id: "ndtv", label: "NDTV Profit", type: "hls", url: "https://ndtvprofit.akamaized.net/hls/live/2107404/ndtvprofit/master_1.m3u8" },
  {
    id: "cryptoface",
    label: "Crypto Face (YouTube)",
    type: "youtube",
    channelId: "UCs916iGMdCKKVHMnbzXTgYA",
    youtubeUrl: "https://www.youtube.com/@cryptoface68/live",
  },
];

type YouTubePlayer = { destroy: () => void };
type YouTubeErrorEvent = { data: number };

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLIFrameElement, options: object) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<void>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timer = window.setTimeout(() => reject(new Error("YouTube-Player konnte nicht geladen werden.")), 15_000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      previousReady?.();
      resolve();
    };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("YouTube-Player konnte nicht geladen werden."));
      };
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    youtubeApiPromise = null;
    throw error;
  });
  return youtubeApiPromise;
}

export default function TvWidget() {
  const [channelId, setChannelId] = useState("cryptoface");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channel = CHANNELS.find((item) => item.id === channelId) ?? CHANNELS[0];

  useEffect(() => {
    setError(null);
    if (channel.type === "youtube") {
      let player: YouTubePlayer | undefined;
      let active = true;
      loadYouTubeApi().then(() => {
        if (!active || !iframeRef.current || !window.YT?.Player) return;
        player = new window.YT.Player(iframeRef.current, {
          events: {
            onError: (event: YouTubeErrorEvent) => {
              if (active) setError(event.data === 101 || event.data === 150
                ? "Dieser Stream darf nicht in OpenTerminal eingebettet werden. Öffne ihn direkt auf YouTube."
                : "Der YouTube-Livestream ist gerade nicht verfügbar. Öffne den Kanal auf YouTube.");
            },
          },
        });
      }).catch(() => {
        if (active) setError("YouTube konnte nicht geladen werden. Öffne den Kanal direkt auf YouTube.");
      });
      return () => {
        active = false;
        player?.destroy();
      };
    }

    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError(`Stream unavailable right now (${data.details}). Try another channel.`);
      });
      return () => hls.destroy();
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      video.play().catch(() => {});
    } else {
      setError("Your browser doesn't support HLS playback.");
    }
  }, [channel]);

  const youtubeEmbed = channel.type === "youtube"
    ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channel.channelId)}&autoplay=1&mute=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(typeof window === "undefined" ? "" : window.location.origin)}`
    : "";

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        {CHANNELS.map((item) => (
          <button key={item.id} className={`term-btn ${channel.id === item.id ? "active" : ""}`} onClick={() => setChannelId(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="relative flex-1 min-h-0 bg-black">
        {channel.type === "youtube" ? (
          <iframe
            ref={iframeRef}
            title={channel.label}
            src={youtubeEmbed}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <video ref={videoRef} className="w-full h-full" autoPlay muted controls playsInline />
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center dim bg-black">
            <span>{error}</span>
            {channel.type === "youtube" && <a className="amber underline" href={channel.youtubeUrl} target="_blank" rel="noreferrer">Auf YouTube öffnen</a>}
          </div>
        )}
      </div>
    </div>
  );
}
