"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import { GameWithTags, Tag, Subtag, steamDbScore, TintColors, getScoreTint } from "@/lib/types";
import Lightbox, { MediaItem } from "./Lightbox";

function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).replace(/ /g, " ");
  } catch { return iso || ""; }
}

interface LayoutData {
  name: string;
  appid: number | null;
  headerImg: string | null;
  description: string;
  genres: string[];
  features: string[];
  communityTags: string[];
  developers: string;
  publishers: string;
  releaseDate: string;
  wishlistDate?: string | null;
  addedAt?: string | null;
  positivePercent: number;
  totalReviews: number;
  metacriticScore: number;
  reviewSentiment: string;
  screenshots: string[];
  fullScreenshots: string[];
  movies: { name: string; thumbnail: string; video_url: string }[];
  totalScreenshots?: number;
  totalMovies?: number;
  notes?: string;
  loading?: boolean;
  refreshKey?: number;
}

interface InspectorProps {
  game: GameWithTags;
  mode: "popup";
  onClose: () => void;
  onEdit: (game: GameWithTags) => void;
  onDelete: (id: number) => void;
  tags: Tag[];
  onUpdate?: (id: number, data: Record<string, unknown>) => Promise<void>;
  onTagInclude?: (tagId: number) => void;
  onTagExclude?: (tagId: number) => void;
  onSubtagInclude?: (subtagId: number) => void;
  onSubtagExclude?: (subtagId: number) => void;
  onGenreFilter?: (name: string, mode: "include" | "exclude") => void;
  onFeatureFilter?: (name: string, mode: "include" | "exclude") => void;
  onCommunityTagFilter?: (name: string, mode: "include" | "exclude") => void;
  colorCoded?: boolean;
  scoreSource?: "steam" | "steamdb";
  tintColors?: TintColors | null;
}

interface SteamPreviewProps {
  appid: number;
  name: string;
  image: string;
  onClose: () => void;
  onAdd: () => void;
  tags?: Tag[];
  adding: boolean;
}

function HDragHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastY = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastY.current = e.clientY;
    const onMouseMove = (ev: MouseEvent) => { if (!dragging.current) return; onDrag(ev.clientY - lastY.current); lastY.current = ev.clientY; };
    const onMouseUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
    window.addEventListener("mousemove", onMouseMove); window.addEventListener("mouseup", onMouseUp);
  }, [onDrag]);
  return <div onMouseDown={onMouseDown} className="h-[5px] shrink-0 cursor-row-resize hover:bg-accent/50 active:bg-accent/60 transition-colors bg-border/30" />;
}

function VDragHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      onDrag(ev.clientX - lastX.current);
      lastX.current = ev.clientX;
    };
    const onMouseUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [onDrag]);
  return <div onMouseDown={onMouseDown} className="w-[5px] shrink-0 cursor-col-resize hover:bg-accent/50 active:bg-accent/60 transition-colors bg-border/30 self-stretch" />;
}

function inspectorAssetId(game: { id?: number; steam_appid?: number | null }): string {
  return game.steam_appid ? String(game.steam_appid) : `manual_${game.id}`;
}

function getMovies(game: { id?: number; steam_appid?: number | null; movies?: string }): { name: string; thumbnail: string; video_url: string }[] {
  let parsed: { name: string; thumbnail_url: string; video_url: string }[] = [];
  try { parsed = JSON.parse(game.movies || "[]"); } catch { return []; }
  if (parsed.length === 0) return [];
  const aid = inspectorAssetId(game);
  return parsed.map((m, i) => ({
    name: m.name || "Trailer",
    thumbnail: `/api/assets/${aid}/movie_${i}.jpg`,
    video_url: m.video_url || "",
  }));
}

