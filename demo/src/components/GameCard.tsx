"use client";

import { useState, useEffect, useRef } from "react";
import { GameWithTags, steamDbScore, TintColors, getScoreTint, getPrimaryScore, scoreColor } from "@/lib/types";
import { headerUrl, parseScreenshots } from "@/lib/steam-cdn";

function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; } catch { return []; }
}

interface Props {
  game: GameWithTags;
  selected: boolean;
  slideshow?: boolean;
  slideDelay?: number;
  pageFocused?: boolean;
  genresCount?: number;
  communityTagsCount?: number;
  onClick: () => void;
  onTagInclude?: (tagId: number) => void;
  onTagExclude?: (tagId: number) => void;
  onSubtagInclude?: (subtagId: number) => void;
  onSubtagExclude?: (subtagId: number) => void;
  onGenreFilter?: (name: string, mode: "include" | "exclude") => void;
  onCommunityTagFilter?: (name: string, mode: "include" | "exclude") => void;
  colorCoded?: boolean;
  scoreSource?: "steam" | "steamdb";
  tintColors?: TintColors | null;
}

export default function GameCard({ game, selected, slideshow, slideDelay = 1000, pageFocused = true, genresCount = 3, communityTagsCount = 4, onClick, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude, onGenreFilter, onCommunityTagFilter, colorCoded, scoreSource = "steamdb", tintColors }: Props) {
  const [imgState, setImgState] = useState<"loading" | "loaded" | "error">("loading");
  const [hovered, setHovered] = useState(false);
  const [ssIdx, setSsIdx] = useState(-1);
  const [failedSs, setFailedSs] = useState<Set<number>>(new Set());
  const [loadedSs, setLoadedSs] = useState<Set<number>>(new Set());
  const [bump, setBump] = useState(0);
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const hdr = headerUrl(game.steam_appid);
  const genres = safeJsonParse(game.steam_genres).slice(0, genresCount);
  const ssData = parseScreenshots(game.screenshots);
  const screenshots = ssData.map(s => s.thumb);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const validIndices = screenshots.map((_, i) => i).filter((i) => !failedSs.has(i));
  const validRef = useRef(validIndices);
  validRef.current = validIndices;
  const ssIdxRef = useRef(ssIdx);
  ssIdxRef.current = ssIdx;

  useEffect(() => {
    const active = ((slideshow && visible && pageFocused) || hovered);
    const vi = validRef.current;
    if (!active || vi.length === 0) { setSsIdx(-1); return; }
    const curPos = vi.indexOf(ssIdxRef.current);
    const startPos = curPos >= 0 ? (curPos + 1) % vi.length : 0;
    setSsIdx(vi[startPos]);
    let pos = startPos;
    const interval = setInterval(() => {
      const cur = validRef.current;
      if (cur.length === 0) return;
      pos = (pos + 1) % cur.length;
      setSsIdx(cur[pos]);
    }, slideDelay);
    return () => clearInterval(interval);
  }, [hovered, slideshow, visible, pageFocused, validIndices.length, bump, slideDelay]);

  const tintBg = colorCoded ? getScoreTint(game, scoreSource, tintColors || null) : undefined;
  const primaryScore = getPrimaryScore(game, scoreSource);

  return (
    <div ref={cardRef} onClick={onClick} data-game-id={game.id}
      onMouseEnter={() => { setHovered(true); if (slideshow) setBump((b) => b + 1); }}
      onMouseLeave={() => setHovered(false)}
      className={`bg-surface rounded-lg overflow-hidden border-2 cursor-pointer transition-all hover:border-accent/50 ${selected ? "border-accent ring-2 ring-accent/40 shadow-[0_0_12px_rgba(99,102,241,0.3)]" : "border-border/50"}`}
      style={tintBg ? { backgroundColor: tintBg } : undefined}>
      <div className="relative aspect-[460/215] bg-surface2 overflow-hidden">
        {hdr ? (<>
          {imgState === "loading" && (<div className="absolute inset-0 bg-surface2 animate-pulse"><div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent shimmer-sweep" /></div>)}
          {imgState === "error" && (<div className="absolute inset-0 flex items-center justify-center text-muted text-xs">No image</div>)}
          <img src={hdr} alt={game.name}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imgState === "loaded" ? (ssIdx >= 0 && loadedSs.has(ssIdx) ? "opacity-0" : "opacity-100") : "opacity-0"}`}
            loading="lazy" onLoad={() => setImgState("loaded")} onError={() => setImgState("error")} />
          {ssIdx >= 0 && screenshots.map((src, i) => (
            <img key={i} src={src} alt=""
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${ssIdx === i && loadedSs.has(i) ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setLoadedSs((prev) => new Set(prev).add(i))}
              onError={() => setFailedSs((prev) => new Set(prev).add(i))} />
          ))}
        </>) : (<div className="w-full h-full flex items-center justify-center text-muted text-xs">No image</div>)}
        {primaryScore > 0 && (
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold"
            style={{ backgroundColor: "rgba(0,0,0,0.75)", color: scoreColor(primaryScore, tintColors || null) }}>
            {primaryScore}{scoreSource === "steam" ? "%" : ""}
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1">
          <h3 className="text-xs font-medium truncate flex-1" title={game.name}>{game.name}</h3>
          {game.review_sentiment && (<span className="text-[8px] shrink-0" style={{ color: scoreColor(primaryScore, tintColors || null) }}>{game.review_sentiment}</span>)}
        </div>
        <div className="flex items-center gap-1">
          {game.steam_appid && <span className="text-[8px] text-muted/50">{game.steam_appid}</span>}
          <span className="flex-1" />
          {primaryScore > 0 && (() => {
            const secondary = scoreSource === "steamdb" ? game.positive_percent : (game.total_reviews > 0 ? steamDbScore(game.positive_percent, game.total_reviews) : 0);
            const secLabel = scoreSource === "steamdb" ? `${secondary}%` : `SDB:${secondary}`;
            return secondary > 0 ? <span className="text-[8px] text-muted/60 shrink-0">{secLabel}</span> : null;
          })()}
        </div>

        {game.tags && game.tags.length > 0 && (() => {
          const grouped = new Map<number, { tag_name: string; tag_color: string; tag_id: number; subs: typeof game.tags }>();
          for (const gt of game.tags) {
            if (!grouped.has(gt.tag_id)) grouped.set(gt.tag_id, { tag_name: gt.tag_name, tag_color: gt.tag_color, tag_id: gt.tag_id, subs: [] });
            grouped.get(gt.tag_id)!.subs.push(gt);
          }
          return (
            <div className="flex flex-wrap gap-1 mt-1">
              {Array.from(grouped.values()).map((g) => (
                <div key={g.tag_id} className="flex items-center gap-0.5 rounded px-1 py-0.5"
                  style={{ backgroundColor: g.tag_color + "12", border: `1px solid ${g.tag_color}30` }}>
                  <span className="text-[9px] font-medium cursor-pointer hover:underline" style={{ color: g.tag_color }}
                    title="Click=include, Right-click=exclude"
                    onClick={(e) => { e.stopPropagation(); onTagInclude?.(g.tag_id); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTagExclude?.(g.tag_id); }}
                  >{g.tag_name}</span>
                  {g.subs.some((s) => s.subtag_name) && (<>
                    <span className="text-[8px] text-muted">›</span>
                    {g.subs.filter((s) => s.subtag_name).map((s) => (
                      <span key={s.id} className="px-0.5 rounded text-[8px] cursor-pointer hover:ring-1 hover:ring-current"
                        style={{ backgroundColor: s.subtag_type === "meta" ? "#f59e0b18" : "#818cf818", color: s.subtag_type === "meta" ? "#f59e0b" : "#818cf8" }}
                        title="Click=include, Right-click=exclude"
                        onClick={(e) => { e.stopPropagation(); onSubtagInclude?.(s.subtag_id!); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSubtagExclude?.(s.subtag_id!); }}
                      >{s.subtag_name}</span>
                    ))}
                  </>)}
                </div>
              ))}
            </div>
          );
        })()}
        {(genres.length > 0 || game.metacritic_score > 0) && (
          <div className="flex items-center gap-1 mt-1">
            {genres.length > 0 && (
              <span className="text-[9px] text-muted truncate flex-1">
                {genres.map((g, i) => (
                  <span key={`${g}-${i}`}>{i > 0 && " · "}
                    <span className="cursor-pointer hover:text-teal-400 hover:underline"
                      title={`${g} · Click=include, Right-click=exclude`}
                      onClick={(e) => { e.stopPropagation(); onGenreFilter?.(g, "include"); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onGenreFilter?.(g, "exclude"); }}
                    >{g}</span>
                  </span>
                ))}
              </span>
            )}
            {game.metacritic_score > 0 && (
              <span className="text-[9px] font-bold px-1 rounded shrink-0" style={{
                backgroundColor: game.metacritic_score >= 75 ? "#22c55e20" : game.metacritic_score >= 50 ? "#f59e0b20" : "#ef444420",
                color: game.metacritic_score >= 75 ? "#22c55e" : game.metacritic_score >= 50 ? "#f59e0b" : "#ef4444",
              }}>{game.metacritic_score}</span>
            )}
          </div>
        )}
        {(() => {
          const ctags = safeJsonParse(game.community_tags);
          if (ctags.length === 0) return null;
          const show = ctags.slice(0, communityTagsCount);
          const extra = ctags.length - show.length;
          return (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {show.map((t, i) => (
                <span key={`${t}-${i}`} className="px-1 py-px rounded text-[8px] bg-white/5 text-muted/80 cursor-pointer hover:bg-white/10 hover:text-indigo-300"
                  title={`${t} · Click=include, Right-click=exclude`}
                  onClick={(e) => { e.stopPropagation(); onCommunityTagFilter?.(t, "include"); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCommunityTagFilter?.(t, "exclude"); }}
                >{t}</span>
              ))}
              {extra > 0 && <span className="text-[8px] text-muted/50 px-0.5">+{extra}</span>}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
