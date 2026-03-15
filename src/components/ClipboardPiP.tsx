"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { GameWithTags } from "@/lib/types";
import { MatchResult, MatchConfig, DEFAULT_MATCH_CONFIG, findMatches } from "@/lib/clipboard-match";

const COLORS = {
  exact: { bg: "#22c55e", label: "EXACT" },
  partial: { bg: "#f97316", label: "PARTIAL" },
  fuzzy: { bg: "#3b82f6", label: "FUZZY" },
  none: { bg: "#ef4444", label: "NOT FOUND" },
};

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clipText: string,
  libraryMatch: MatchResult,
  wishlistMatch: MatchResult
) {
  const dpr = 2;
  ctx.canvas.width = width * dpr;
  ctx.canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // Scale: base 400px, smaller default font
  const s = Math.max(width / 400, 0.5);
  const headerH = Math.round(22 * s);
  const statusH = Math.round(18 * s);
  const pad = Math.round(6 * s);
  const nameSize = Math.round(9 * s);
  const tagSize = Math.round(7.5 * s);
  const lineH = Math.round(12 * s);
  const tagLineH = Math.round(10 * s);
  const halfW = Math.floor(width / 2);

  // Background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, width, height);

  // Header (full width)
  ctx.fillStyle = "#0f0f23";
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `bold ${Math.round(10 * s)}px system-ui, sans-serif`;
  ctx.fillText(`📋 ${clipText}`, pad, headerH * 0.72);

  // Divider line between columns
  ctx.fillStyle = "#334155";
  ctx.fillRect(halfW - 1, headerH, 1, height - headerH);

  // Draw a column of matches
  const drawColumn = (
    x: number, colW: number, label: string, match: MatchResult
  ) => {
    const color = COLORS[match.type];
    // Tint entire column background
    ctx.fillStyle = color.bg + "40";
    ctx.fillRect(x, headerH, colW, height - headerH);
    // Status bar
    ctx.fillStyle = color.bg;
    ctx.fillRect(x, headerH, colW, statusH);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(8 * s)}px system-ui, sans-serif`;
    ctx.fillText(
      `${label}: ${color.label}${match.games.length > 0 ? ` (${match.games.length})` : ""}`,
      x + pad,
      headerH + statusH * 0.72
    );

    // Games
    let y = headerH + statusH + Math.round(4 * s);
    ctx.font = `${nameSize}px system-ui, sans-serif`;
    for (const game of match.games.slice(0, 5)) {
      if (y + lineH > height - 2) break;
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(game.name, x + pad, y + nameSize, colW - pad * 2);
      y += lineH;

      if (game.tags && game.tags.length > 0) {
        if (y + tagLineH > height - 2) break;
        ctx.fillStyle = "#94a3b8";
        ctx.font = `${tagSize}px system-ui, sans-serif`;
        const tagStr = game.tags
          .map((t) => `${t.tag_name}${t.subtag_name ? ">" + t.subtag_name : ""}`)
          .join(", ");
        ctx.fillText(tagStr, x + pad + Math.round(4 * s), y + tagSize, colW - pad * 3);
        y += tagLineH;
        ctx.font = `${nameSize}px system-ui, sans-serif`;
      }
      y += Math.round(2 * s);
    }

    if (match.type === "none") {
      ctx.fillStyle = "#64748b";
      ctx.font = `${Math.round(8 * s)}px system-ui, sans-serif`;
      ctx.fillText("—", x + pad, y + Math.round(8 * s));
    }
  };

  drawColumn(0, halfW - 1, "LIBRARY", libraryMatch);
  drawColumn(halfW, width - halfW, "WISHLIST", wishlistMatch);
}

interface ClipboardPiPProps {
  active: boolean;
}

export default function ClipboardPiP({ active }: ClipboardPiPProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipWindowRef = useRef<PictureInPictureWindow | null>(null);
  const lastClipRef = useRef("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const libMatchRef = useRef<MatchResult>({ type: "none", games: [] });
  const wishMatchRef = useRef<MatchResult>({ type: "none", games: [] });
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const configRef = useRef<MatchConfig>(DEFAULT_MATCH_CONFIG);

  // Fetch ALL games + settings once
  useEffect(() => {
    if (!active) return;
    fetch("/api/games/all")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAllGames(data); })
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Record<string, string>) => {
        configRef.current = {
          partialLimit: parseInt(s.clip_partial_limit, 10) || DEFAULT_MATCH_CONFIG.partialLimit,
          fuzzyLimit: parseInt(s.clip_fuzzy_limit, 10) || DEFAULT_MATCH_CONFIG.fuzzyLimit,
          fuzzyThreshold: parseFloat(s.clip_fuzzy_threshold) || DEFAULT_MATCH_CONFIG.fuzzyThreshold,
        };
      })
      .catch(() => {});
  }, [active]);

  // Split into library (has custom tags, excluding owned-only) vs wishlist-only
  const libraryGames = allGames.filter((g) => g.tags && g.tags.some((t) => t.tag_name !== "owned"));
  const wishlistGames = allGames; // search all for wishlist column

  const doMatch = useCallback((text: string) => {
    libMatchRef.current = findMatches(text, libraryGames, configRef.current);
    wishMatchRef.current = findMatches(text, wishlistGames, configRef.current);
  }, [libraryGames, wishlistGames]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pipW = pipWindowRef.current;
    const w = pipW ? pipW.width : 400;
    const h = pipW ? pipW.height : 225;
    drawCanvas(ctx, w, h, lastClipRef.current || "(waiting...)", libMatchRef.current, wishMatchRef.current);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 450;
      canvasRef.current = canvas;
    }
    if (!videoRef.current) {
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      const stream = canvasRef.current.captureStream(30);
      video.srcObject = stream;
      video.play().catch(() => {});
      videoRef.current = video;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      pipWindowRef.current = null;
      return;
    }

    redraw();

    const openPiP = async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        await video.play();
        const pipWin = await video.requestPictureInPicture();
        pipWindowRef.current = pipWin;
        pipWin.addEventListener("resize", redraw);
        redraw();
      } catch (err) { console.warn("PiP failed:", err); }
    };
    setTimeout(openPiP, 200);

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/clipboard");
        const data = await res.json();
        const text = (data.text || "").trim();
        if (text && text !== lastClipRef.current && text.length >= 2 && text.length < 200) {
          lastClipRef.current = text;
          doMatch(text);
          redraw();
        }
      } catch {}
    }, 1000);

    const video = videoRef.current;
    const onLeave = () => { pipWindowRef.current = null; };
    video?.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      video?.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [active, doMatch, redraw]);

  useEffect(() => {
    if (active && lastClipRef.current && allGames.length > 0) {
      doMatch(lastClipRef.current);
      redraw();
    }
  }, [allGames, active, doMatch, redraw]);

  return null;
}