// Tag display for DB games
function TagDisplay({ game, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude }: {
  game: GameWithTags;
  onTagInclude?: (tagId: number) => void;
  onTagExclude?: (tagId: number) => void;
  onSubtagInclude?: (subtagId: number) => void;
  onSubtagExclude?: (subtagId: number) => void;
}) {
  return (
    <>
      <span className="text-[10px] text-muted block mb-1">Your Tags</span>
      <div className="flex flex-wrap gap-1">
        {game.tags && game.tags.length > 0 ? (() => {
          const grouped = new Map<number, { tag_name: string; tag_color: string; tag_id: number; subs: typeof game.tags }>();
          for (const t of game.tags) {
            if (!grouped.has(t.tag_id)) grouped.set(t.tag_id, { tag_name: t.tag_name, tag_color: t.tag_color, tag_id: t.tag_id, subs: [] });
            grouped.get(t.tag_id)!.subs.push(t);
          }
          return Array.from(grouped.values()).map((g) => (
            <div key={g.tag_id} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
              style={{ backgroundColor: g.tag_color + "12", border: `1px solid ${g.tag_color}30` }}>
              <span className="text-[10px] font-medium cursor-pointer hover:underline"
                style={{ color: g.tag_color }}
                title="Click=include, Right-click=exclude"
                onClick={() => onTagInclude?.(g.tag_id)}
                onContextMenu={(e) => { e.preventDefault(); onTagExclude?.(g.tag_id); }}
              >{g.tag_name}</span>
              {g.subs.some((s) => s.subtag_name) && (
                <>
                  <span className="text-[9px] text-muted">›</span>
                  {g.subs.filter((s) => s.subtag_name).map((s) => (
                    <span key={s.id} className="text-[10px] px-0.5 rounded cursor-pointer hover:ring-1 hover:ring-current"
                      style={{ backgroundColor: s.subtag_type === "meta" ? "#f59e0b18" : "#818cf818", color: s.subtag_type === "meta" ? "#f59e0b" : "#818cf8" }}
                      title="Click=include, Right-click=exclude"
                      onClick={() => s.subtag_id && onSubtagInclude?.(s.subtag_id)}
                      onContextMenu={(e) => { e.preventDefault(); s.subtag_id && onSubtagExclude?.(s.subtag_id); }}
                    >{s.subtag_name}</span>
                  ))}
                </>
              )}
            </div>
          ));
        })() : <span className="text-[10px] text-muted italic">No tags</span>}
      </div>
    </>
  );
}

// Tag pill helper for genres/features/community tags
function TagPills({ items, color, onFilter }: {
  items: string[]; color: string;
  onFilter?: (name: string, mode: "include" | "exclude") => void;
}) {
  if (items.length === 0) return <span className="text-[10px] text-muted">{"\u2014"}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer hover:brightness-125 transition-all"
          style={{ backgroundColor: color + "20", color }}
          title="Click=include, Right-click=exclude"
          onClick={() => onFilter?.(item, "include")}
          onContextMenu={(e) => { e.preventDefault(); onFilter?.(item, "exclude"); }}
        >{item}</span>
      ))}
    </div>
  );
}

