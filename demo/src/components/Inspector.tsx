"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { GameWithTags, Tag, steamDbScore, TintColors, getScoreTint } from "@/lib/types";
import { headerUrl, parseScreenshots, parseMovies } from "@/lib/steam-cdn";
import Lightbox, { MediaItem } from "./Lightbox";

function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; } catch { return []; }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso || ""; }
}

interface InspectorProps {
  game: GameWithTags;
  onClose: () => void;
  tags: Tag[];
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

function HDragHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastY = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); dragging.current = true; lastY.current = e.clientY;
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
    e.preventDefault(); dragging.current = true; lastX.current = e.clientX;
    const onMouseMove = (ev: MouseEvent) => { if (!dragging.current) return; onDrag(ev.clientX - lastX.current); lastX.current = ev.clientX; };
    const onMouseUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
    window.addEventListener("mousemove", onMouseMove); window.addEventListener("mouseup", onMouseUp);
  }, [onDrag]);
  return <div onMouseDown={onMouseDown} className="w-[5px] shrink-0 cursor-col-resize hover:bg-accent/50 active:bg-accent/60 transition-colors bg-border/30 self-stretch" />;
}

function TagPills({ items, color, onFilter }: { items: string[]; color: string; onFilter?: (name: string, mode: "include" | "exclude") => void }) {
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

export default function Inspector({ game, onClose, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude, onGenreFilter, onFeatureFilter, onCommunityTagFilter, colorCoded, scoreSource = "steamdb", tintColors }: InspectorProps) {
  const [popupSize, setPopupSize] = useState(() => {
    if (typeof window === "undefined") return { w: 880, h: 700 };
    try { const s = localStorage.getItem("gm_inspector_size"); if (s) return JSON.parse(s); } catch {}
    return { w: 880, h: Math.round(window.innerHeight * 0.88) };
  });
  const resizing = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { startX: e.clientX, startY: e.clientY, startW: popupSize.w, startH: popupSize.h };
    const onMove = (ev: MouseEvent) => { if (!resizing.current) return; setPopupSize({ w: Math.max(600, resizing.current.startW + (ev.clientX - resizing.current.startX) * 2), h: Math.max(400, resizing.current.startH + (ev.clientY - resizing.current.startY) * 2) }); };
    const onUp = () => { resizing.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); setPopupSize((s: { w: number; h: number }) => { localStorage.setItem("gm_inspector_size", JSON.stringify(s)); return s; }); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [popupSize]);

  const [leftW, setLeftW] = useState(38);
  const [descPct, setDescPct] = useState(42);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const prevGameId = useRef(game.id);
  if (prevGameId.current !== game.id) { prevGameId.current = game.id; if (lightboxIdx !== null) setLightboxIdx(null); }

  const genres = useMemo(() => safeJsonParse(game.steam_genres), [game.steam_genres]);
  const features = useMemo(() => safeJsonParse(game.steam_features), [game.steam_features]);
  const communityTags = useMemo(() => safeJsonParse(game.community_tags), [game.community_tags]);

  const hdr = headerUrl(game.steam_appid);
  const ssData = useMemo(() => parseScreenshots(game.screenshots), [game.screenshots]);
  const screenshots = useMemo(() => ssData.map(s => s.thumb), [ssData]);
  const fullScreenshots = useMemo(() => ssData.map(s => s.hd), [ssData]);

  const movies = useMemo(() => parseMovies(game.movies), [game.movies]);
  const movCount = game.total_movies || movies.length;

  const mediaItems: MediaItem[] = useMemo(() => {
    const items: MediaItem[] = screenshots.map((src, i) => ({ type: "image" as const, src, fullSrc: fullScreenshots[i] || src }));
    for (const m of movies) items.push({ type: "video", src: m.thumbnail, videoUrl: m.videoUrl, label: m.name });
    return items;
  }, [screenshots, fullScreenshots, movies]);

  const handleColDrag = useCallback((d: number) => { setLeftW((pct) => Math.max(25, Math.min(55, pct + (d / popupSize.w) * 100))); }, [popupSize.w]);
  const rightColRef = useRef<HTMLDivElement>(null);
  const handleDescDrag = useCallback((d: number) => { const h = rightColRef.current?.clientHeight || 500; setDescPct((pct) => Math.max(20, Math.min(65, pct + (d / h) * 100))); }, []);

  const resetLayout = useCallback(() => {
    const dh = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.88) : 700;
    setPopupSize({ w: 880, h: dh }); setLeftW(38); setDescPct(42);
    localStorage.removeItem("gm_inspector_size");
  }, []);

  const reviewColor = game.positive_percent >= 70 ? "#22c55e" : game.positive_percent >= 40 ? "#f59e0b" : "#ef4444";
  const tintBg = useMemo(() => {
    if (!colorCoded || !tintColors) return undefined;
    return getScoreTint(game, scoreSource, { ...tintColors, opacity: Math.min(tintColors.opacity * 2.5, 0.35) });
  }, [colorCoded, tintColors, game.positive_percent, game.total_reviews, scoreSource]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-lg overflow-hidden flex flex-col relative"
        style={{ width: popupSize.w, height: popupSize.h }} onClick={(e) => e.stopPropagation()}>
        <div onMouseDown={onResizeStart} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20 opacity-30 hover:opacity-70" style={{ background: "linear-gradient(135deg, transparent 50%, currentColor 50%)" }} />
        <div className="h-[44px] shrink-0 flex items-center px-4 border-b border-border gap-3">
          <h2 className="text-sm font-semibold truncate flex-1">{game.name}</h2>
          <button onClick={onClose} className="w-6 h-6 rounded-full bg-surface2 text-muted flex items-center justify-center text-sm hover:bg-danger/20 hover:text-danger shrink-0">×</button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: `${leftW}%` }}>
            <div className="shrink-0 bg-surface2 overflow-hidden" style={{ aspectRatio: "460/215" }}>
              {hdr ? <img src={hdr} alt={game.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <div className="w-full h-full flex items-center justify-center text-muted text-xs">No image</div>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {mediaItems.length > 0 ? (<>
                {(game.total_screenshots || game.total_movies) ? (
                  <div className="text-[9px] text-muted mb-1 px-0.5">
                    {game.total_screenshots ? `${screenshots.length} screenshots` : ""}
                    {game.total_screenshots && game.total_movies ? " · " : ""}
                    {game.total_movies ? `${movies.length} videos` : ""}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                  {mediaItems.map((item, i) => (
                    <div key={i} className={`relative cursor-pointer group rounded overflow-hidden ${item.type === "video" ? "ring-1 ring-purple-500/40" : ""}`} style={{ aspectRatio: "16/9" }} onClick={() => setLightboxIdx(i)}>
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
              </>) : <span className="text-[10px] text-muted p-2">No screenshots</span>}
            </div>
          </div>
          <VDragHandle onDrag={handleColDrag} />
          <div ref={rightColRef} className="flex-1 min-w-0 flex flex-col min-h-0 relative">
            {tintBg && <div className="absolute inset-0 z-0 pointer-events-none" style={{ backgroundColor: tintBg }} />}
            <div className="shrink-0 flex flex-col overflow-hidden relative z-[1]" style={{ height: `${descPct}%` }}>
              <div className="flex-1 min-h-0 px-4 py-2.5 overflow-y-auto">
                {game.description ? <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-line">{game.description}</p> : <p className="text-xs text-muted italic">No description</p>}
              </div>
              <div className="shrink-0 px-4 py-1.5 border-t border-border/30 text-[10px] space-y-1 text-center">
                <div className="grid grid-cols-5 gap-x-3">
                  <div className="flex flex-col items-center"><span className="text-muted">Score</span><span style={{ color: reviewColor }}>{game.positive_percent > 0 ? `${game.positive_percent}%` : "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Reviews</span><span>{game.total_reviews > 0 ? game.total_reviews.toLocaleString() : "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">MC</span><span className={game.metacritic_score > 0 ? "text-green-400" : ""}>{game.metacritic_score > 0 ? game.metacritic_score : "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">SDB</span><span style={{ color: reviewColor }}>{game.total_reviews > 0 ? steamDbScore(game.positive_percent, game.total_reviews) : "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Sentiment</span><span className="truncate" style={{ color: reviewColor }}>{game.review_sentiment || "—"}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-x-3">
                  <div className="flex flex-col items-center"><span className="text-muted">AppID</span><span>{game.steam_appid || "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Publisher</span><span className="truncate max-w-full">{game.publishers || "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Developer</span><span className="truncate max-w-full">{game.developers || "—"}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-x-3">
                  <div className="flex flex-col items-center"><span className="text-muted">Release</span><span>{game.release_date || "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Added</span><span>{game.added_at ? formatDate(game.added_at) : "—"}</span></div>
                  <div className="flex flex-col items-center"><span className="text-muted">Wishlisted</span><span>{game.wishlist_date ? formatDate(game.wishlist_date) : "—"}</span></div>
                </div>
              </div>
            </div>
            <HDragHandle onDrag={handleDescDrag} />

            <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 overflow-hidden relative z-[1]">
              <div className="px-3 py-2 overflow-y-auto border-r border-b border-border/30">
                <span className="text-[10px] text-muted block mb-1">Your Tags</span>
                <div className="flex flex-wrap gap-1">
                  {game.tags && game.tags.length > 0 ? (() => {
                    const grouped = new Map<number, { tag_name: string; tag_color: string; tag_id: number; subs: typeof game.tags }>();
                    for (const t of game.tags) { if (!grouped.has(t.tag_id)) grouped.set(t.tag_id, { tag_name: t.tag_name, tag_color: t.tag_color, tag_id: t.tag_id, subs: [] }); grouped.get(t.tag_id)!.subs.push(t); }
                    return Array.from(grouped.values()).map((g) => (
                      <div key={g.tag_id} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5" style={{ backgroundColor: g.tag_color + "12", border: `1px solid ${g.tag_color}30` }}>
                        <span className="text-[10px] font-medium cursor-pointer hover:underline" style={{ color: g.tag_color }}
                          title="Click=include, Right-click=exclude"
                          onClick={() => onTagInclude?.(g.tag_id)} onContextMenu={(e) => { e.preventDefault(); onTagExclude?.(g.tag_id); }}
                        >{g.tag_name}</span>
                        {g.subs.some((s) => s.subtag_name) && (<>
                          <span className="text-[9px] text-muted">›</span>
                          {g.subs.filter((s) => s.subtag_name).map((s) => (
                            <span key={s.id} className="text-[10px] px-0.5 rounded cursor-pointer hover:ring-1 hover:ring-current"
                              style={{ backgroundColor: s.subtag_type === "meta" ? "#f59e0b18" : "#818cf818", color: s.subtag_type === "meta" ? "#f59e0b" : "#818cf8" }}
                              onClick={() => s.subtag_id && onSubtagInclude?.(s.subtag_id)} onContextMenu={(e) => { e.preventDefault(); s.subtag_id && onSubtagExclude?.(s.subtag_id); }}
                            >{s.subtag_name}</span>
                          ))}
                        </>)}
                      </div>
                    ));
                  })() : <span className="text-[10px] text-muted italic">No tags</span>}
                </div>
              </div>
              <div className="px-3 py-2 overflow-y-auto border-b border-border/30">
                <span className="text-[10px] text-muted block mb-1">Genres</span>
                <TagPills items={genres} color="#60a5fa" onFilter={onGenreFilter} />
              </div>
              <div className="px-3 py-2 overflow-y-auto border-r border-border/30">
                <span className="text-[10px] text-muted block mb-1">Community Tags</span>
                <TagPills items={communityTags} color="#a78bfa" onFilter={onCommunityTagFilter} />
              </div>
              <div className="px-3 py-2 overflow-y-auto">
                <span className="text-[10px] text-muted block mb-1">Features</span>
                <TagPills items={features} color="#2dd4bf" onFilter={onFeatureFilter} />
              </div>
            </div>
          </div>
        </div>
        <div className="h-[40px] shrink-0 flex items-center px-4 gap-2 border-t border-border">
          <button onClick={resetLayout} className="text-[10px] text-muted hover:text-accent" title="Reset layout">⟲ Reset</button>
          {game.notes && <span className="text-[10px] text-muted truncate max-w-[200px]" title={game.notes}>📝 {game.notes}</span>}
          {game.steam_appid && <a href={`https://store.steampowered.com/app/${game.steam_appid}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Steam ↗</a>}
          <div className="flex-1" />
          <span className="text-[10px] text-muted italic">Read-only demo</span>
        </div>
      </div>
    </div>
    {lightboxIdx !== null && <Lightbox items={mediaItems} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />}
    </>
  );
}
