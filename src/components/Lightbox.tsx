"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface MediaItem {
  type: "image" | "video";
  src: string;
  fullSrc?: string;
  videoUrl?: string;
  label?: string;
}

interface Props {
  items: MediaItem[];
  startIndex: number;
  onClose: () => void;
}

const SPEEDS = [2, 3, 5, 8];

export default function Lightbox({ items, startIndex, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const [videoReady, setVideoReady] = useState(false);
  const videoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  // Slideshow state
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1); // default 3s
  const slideshowRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const imageIndices = items.map((item, i) => item.type === "image" ? i : -1).filter((i) => i >= 0);

  const prev = useCallback(() => {
    setVideoReady(false);
    setIdx((i) => (i > 0 ? i - 1 : items.length - 1));
  }, [items.length]);

  const next = useCallback(() => {
    setVideoReady(false);
    setIdx((i) => (i < items.length - 1 ? i + 1 : 0));
  }, [items.length]);

  // Slideshow: advance to next image (skip videos)
  const nextImage = useCallback(() => {
    setIdx((cur) => {
      if (imageIndices.length <= 1) return cur;
      const curPos = imageIndices.indexOf(cur);
      const nextPos = curPos >= 0 ? (curPos + 1) % imageIndices.length : 0;
      return imageIndices[nextPos];
    });
  }, [imageIndices]);

  // Slideshow timer
  useEffect(() => {
    if (slideshowRef.current) { clearInterval(slideshowRef.current); slideshowRef.current = null; }
    if (playing && imageIndices.length > 1) {
      slideshowRef.current = setInterval(nextImage, SPEEDS[speedIdx] * 1000);
    }
    return () => { if (slideshowRef.current) clearInterval(slideshowRef.current); };
  }, [playing, speedIdx, nextImage, imageIndices.length]);

  // Stop slideshow if user lands on a video
  useEffect(() => {
    if (playing && items[idx]?.type === "video") setPlaying(false);
  }, [idx, playing, items]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
      if (e.key === "ArrowLeft") { e.stopImmediatePropagation(); e.preventDefault(); setPlaying(false); prev(); }
      if (e.key === "ArrowRight") { e.stopImmediatePropagation(); e.preventDefault(); setPlaying(false); next(); }
      if (e.key === " ") { e.stopImmediatePropagation(); e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, prev, next]);

  const item = items[idx];

  // Cleanup HLS on unmount or slide change
  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    };
  }, [idx]);

  // Auto-load video after delay (configurable via settings)
  useEffect(() => {
    if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setVideoReady(false);

    if (item?.type === "video" && item.videoUrl) {
      const delay = parseInt(localStorage.getItem("gm_video_delay") || "2", 10) * 1000;
      videoTimerRef.current = setTimeout(() => setVideoReady(true), delay);
    }
    return () => { if (videoTimerRef.current) clearTimeout(videoTimerRef.current); };
  }, [idx, item]);

  // Attach HLS when video is ready
  useEffect(() => {
    if (!videoReady || !videoRef.current || !item?.videoUrl) return;
    const video = videoRef.current;
    const url = item.videoUrl;
    const fixedUrl = url.replace("hls_264_master.m3u8", "hls_264_1_video.m3u8");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = fixedUrl;
      video.play().catch(() => {});
      return;
    }

    import("hls.js").then(({ default: Hls }) => {
      if (!Hls.isSupported()) {
        video.src = fixedUrl;
        video.play().catch(() => {});
        return;
      }
      const hls = new Hls({ maxMaxBufferLength: 30, startLevel: -1 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels || [];
        let target = levels.findIndex((l) => l.height === 720);
        if (target < 0) target = levels.findIndex((l) => l.height === 480);
        if (target >= 0) { hls.currentLevel = target; hls.nextLevel = target; }
        video.play().catch(() => {});
      });
    });
  }, [videoReady, item]);

  return (
    <div data-lightbox="true" className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        {item?.type === "video" ? (
          videoReady ? (
            <video ref={videoRef} controls className="max-w-[85vw] max-h-[85vh] rounded" style={{ minWidth: "640px" }} />
          ) : (
            <div className="relative">
              <img src={item.src} alt={item.label || "Video"} className="rounded shadow-2xl"
                style={{ maxWidth: "85vw", maxHeight: "85vh" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center animate-pulse">
                  <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </div>
                <span className="mt-2 text-white/60 text-xs">Loading video...</span>
              </div>
            </div>
          )
        ) : (
          <img src={item?.fullSrc || item?.src || ""} alt="" className="rounded shadow-2xl" style={{ maxWidth: "85vw", maxHeight: "85vh" }}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (item?.fullSrc && img.src !== item.src) { img.src = item.src; }
              else { img.style.display = "none"; }
            }} />
        )}

        {items.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); setPlaying(false); prev(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white text-lg flex items-center justify-center">
              ‹
            </button>
            <button onClick={(e) => { e.stopPropagation(); setPlaying(false); next(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white text-lg flex items-center justify-center">
              ›
            </button>
          </>
        )}

        {/* Bottom bar: counter + slideshow controls */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/50 px-3 py-1 rounded-full">
          <span className="text-xs text-white/60">
            {item?.type === "video" && "🎬 "}{idx + 1} / {items.length}
          </span>
          {imageIndices.length > 1 && item?.type !== "video" && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setPlaying((p) => !p); }}
                className="text-white/70 hover:text-white text-sm" title={playing ? "Pause (Space)" : "Slideshow (Space)"}>
                {playing ? "⏸" : "▶"}
              </button>
              <button onClick={(e) => { e.stopPropagation(); setSpeedIdx((i) => (i + 1) % SPEEDS.length); }}
                className="text-[10px] text-white/50 hover:text-white/80 min-w-[24px] text-center" title="Change speed">
                {SPEEDS[speedIdx]}s
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