// Two-column layout
const InspectorLayout = memo(function InspectorLayout({ data, onClose, tagsSlot, footerSlot, tintBg, onGenreFilter, onFeatureFilter, onCommunityTagFilter }: {
  data: LayoutData; onClose: () => void; tagsSlot?: React.ReactNode; footerSlot: React.ReactNode;
  tintBg?: string;
  onGenreFilter?: (name: string, mode: "include" | "exclude") => void;
  onFeatureFilter?: (name: string, mode: "include" | "exclude") => void;
  onCommunityTagFilter?: (name: string, mode: "include" | "exclude") => void;
}) {
  const [popupSize, setPopupSize] = useState(() => {
    if (typeof window === "undefined") return { w: 880, h: 700 };
    try { const s = localStorage.getItem("gm_inspector_size"); if (s) return JSON.parse(s); } catch {}
    return { w: 880, h: Math.round(window.innerHeight * 0.88) };
  });
  const resizing = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { startX: e.clientX, startY: e.clientY, startW: popupSize.w, startH: popupSize.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setPopupSize({ w: Math.max(600, resizing.current.startW + (ev.clientX - resizing.current.startX) * 2), h: Math.max(400, resizing.current.startH + (ev.clientY - resizing.current.startY) * 2) });
    };
    const onUp = () => {
      resizing.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
      setPopupSize((s: { w: number; h: number }) => { localStorage.setItem("gm_inspector_size", JSON.stringify(s)); return s; });
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [popupSize]);

  const [leftW, setLeftW] = useState(() => {
    if (typeof window === "undefined") return 38;
    try { const s = localStorage.getItem("gm_inspector_layout"); if (s) return JSON.parse(s).leftW ?? 38; } catch {}
    return 38;
  });
  const [descPct, setDescPct] = useState(() => {
    if (typeof window === "undefined") return 42;
    try { const s = localStorage.getItem("gm_inspector_layout"); if (s) return JSON.parse(s).descPct ?? 42; } catch {}
    return 42;
  });
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Reset lightbox when game changes
  useEffect(() => { setLightboxIdx(null); }, [data.name, data.appid]);

  const mediaItems: MediaItem[] = useMemo(() => {
    const items: MediaItem[] = data.screenshots.map((src, i) => ({ type: "image" as const, src, fullSrc: data.fullScreenshots[i] || src }));
    for (const m of data.movies) items.push({ type: "video", src: m.thumbnail, videoUrl: m.video_url, label: m.name });
    return items;
  }, [data.screenshots, data.fullScreenshots, data.movies]);

  const handleColDrag = useCallback((d: number) => {
    setLeftW((pct: number) => Math.max(25, Math.min(55, pct + (d / popupSize.w) * 100)));
  }, [popupSize.w]);

  const rightColRef = useRef<HTMLDivElement>(null);
  const handleDescDrag = useCallback((d: number) => {
    const h = rightColRef.current?.clientHeight || 500;
    setDescPct((pct: number) => Math.max(20, Math.min(65, pct + (d / h) * 100)));
  }, []);

  // Persist layout on mouseup
  const leftWRef = useRef(leftW);
  leftWRef.current = leftW;
  const descPctRef = useRef(descPct);
  descPctRef.current = descPct;
  useEffect(() => {
    const save = () => { localStorage.setItem("gm_inspector_layout", JSON.stringify({ leftW: leftWRef.current, descPct: descPctRef.current })); };
    window.addEventListener("mouseup", save);
    return () => window.removeEventListener("mouseup", save);
  }, []);

  const resetLayout = useCallback(() => {
    const dw = 880, dh = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.88) : 700;
    setPopupSize({ w: dw, h: dh }); setLeftW(38); setDescPct(42);
    localStorage.removeItem("gm_inspector_size");
    localStorage.removeItem("gm_inspector_layout");
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const reviewColor = data.positivePercent >= 70 ? "#22c55e" : data.positivePercent >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-lg overflow-hidden flex flex-col relative"
        style={{ width: popupSize.w, height: popupSize.h }}
        onClick={(e) => e.stopPropagation()}>

        {/* Resize handle */}
        <div onMouseDown={onResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20 opacity-30 hover:opacity-70"
          style={{ background: "linear-gradient(135deg, transparent 50%, currentColor 50%)" }} />

        {/* Title bar */}
        <div className="h-[44px] shrink-0 flex items-center px-4 border-b border-border gap-3">
          <h2 className="text-sm font-semibold truncate flex-1">{data.name}</h2>
          <button onClick={onClose}
            className="w-6 h-6 rounded-full bg-surface2 text-muted flex items-center justify-center text-sm hover:bg-danger/20 hover:text-danger shrink-0"
          >{"\u00D7"}</button>
        </div>

        {/* Two-column body */}
        <div className="flex-1 min-h-0 flex">
          {/* LEFT — header image + media grid */}
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: `${leftW}%` }}>
            <div className="shrink-0 bg-surface2 overflow-hidden" style={{ aspectRatio: "460/215" }}>
              {data.headerImg ? (
                <img key={`${data.headerImg}_${data.refreshKey || 0}`} src={data.headerImg} alt={data.name} className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : <div className="w-full h-full flex items-center justify-center text-muted text-xs">No image</div>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {data.loading ? <span className="text-[10px] text-muted animate-pulse p-2">Loading...</span> : mediaItems.length > 0 ? (
                <>
                {(data.totalScreenshots || data.totalMovies) ? (
                  <div className="text-[9px] text-muted mb-1 px-0.5">
                    {data.totalScreenshots ? `${data.screenshots.length}/${data.totalScreenshots} screenshots` : ""}
                    {data.totalScreenshots && data.totalMovies ? " · " : ""}
                    {data.totalMovies ? `${data.movies.length}/${data.totalMovies} videos` : ""}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                  {mediaItems.map((item, i) => (
                    <div key={i} className={`relative cursor-pointer group rounded overflow-hidden ${item.type === "video" ? "ring-1 ring-purple-500/40" : ""}`} style={{ aspectRatio: "16/9" }}
                      onClick={() => setLightboxIdx(i)}>
                      <img src={item.src} alt={item.type === "video" ? (item.label || "Video") : `Screenshot ${i + 1}`}
                        className="w-full h-full object-cover group-hover:ring-2 group-hover:ring-accent/50 transition-all"
                        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }} />
                      {item.type === "video" && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                          <div className="w-8 h-8 rounded-full bg-purple-600/80 flex items-center justify-center shadow-lg">
                            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                </>
              ) : <span className="text-[10px] text-muted p-2">No screenshots</span>}
            </div>
          </div>

          <VDragHandle onDrag={handleColDrag} />

          {/* RIGHT — description + details, then tags */}
          <div ref={rightColRef} className="flex-1 min-w-0 flex flex-col min-h-0 relative">
            {/* Tint overlay on right column only */}
            {tintBg && <div className="absolute inset-0 z-0 pointer-events-none" style={{ backgroundColor: tintBg }} />}
            {/* Description + details (resizable top section) */}
            <div className="shrink-0 flex flex-col overflow-hidden relative z-[1]" style={{ height: `${descPct}%` }}>
              <div className="flex-1 min-h-0 px-4 py-2.5 overflow-y-auto">
                {data.description ? (
                  <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-line">{data.description}</p>
                ) : <p className="text-xs text-muted italic">No description</p>}
              </div>
              <div className="shrink-0 px-4 py-1.5 border-t border-border/30 text-[10px] space-y-1 text-center">
                <div className="grid grid-cols-5 gap-x-3">
                  <div className="flex flex-col items-center"><span className="text-muted">Score</span><span style={{ color: reviewColor }}>{data.positivePercent > 0 ? `${data.positivePercent}%` : "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Reviews</span><span>{data.totalReviews > 0 ? data.totalReviews.toLocaleString() : "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">MC</span><span className={data.metacriticScore > 0 ? "text-green-400" : ""}>{data.metacriticScore > 0 ? data.metacriticScore : "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">SDB</span><span style={{ color: reviewColor }}>{data.totalReviews > 0 ? steamDbScore(data.positivePercent, data.totalReviews) : "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Sentiment</span><span className="truncate" style={{ color: reviewColor }}>{data.reviewSentiment || "\u2014"}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-x-3">
                  <div className="flex flex-col items-center"><span className="text-muted">AppID</span><span>{data.appid || "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Publisher</span><span className="truncate max-w-full">{data.publishers || "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Developer</span><span className="truncate max-w-full">{data.developers || "\u2014"}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-x-3">
                  <div className="flex flex-col items-center"><span className="text-muted">Release</span><span>{data.releaseDate || "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Added</span><span>{data.addedAt ? formatDate(data.addedAt) : "\u2014"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Wishlisted</span><span>{data.wishlistDate ? formatDate(data.wishlistDate) : "\u2014"}</span></div>
                </div>
              </div>
            </div>

            <HDragHandle onDrag={handleDescDrag} />

            {/* Tags 2x2 */}
            <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 overflow-hidden relative z-[1]">
              <div className="px-3 py-2 overflow-y-auto border-r border-b border-border/30">{tagsSlot}</div>
              <div className="px-3 py-2 overflow-y-auto border-b border-border/30">
                <span className="text-[10px] text-muted block mb-1">Genres</span>
                <TagPills items={data.genres} color="#60a5fa" onFilter={onGenreFilter} />
              </div>
              <div className="px-3 py-2 overflow-y-auto border-r border-border/30">
                <span className="text-[10px] text-muted block mb-1">Community Tags</span>
                <TagPills items={data.communityTags} color="#a78bfa" onFilter={onCommunityTagFilter} />
              </div>
              <div className="px-3 py-2 overflow-y-auto">
                <span className="text-[10px] text-muted block mb-1">Features</span>
                <TagPills items={data.features} color="#2dd4bf" onFilter={onFeatureFilter} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-[40px] shrink-0 flex items-center px-4 gap-2 border-t border-border">
          <button onClick={resetLayout} className="text-[10px] text-muted hover:text-accent" title="Reset layout">⟲ Reset</button>
          {footerSlot}
        </div>
      </div>
    </div>
    {lightboxIdx !== null && <Lightbox items={mediaItems} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />}
    </>
  );
});

// Main Inspector for DB games
export default function Inspector({ game, onClose, onEdit, onDelete, tags, onUpdate, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude, onGenreFilter, onFeatureFilter, onCommunityTagFilter, colorCoded, scoreSource, tintColors }: InspectorProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Cache disk counts per asset id to avoid re-fetching on every navigation
  const diskCacheRef = useRef<Map<string, { screenshots: number; hdScreenshots: number; movies: number }>>(new Map());
  const [diskCounts, setDiskCounts] = useState<{ screenshots: number; hdScreenshots: number; movies: number } | null>(null);

  const aid = inspectorAssetId(game);

  useEffect(() => {
    const cached = diskCacheRef.current.get(aid);
    if (cached) { setDiskCounts(cached); return; }
    // Don't null out — keep previous counts while loading to avoid flicker
    let cancelled = false;
    fetch(`/api/assets/${aid}/list`).then((r) => r.json()).then((d) => {
      if (cancelled) return;
      diskCacheRef.current.set(aid, d);
      setDiskCounts(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [aid, refreshKey]);

  const handleRefreshMeta = useCallback(async () => {
    if (!game.steam_appid) return;
    setRefreshing(true);
    try {
      await fetch(`/api/games/${game.id}/fetch-metadata`, { method: "POST" });
      if (onUpdate) await onUpdate(game.id, {});
      diskCacheRef.current.delete(aid); // bust cache
      setRefreshKey((k) => k + 1);
    } catch {}
    setRefreshing(false);
  }, [game.steam_appid, game.id, onUpdate, aid]);

  // Use disk counts when available, fall back to DB
  const ssCount = diskCounts ? diskCounts.screenshots : (() => { try { return JSON.parse(game.screenshots || "[]").length; } catch { return 0; } })();
  const hdCount = diskCounts ? diskCounts.hdScreenshots : ssCount;
  const movCount = diskCounts ? diskCounts.movies : (() => { try { return JSON.parse(game.movies || "[]").length; } catch { return 0; } })();

  const screenshots = useMemo(() => Array.from({ length: ssCount }, (_, i) => `/api/assets/${aid}/ss_${i}.jpg`), [ssCount, aid]);
  const fullScreenshots = useMemo(() => Array.from({ length: hdCount }, (_, i) => `/api/assets/${aid}/ss_${i}_hd.jpg`), [hdCount, aid]);

  // Movies: use DB metadata for names/video_urls, but show up to disk count
  const dbMovies = useMemo(() => getMovies(game), [game.id, game.movies]); // eslint-disable-line react-hooks/exhaustive-deps
  const movies = useMemo(() => Array.from({ length: movCount }, (_, i) => ({
    name: dbMovies[i]?.name || `Trailer ${i + 1}`,
    thumbnail: `/api/assets/${aid}/movie_${i}.jpg`,
    video_url: dbMovies[i]?.video_url || "",
  })), [movCount, aid, dbMovies]);

  const genres = useMemo(() => safeJsonParse(game.steam_genres), [game.steam_genres]);
  const features = useMemo(() => safeJsonParse(game.steam_features), [game.steam_features]);
  const communityTags = useMemo(() => safeJsonParse(game.community_tags), [game.community_tags]);

  const data: LayoutData = useMemo(() => ({
    name: game.name, appid: game.steam_appid,
    headerImg: `/api/assets/${aid}/header.jpg`,
    description: game.description,
    genres, features, communityTags,
    developers: game.developers, publishers: game.publishers,
    releaseDate: game.release_date, wishlistDate: game.wishlist_date, addedAt: game.added_at,
    positivePercent: game.positive_percent, totalReviews: game.total_reviews, metacriticScore: game.metacritic_score,
    reviewSentiment: game.review_sentiment || "",
    screenshots, fullScreenshots, movies,
    totalScreenshots: game.total_screenshots || 0, totalMovies: game.total_movies || 0, notes: game.notes,
    refreshKey,
  }), [game.id, game.name, game.steam_appid, game.description, genres, features, communityTags, // eslint-disable-line react-hooks/exhaustive-deps
    game.developers, game.publishers, game.release_date, game.wishlist_date, game.added_at,
    game.positive_percent, game.total_reviews, game.metacritic_score, game.review_sentiment,
    screenshots, fullScreenshots, movies, game.total_screenshots, game.total_movies, game.notes, aid, refreshKey, game.updated_at]);

  const tagsSlot = useMemo(() => <TagDisplay game={game} onTagInclude={onTagInclude} onTagExclude={onTagExclude}
    onSubtagInclude={onSubtagInclude} onSubtagExclude={onSubtagExclude} />,
    [game, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude]);

  const handleEdit = useCallback(() => onEdit(game), [onEdit, game]);
  const handleDelete = useCallback(() => { if (confirm("Delete this game?")) { onDelete(game.id); onClose(); } }, [onDelete, onClose, game.id]);

  const footerSlot = useMemo(() => (
    <>
      {game.notes && <span className="text-[10px] text-muted truncate max-w-[200px]" title={game.notes}>{"\uD83D\uDCDD"} {game.notes}</span>}
      {game.steam_appid && (
        <>
          <a href={`https://store.steampowered.com/app/${game.steam_appid}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Steam {"\u2197"}</a>
          <button onClick={handleRefreshMeta} disabled={refreshing} className="text-[10px] text-muted hover:text-accent disabled:animate-spin" title="Refresh metadata">{"\u21BB"}</button>
        </>
      )}
      <div className="flex-1" />
      <button onClick={handleEdit} className="text-xs px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25">Edit</button>
      <button onClick={handleDelete}
        className="text-xs px-3 py-1 rounded bg-danger/15 text-danger hover:bg-danger/25">Delete</button>
    </>
  ), [game.notes, game.steam_appid, game.id, refreshing, handleRefreshMeta, handleEdit, handleDelete]);

  // For inspector, use a more opaque tint so it's not too transparent
  const inspectorTint = useMemo(() => {
    if (!colorCoded || !tintColors) return undefined;
    return getScoreTint(game, scoreSource || "steamdb", { ...tintColors, opacity: Math.min(tintColors.opacity * 2.5, 0.35) });
  }, [colorCoded, tintColors, game.positive_percent, game.total_reviews, scoreSource]);

  return <InspectorLayout data={data} onClose={onClose} tagsSlot={tagsSlot} footerSlot={footerSlot}
    tintBg={inspectorTint}
    onGenreFilter={onGenreFilter} onFeatureFilter={onFeatureFilter} onCommunityTagFilter={onCommunityTagFilter} />;
}

// Steam preview
export function SteamPreview({ appid, name, image, onClose, onAdd, adding }: SteamPreviewProps) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [communityTags, setCommunityTags] = useState<string[]>([]);
  const [reviewData, setReviewData] = useState<{ positivePercent: number; totalReviews: number }>({ positivePercent: 0, totalReviews: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/steam/details?appid=${appid}`).then((r) => r.json()),
      fetch(`/api/steam/community-tags?appid=${appid}`).then((r) => r.json()).catch(() => []),
      fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`)
        .then((r) => r.json()).catch(() => null),
    ]).then(([d, ct, rev]) => {
      setDetails(d);
      setCommunityTags(Array.isArray(ct) ? ct : []);
      if (rev?.query_summary) {
        const qs = rev.query_summary;
        const total = (qs.total_positive || 0) + (qs.total_negative || 0);
        setReviewData({ positivePercent: total > 0 ? Math.round((qs.total_positive / total) * 100) : 0, totalReviews: total });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [appid]);

  const d = details as Record<string, unknown> | null;
  const ssRaw = ((d?.screenshots as { path_thumbnail: string; path_full: string }[]) || []).slice(0, 8);

  const data: LayoutData = {
    name, appid,
    headerImg: image || `/api/assets/${appid}/header.jpg`,
    description: loading ? "Loading details from Steam..." : ((d?.short_description as string) || ""),
    genres: ((d?.genres as { description: string }[]) || []).map((g) => g.description),
    features: ((d?.categories as { description: string }[]) || []).map((c) => c.description),
    communityTags,
    developers: ((d?.developers as string[]) || []).join(", "),
    publishers: ((d?.publishers as string[]) || []).join(", "),
    releaseDate: (d?.release_date as { date?: string })?.date || "",
    positivePercent: reviewData.positivePercent, totalReviews: reviewData.totalReviews,
    reviewSentiment: "",
    metacriticScore: (d?.metacritic as { score?: number })?.score || 0,
    screenshots: ssRaw.map((s) => s.path_thumbnail), fullScreenshots: ssRaw.map((s) => s.path_full),
    movies: [], loading,
  };

  const footerSlot = (
    <>
      <a href={`https://store.steampowered.com/app/${appid}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Steam {"\u2197"}</a>
      <div className="flex-1" />
      <button onClick={() => onAdd()} disabled={adding}
        className="text-xs px-3 py-1 rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50">
        {adding ? "Adding..." : "+ Add to Library"}
      </button>
    </>
  );

  return <InspectorLayout data={data} onClose={onClose} footerSlot={footerSlot} />;
}
