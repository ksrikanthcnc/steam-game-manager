"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { GameWithTags, Tag, steamDbScore, TintColors, getScoreTint } from "@/lib/types";
import { headerUrl, parseScreenshots } from "@/lib/steam-cdn";

function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; } catch { return []; }
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

type SortDir = "asc" | "desc";
interface SortEntry { key: string; dir: SortDir }

interface ColumnDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  locked?: boolean; // width driven by rowHeight, no resize
  sortable?: boolean;
  getValue?: (game: GameWithTags) => string | number;
}

interface Props {
  games: GameWithTags[];
  tags: Tag[];
  loading: boolean;
  slideshow?: boolean;
  slideDelay?: number;
  pageFocused?: boolean;
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onSelect?: (game: GameWithTags) => void;
  onNavigate?: (game: GameWithTags) => void;
  onEdit?: (game: GameWithTags) => void;
  sorts?: SortEntry[];
  onSortChange?: (sorts: SortEntry[]) => void;
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

const HEADER_W = 460;
const HEADER_H = 215;
const HEADER_RATIO = HEADER_W / HEADER_H;
const SS_W = 600;
const SS_H = 338;
const SS_RATIO = SS_W / SS_H;

const ALL_COLUMNS: ColumnDef[] = [
  { key: "thumb", label: "Header", defaultWidth: 64, minWidth: 30, locked: true },
  { key: "screenshots", label: "Screenshots", defaultWidth: 160, minWidth: 30, locked: true },
  { key: "name", label: "Name", defaultWidth: 250, minWidth: 120, sortable: true, getValue: (g) => g.name.toLowerCase() },
  { key: "labels", label: "Labels", defaultWidth: 260, minWidth: 80 },
  { key: "tags", label: "Tags", defaultWidth: 160, minWidth: 30, sortable: true, getValue: (g) => (g.tags || []).map(t => t.tag_name).join(", ").toLowerCase() },
  { key: "genres", label: "Genres", defaultWidth: 160, minWidth: 30, sortable: true, getValue: (g) => { try { const a = JSON.parse(g.steam_genres || "[]"); return Array.isArray(a) ? a.join(", ").toLowerCase() : ""; } catch { return ""; } } },
  { key: "community", label: "Community", defaultWidth: 160, minWidth: 30, sortable: true, getValue: (g) => { try { const a = JSON.parse(g.community_tags || "[]"); return Array.isArray(a) ? a.join(", ").toLowerCase() : ""; } catch { return ""; } } },
  { key: "features", label: "Features", defaultWidth: 160, minWidth: 30, sortable: true, getValue: (g) => { try { const a = JSON.parse(g.steam_features || "[]"); return Array.isArray(a) ? a.join(", ").toLowerCase() : ""; } catch { return ""; } } },
  { key: "score", label: "Score", defaultWidth: 55, minWidth: 40, sortable: true, getValue: (g) => g.positive_percent || 0 },
  { key: "reviewCount", label: "Reviews", defaultWidth: 70, minWidth: 50, sortable: true, getValue: (g) => g.total_reviews || 0 },
  { key: "metacritic", label: "MC", defaultWidth: 50, minWidth: 40, sortable: true, getValue: (g) => g.metacritic_score || 0 },
  { key: "sentiment", label: "Sentiment", defaultWidth: 110, minWidth: 70, sortable: true, getValue: (g) => g.review_sentiment || "" },
  { key: "steamdb", label: "SDB", defaultWidth: 55, minWidth: 40, sortable: true, getValue: (g) => g.total_reviews > 0 ? steamDbScore(g.positive_percent, g.total_reviews) : 0 },
  { key: "release", label: "Release", defaultWidth: 90, minWidth: 60, sortable: true, getValue: (g) => g.release_date || "" },
  { key: "added_at", label: "Added", defaultWidth: 90, minWidth: 60, sortable: true, getValue: (g) => g.added_at || "" },
  { key: "wishlist_date", label: "Wishlisted", defaultWidth: 90, minWidth: 60, sortable: true, getValue: (g) => g.wishlist_date || "" },
  { key: "developers", label: "Developer", defaultWidth: 120, minWidth: 60, sortable: true, getValue: (g) => (g.developers || "").toLowerCase() },
  { key: "publishers", label: "Publisher", defaultWidth: 120, minWidth: 60, sortable: true, getValue: (g) => (g.publishers || "").toLowerCase() },
  { key: "appid", label: "AppID", defaultWidth: 75, minWidth: 50, sortable: true, getValue: (g) => g.steam_appid || 0 },
  { key: "notes", label: "Notes", defaultWidth: 150, minWidth: 60 },
  { key: "actions", label: "", defaultWidth: 70, minWidth: 50 },
];

const DEFAULT_VISIBLE = ["thumb", "screenshots", "name", "labels", "score", "reviewCount"];

const ROW_IMG_H_DEFAULT = 30;

/** Compute locked column width from rowHeight + ssCount, capped at natural image size */
function lockedWidth(key: string, h: number, ssCount: number): number {
  if (key === "thumb") {
    const effH = Math.min(h, HEADER_H);
    return Math.ceil(effH * HEADER_RATIO);
  }
  if (key === "screenshots") {
    const effH = Math.min(h, SS_H);
    const oneW = Math.ceil(effH * SS_RATIO);
    return ssCount * oneW + (ssCount - 1) * 2;
  }
  return 0;
}

function SortIndicator({ dir, index, multi }: { dir: SortDir; index: number; multi: boolean }) {
  return (
    <span className="inline-flex items-center ml-1 text-accent">
      <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>
      {multi && <span className="text-[8px] text-accent/60 ml-0.5">{index + 1}</span>}
    </span>
  );
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso || "—"; }
}

function ScreenshotCell({ game, imgH, ssCount, slideshow, slideDelay, pageFocused }: { game: GameWithTags; imgH: number; ssCount: number; slideshow: boolean; slideDelay: number; pageFocused: boolean }) {
  const ssData = useMemo(() => parseScreenshots(game.screenshots), [game.screenshots]);
  const thumbs = useMemo(() => ssData.map(s => s.thumb), [ssData]);
  const total = thumbs.length;
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const valid = useMemo(() => Array.from({ length: total }, (_, i) => i).filter(i => !failed.has(i)), [total, failed]);
  const active = slideshow && pageFocused && valid.length > 0;
  useEffect(() => {
    if (!active) { setTick(0); return; }
    setTick(1);
    const iv = setInterval(() => setTick(t => t + 1), slideDelay);
    return () => clearInterval(iv);
  }, [active, slideDelay]);
  if (valid.length === 0) return <span className="text-[10px] text-muted">—</span>;
  const show = Math.min(valid.length, ssCount);
  const effH = Math.min(imgH, SS_H);
  const w = Math.ceil(effH * SS_RATIO);
  const offset = tick > 0 ? (tick % valid.length) : 0;
  return (
    <div className="flex gap-0.5 overflow-hidden items-center">
      {Array.from({ length: show }, (_, slot) => {
        const idx = valid[(slot + offset) % valid.length];
        return (
          <img key={slot} src={thumbs[idx]} alt=""
            className="rounded flex-shrink-0"
            style={{ width: w, height: effH, objectFit: "cover" }}
            loading="lazy" onError={() => setFailed(prev => new Set(prev).add(idx))} />
        );
      })}
    </div>
  );
}

function ThumbCell({ game, imgH, slideshow, slideDelay, pageFocused, ssColVisible }: { game: GameWithTags; imgH: number; slideshow: boolean; slideDelay: number; pageFocused: boolean; ssColVisible: boolean }) {
  const effH = Math.min(imgH, HEADER_H);
  const w = Math.ceil(effH * HEADER_RATIO);
  const ssData = useMemo(() => parseScreenshots(game.screenshots), [game.screenshots]);
  const thumbs = useMemo(() => ssData.map(s => s.thumb), [ssData]);
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const valid = useMemo(() => Array.from({ length: thumbs.length }, (_, i) => i).filter(i => !failed.has(i)), [thumbs.length, failed]);
  const shouldCycle = slideshow && pageFocused && !ssColVisible && valid.length > 0;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!shouldCycle) { setTick(0); return; }
    setTick(1);
    const iv = setInterval(() => setTick(t => t + 1), slideDelay);
    return () => clearInterval(iv);
  }, [shouldCycle, slideDelay]);
  const src = tick > 0 ? thumbs[valid[(tick % valid.length)]] : headerUrl(game.steam_appid);
  return (
    <div className="overflow-hidden" style={{ width: w, height: effH }}>
      <img src={src} alt=""
        className="rounded" style={{ width: w, height: effH, objectFit: "cover" }}
        loading="lazy" onError={tick > 0 ? () => setFailed(prev => new Set(prev).add(valid[(tick % valid.length)])) : undefined} />
    </div>
  );
}

function TagsPills({ game, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude }: {
  game: GameWithTags;
  onTagInclude?: (id: number) => void; onTagExclude?: (id: number) => void;
  onSubtagInclude?: (id: number) => void; onSubtagExclude?: (id: number) => void;
}) {
  if (!game.tags || game.tags.length === 0) return <span className="text-muted text-[10px] italic">untagged</span>;
  const grouped = new Map<number, { tag_name: string; tag_color: string; tag_id: number; subs: typeof game.tags }>();
  for (const gt of game.tags) {
    if (!grouped.has(gt.tag_id)) grouped.set(gt.tag_id, { tag_name: gt.tag_name, tag_color: gt.tag_color, tag_id: gt.tag_id, subs: [] });
    grouped.get(gt.tag_id)!.subs.push(gt);
  }
  return (
    <div className="flex flex-wrap gap-0.5">
      {Array.from(grouped.values()).map((g) => (
        <div key={g.tag_id} className="inline-flex items-center gap-0.5 rounded px-1 py-0"
          style={{ backgroundColor: g.tag_color + "12", border: `1px solid ${g.tag_color}30` }}>
          <span className="text-[10px] cursor-pointer hover:underline" style={{ color: g.tag_color }}
            title="Click=include, Right-click=exclude"
            onClick={(e) => { e.stopPropagation(); onTagInclude?.(g.tag_id); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTagExclude?.(g.tag_id); }}
          >{g.tag_name}</span>
          {g.subs.some((s) => s.subtag_name) && (
            <>
              <span className="text-[8px] text-muted">›</span>
              {g.subs.filter((s) => s.subtag_name).map((s) => (
                <span key={s.id} className="px-0.5 rounded text-[9px] cursor-pointer hover:ring-1 hover:ring-current"
                  style={{ backgroundColor: s.subtag_type === "meta" ? "#f59e0b18" : "#818cf818", color: s.subtag_type === "meta" ? "#f59e0b" : "#818cf8" }}
                  title="Click=include, Right-click=exclude"
                  onClick={(e) => { e.stopPropagation(); onSubtagInclude?.(s.subtag_id!); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSubtagExclude?.(s.subtag_id!); }}
                >{s.subtag_name}</span>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function GenrePills({ items, className, onFilter }: { items: string[]; className: string; onFilter?: (name: string, mode: "include" | "exclude") => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5">
      {items.map((g, i) => (
        <span key={`${g}-${i}`} className={`text-[10px] px-1 py-0 rounded cursor-pointer hover:ring-1 transition-all ${className}`}
          title="Click=include, Right-click=exclude"
          onClick={(e) => { e.stopPropagation(); onFilter?.(g, "include"); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onFilter?.(g, "exclude"); }}
        >{g}</span>
      ))}
    </div>
  );
}

function CellContent({ col, game, imgH, ssCount, slideshow, slideDelay, pageFocused, ssColVisible, onEdit, onDelete, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude, onGenreFilter, onFeatureFilter, onCommunityTagFilter }: {
  col: ColumnDef; game: GameWithTags; imgH: number; ssCount: number; slideshow: boolean; slideDelay: number; pageFocused: boolean; ssColVisible: boolean;
  onEdit?: (game: GameWithTags) => void;
  onDelete: (id: number) => Promise<void>;
  onTagInclude?: (id: number) => void; onTagExclude?: (id: number) => void;
  onSubtagInclude?: (id: number) => void; onSubtagExclude?: (id: number) => void;
  onGenreFilter?: (name: string, mode: "include" | "exclude") => void;
  onFeatureFilter?: (name: string, mode: "include" | "exclude") => void;
  onCommunityTagFilter?: (name: string, mode: "include" | "exclude") => void;
}) {
  switch (col.key) {
    case "thumb": {
      return <ThumbCell game={game} imgH={imgH} slideshow={slideshow} slideDelay={slideDelay} pageFocused={pageFocused} ssColVisible={ssColVisible} />;
    }
    case "name":
      return (
        <div>
          <span className="font-medium text-xs">{game.name}</span>
          {game.steam_appid && (
            <a href={`https://store.steampowered.com/app/${game.steam_appid}`}
              target="_blank" rel="noopener noreferrer"
              className="text-accent text-[10px] ml-1.5 hover:underline"
              onClick={(e) => e.stopPropagation()}>↗</a>
          )}
        </div>
      );
    case "actions":
      return (
        <div className="flex gap-2">
          {game.steam_appid && <a href={`https://store.steampowered.com/app/${game.steam_appid}`} target="_blank" rel="noreferrer" className="text-accent text-[10px] hover:underline" onClick={(e) => e.stopPropagation()}>Steam ↗</a>}
        </div>
      );
    case "labels":
      return (
        <div className="flex flex-col gap-0.5 overflow-hidden">
          <TagsPills game={game} onTagInclude={onTagInclude} onTagExclude={onTagExclude}
            onSubtagInclude={onSubtagInclude} onSubtagExclude={onSubtagExclude} />
          <GenrePills items={[...new Set(safeJsonParse(game.steam_genres))].slice(0, 4)}
            className="bg-accent/10 text-accent/80 hover:ring-accent" onFilter={onGenreFilter} />
          <GenrePills items={[...new Set(safeJsonParse(game.community_tags))].slice(0, 5)}
            className="bg-purple-500/10 text-purple-400/80 hover:ring-purple-400" onFilter={onCommunityTagFilter} />
        </div>
      );
    case "tags":
      return <TagsPills game={game} onTagInclude={onTagInclude} onTagExclude={onTagExclude}
        onSubtagInclude={onSubtagInclude} onSubtagExclude={onSubtagExclude} />;
    case "genres":
      return <GenrePills items={[...new Set(safeJsonParse(game.steam_genres))].slice(0, 4)}
        className="bg-accent/10 text-accent/80 hover:ring-accent" onFilter={onGenreFilter} />;
    case "community":
      return <GenrePills items={[...new Set(safeJsonParse(game.community_tags))].slice(0, 5)}
        className="bg-purple-500/10 text-purple-400/80 hover:ring-purple-400" onFilter={onCommunityTagFilter} />;
    case "features":
      return <GenrePills items={[...new Set(safeJsonParse(game.steam_features))].slice(0, 4)}
        className="bg-teal-500/10 text-teal-400/80 hover:ring-teal-400" onFilter={onFeatureFilter} />;
    case "screenshots":
      return <ScreenshotCell game={game} imgH={imgH} ssCount={ssCount} slideshow={slideshow} slideDelay={slideDelay} pageFocused={pageFocused} />;
    case "score":
      return game.positive_percent > 0 ? (
        <span className="text-[10px] font-bold" style={{
          color: game.positive_percent >= 70 ? "#22c55e" : game.positive_percent >= 40 ? "#f59e0b" : "#ef4444",
        }}>{game.positive_percent}%</span>
      ) : <span className="text-[10px] text-muted">—</span>;
    case "reviewCount":
      return game.total_reviews > 0 ? (
        <span className="text-[10px] text-muted">{game.total_reviews.toLocaleString()}</span>
      ) : <span className="text-[10px] text-muted">—</span>;
    case "metacritic":
      return game.metacritic_score > 0 ? (
        <span className="text-[10px] font-bold px-1 rounded" style={{
          backgroundColor: game.metacritic_score >= 75 ? "#22c55e20" : game.metacritic_score >= 50 ? "#f59e0b20" : "#ef444420",
          color: game.metacritic_score >= 75 ? "#22c55e" : game.metacritic_score >= 50 ? "#f59e0b" : "#ef4444",
        }}>{game.metacritic_score}</span>
      ) : <span className="text-[10px] text-muted">—</span>;
    case "sentiment":
      return game.review_sentiment ? (
        <span className="text-[10px] truncate" style={{
          color: game.positive_percent >= 70 ? "#22c55e" : game.positive_percent >= 40 ? "#f59e0b" : "#ef4444",
        }}>{game.review_sentiment}</span>
      ) : <span className="text-[10px] text-muted">—</span>;
    case "steamdb": {
      const sdb = game.total_reviews > 0 ? steamDbScore(game.positive_percent, game.total_reviews) : 0;
      return sdb > 0 ? (
        <span className="text-[10px] font-bold" style={{
          color: sdb >= 70 ? "#22c55e" : sdb >= 40 ? "#f59e0b" : "#ef4444",
        }}>{sdb}</span>
      ) : <span className="text-[10px] text-muted">—</span>;
    }
    case "release":
      return <span className="text-[10px] text-muted">{game.release_date || "—"}</span>;
    case "added_at":
      return <span className="text-[10px] text-muted">{formatDateShort(game.added_at)}</span>;
    case "wishlist_date":
      return <span className="text-[10px] text-muted">{formatDateShort(game.wishlist_date)}</span>;
    case "developers":
      return <span className="text-[10px] text-muted truncate block">{game.developers || "—"}</span>;
    case "publishers":
      return <span className="text-[10px] text-muted truncate block">{game.publishers || "—"}</span>;
    case "appid":
      return game.steam_appid ? <span className="text-[10px] text-muted">{game.steam_appid}</span> : <span className="text-[10px] text-muted">—</span>;
    case "notes":
      return <span className="text-[10px] text-muted truncate block">{game.notes || "—"}</span>;
    default:
      return null;
  }
}

const TableRow = memo(function TableRow({ game, idx, selected, visibleCols, imgH, ssCount, slideshow, slideDelay, pageFocused, ssColVisible, colorCoded, scoreSource, tintColors, onRowClick, onEdit, onDelete, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude, onGenreFilter, onFeatureFilter, onCommunityTagFilter }: {
  game: GameWithTags; idx: number; selected: boolean;
  visibleCols: ColumnDef[]; imgH: number; ssCount: number; slideshow: boolean; slideDelay: number; pageFocused: boolean; ssColVisible: boolean;
  colorCoded?: boolean;
  scoreSource?: "steam" | "steamdb";
  tintColors?: TintColors | null;
  onRowClick: (idx: number, game: GameWithTags) => void;
  onEdit?: (game: GameWithTags) => void;
  onDelete: (id: number) => Promise<void>;
  onTagInclude?: (id: number) => void; onTagExclude?: (id: number) => void;
  onSubtagInclude?: (id: number) => void; onSubtagExclude?: (id: number) => void;
  onGenreFilter?: (name: string, mode: "include" | "exclude") => void;
  onFeatureFilter?: (name: string, mode: "include" | "exclude") => void;
  onCommunityTagFilter?: (name: string, mode: "include" | "exclude") => void;
}) {
  const effRowH = Math.min(imgH, Math.min(HEADER_H, SS_H));
  const tintBg = colorCoded ? getScoreTint(game, scoreSource || "steamdb", tintColors || null) : undefined;
  return (
    <tr data-row-idx={idx} data-game-id={game.id}
      className={`transition-colors cursor-pointer ${
        selected ? "bg-accent/20 ring-1 ring-inset ring-accent/40" : idx % 2 === 0 ? "bg-surface2/10 hover:bg-surface2/40" : "hover:bg-surface2/40"
      }`}
      style={{ height: effRowH, ...(tintBg && !selected ? { backgroundColor: tintBg } : {}) }}
      onClick={() => onRowClick(idx, game)}>
      {visibleCols.map((col) => (
        <td key={col.key}
          className={`overflow-hidden border-r border-border/30 last:border-r-0 ${
            col.locked ? "p-0" : "px-1 py-0"
          }`}
          style={{ verticalAlign: "top" }}>
          <CellContent col={col} game={game} imgH={imgH} ssCount={ssCount} slideshow={slideshow} slideDelay={slideDelay} pageFocused={pageFocused} ssColVisible={ssColVisible}
            onEdit={onEdit} onDelete={onDelete}
            onTagInclude={onTagInclude} onTagExclude={onTagExclude}
            onSubtagInclude={onSubtagInclude} onSubtagExclude={onSubtagExclude}
            onGenreFilter={onGenreFilter} onFeatureFilter={onFeatureFilter}
            onCommunityTagFilter={onCommunityTagFilter} />
        </td>
      ))}
    </tr>
  );
}, (prev, next) => {
  return prev.selected === next.selected &&
    prev.game === next.game &&
    prev.idx === next.idx &&
    prev.visibleCols === next.visibleCols &&
    prev.imgH === next.imgH &&
    prev.ssCount === next.ssCount &&
    prev.slideshow === next.slideshow &&
    prev.slideDelay === next.slideDelay &&
    prev.pageFocused === next.pageFocused &&
    prev.ssColVisible === next.ssColVisible &&
    prev.colorCoded === next.colorCoded &&
    prev.scoreSource === next.scoreSource &&
    prev.tintColors === next.tintColors;
});

export default function GameTable({ games, loading, onDelete, onSelect, onNavigate, onEdit, slideshow, slideDelay = 1000, pageFocused = true, sorts: externalSorts, onSortChange, onTagInclude, onTagExclude, onSubtagInclude, onSubtagExclude, onGenreFilter, onFeatureFilter, onCommunityTagFilter, colorCoded, scoreSource, tintColors }: Props) {
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => loadJson("gm_table_cols", DEFAULT_VISIBLE));
  const [colOrder, setColOrder] = useState<string[]>(() => loadJson("gm_table_order", ALL_COLUMNS.map((c) => c.key)));
  const [rowHeight, setRowHeight] = useState<number>(() => loadJson("gm_table_row_size", ROW_IMG_H_DEFAULT));
  const colWidthsRef = useRef<Record<string, number>>({});
  if (Object.keys(colWidthsRef.current).length === 0) {
    const saved = loadJson<Record<string, number>>("gm_table_widths", {});
    const init: Record<string, number> = {};
    for (const col of ALL_COLUMNS) {
      if (col.locked) continue; // locked cols don't use saved widths
      const val = saved[col.key] ?? col.defaultWidth;
      init[col.key] = Math.max(col.minWidth, val);
    }
    colWidthsRef.current = init;
  }

  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerBtnRef = useRef<HTMLButtonElement>(null);
  const [colPickerPos, setColPickerPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (showColPicker && colPickerBtnRef.current) {
      const r = colPickerBtnRef.current.getBoundingClientRect();
      setColPickerPos({ top: r.bottom + 4, left: r.right - 180 });
    }
    if (!showColPicker) setColPickerPos(null);
  }, [showColPicker]);
  const sorts = externalSorts || [];
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const tableRef = useRef<HTMLDivElement>(null);
  const colGroupRef = useRef<HTMLTableColElement[]>([]);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [ssCount, setSsCount] = useState<number>(() => loadJson("gm_table_ss_count", 3));

  const ssColVisible = visibleKeys.includes("screenshots");

  const persistWidths = useCallback(() => {
    localStorage.setItem("gm_table_widths", JSON.stringify(colWidthsRef.current));
  }, []);

  useEffect(() => { localStorage.setItem("gm_table_cols", JSON.stringify(visibleKeys)); }, [visibleKeys]);
  useEffect(() => { localStorage.setItem("gm_table_order", JSON.stringify(colOrder)); }, [colOrder]);
  useEffect(() => { localStorage.setItem("gm_table_row_size", JSON.stringify(rowHeight)); }, [rowHeight]);
  useEffect(() => { localStorage.setItem("gm_table_ss_count", JSON.stringify(ssCount)); }, [ssCount]);

  const normalizedOrder = useMemo(() => {
    const allKeys = ALL_COLUMNS.map((c) => c.key);
    const ordered = colOrder.filter((k) => allKeys.includes(k));
    const missing = allKeys.filter((k) => !ordered.includes(k));
    return [...ordered, ...missing];
  }, [colOrder]);

  const visibleCols = useMemo(() => {
    return normalizedOrder
      .filter((k) => visibleKeys.includes(k))
      .map((k) => ALL_COLUMNS.find((c) => c.key === k)!)
      .filter(Boolean);
  }, [visibleKeys, normalizedOrder]);

  // Sync colgroup widths — locked cols use computed width, others use saved
  useEffect(() => {
    const flexIdx = visibleCols.findIndex((c) => c.key === "labels") >= 0
      ? visibleCols.findIndex((c) => c.key === "labels")
      : visibleCols.findIndex((c) => !c.locked);
    for (let i = 0; i < visibleCols.length; i++) {
      const el = colGroupRef.current[i];
      if (!el) continue;
      const col = visibleCols[i];
      const w = col.locked
        ? lockedWidth(col.key, rowHeight, ssCount)
        : (colWidthsRef.current[col.key] || col.defaultWidth);
      if (i === flexIdx) {
        el.style.width = "";
        el.style.minWidth = `${w}px`;
      } else {
        el.style.width = `${w}px`;
        el.style.minWidth = "";
      }
    }
  }, [visibleCols, rowHeight, ssCount]);

  const handleSort = useCallback((key: string, e: React.MouseEvent) => {
    const col = ALL_COLUMNS.find((c) => c.key === key);
    if (!col?.sortable || !onSortChange) return;
    if (e.shiftKey) {
      const idx = sorts.findIndex((s) => s.key === key);
      if (idx >= 0) {
        const updated = [...sorts];
        if (updated[idx].dir === "asc") updated[idx] = { key, dir: "desc" };
        else updated.splice(idx, 1);
        onSortChange(updated);
      } else {
        onSortChange([...sorts, { key, dir: "asc" }]);
      }
    } else {
      if (sorts.length === 1 && sorts[0].key === key) {
        if (sorts[0].dir === "asc") onSortChange([{ key, dir: "desc" }]);
        else onSortChange([]);
      } else {
        onSortChange([{ key, dir: "asc" }]);
      }
    }
  }, [sorts, onSortChange]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
      if (games.length === 0) return;
      e.preventDefault();
      if (e.key === "Enter" && selectedIdx >= 0) { onSelect?.(games[selectedIdx]); return; }
      let next = selectedIdx;
      if (e.key === "ArrowDown") next = selectedIdx < games.length - 1 ? selectedIdx + 1 : selectedIdx;
      if (e.key === "ArrowUp") next = selectedIdx > 0 ? selectedIdx - 1 : 0;
      if (next !== selectedIdx) {
        setSelectedIdx(next);
        onNavigate?.(games[next]);
        setTimeout(() => { tableRef.current?.querySelector(`[data-row-idx="${next}"]`)?.scrollIntoView({ block: "nearest" }); }, 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [games, selectedIdx, onSelect, onNavigate]);

  // Reset selection when game list identity changes (not just reference)
  const gameIdsKey = useMemo(() => games.map((g) => g.id).join(","), [games]);
  useEffect(() => { setSelectedIdx(-1); }, [gameIdsKey]);

  // Resize — skip locked columns entirely
  const handleResizeStart = useCallback((colIdx: number, colKey: string, e: React.MouseEvent) => {
    const col = ALL_COLUMNS.find((c) => c.key === colKey);
    if (col?.locked) return; // locked = no resize
    e.preventDefault(); e.stopPropagation();
    let startX = e.clientX;
    const min = col?.minWidth || 40;
    const colEl = colGroupRef.current[colIdx];
    if (!colEl) return;
    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      startX = ev.clientX;
      const cur = colWidthsRef.current[colKey] || col?.defaultWidth || 100;
      const next = Math.max(min, cur + delta);
      colWidthsRef.current[colKey] = next;
      colEl.style.width = `${next}px`;
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      persistWidths();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [persistWidths]);

  const toggleCol = (key: string) => {
    setVisibleKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };
  const moveCol = (key: string, dir: -1 | 1) => {
    setColOrder((prev) => {
      const order = [...(prev.length ? prev : ALL_COLUMNS.map((c) => c.key))];
      const idx = order.indexOf(key);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= order.length) return prev;
      [order[idx], order[target]] = [order[target], order[idx]];
      return order;
    });
  };

  const resetAll = () => {
    setVisibleKeys(DEFAULT_VISIBLE);
    setColOrder(ALL_COLUMNS.map((c) => c.key));
    setRowHeight(ROW_IMG_H_DEFAULT);
    setSsCount(3);
    onSortChange?.([]);
    const defaults: Record<string, number> = {};
    for (const col of ALL_COLUMNS) if (!col.locked) defaults[col.key] = col.defaultWidth;
    colWidthsRef.current = defaults;
    localStorage.removeItem("gm_table_cols");
    localStorage.removeItem("gm_table_widths");
    localStorage.removeItem("gm_table_order");
    localStorage.removeItem("gm_table_row_size");
    localStorage.removeItem("gm_table_ss_count");
    for (let i = 0; i < visibleCols.length; i++) {
      const el = colGroupRef.current[i];
      const col = visibleCols[i];
      if (!el) continue;
      const w = col.locked ? lockedWidth(col.key, ROW_IMG_H_DEFAULT, 3) : (defaults[col.key] || 100);
      el.style.width = `${w}px`;
    }
  };

  const handleRowClick = useCallback((idx: number, game: GameWithTags) => {
    setSelectedIdx(idx);
    onSelect?.(game);
  }, [onSelect]);

  const handlePickerDragStart = (key: string) => setDragCol(key);
  const handlePickerDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!dragCol || dragCol === targetKey) return;
    setColOrder((prev) => {
      const order = [...(prev.length ? prev : ALL_COLUMNS.map((c) => c.key))];
      const fromIdx = order.indexOf(dragCol);
      const toIdx = order.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragCol);
      return order;
    });
  };
  const handlePickerDragEnd = () => setDragCol(null);

  if (loading) return <div className="text-center text-muted py-8">Loading games...</div>;
  if (games.length === 0) return <div className="text-center text-muted py-8">No games found.</div>;

  const pickerItems = normalizedOrder
    .map((k) => ALL_COLUMNS.find((c) => c.key === k)!)
    .filter((c) => c && c.label);

  return (
    <div className="bg-surface rounded-lg" ref={tableRef}>
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/50 gap-2 shrink-0 sticky top-0 z-20 bg-surface rounded-t-lg">
        <span className="text-[10px] text-muted">
          {sorts.length > 0 && `Sorted by: ${sorts.map((s) => `${ALL_COLUMNS.find((c) => c.key === s.key)?.label} ${s.dir === "asc" ? "↑" : "↓"}`).join(", ")}`}
          {sorts.length > 0 && <button onClick={() => onSortChange?.([])} className="text-danger ml-2 hover:underline">clear</button>}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            <button onClick={() => setRowHeight(Math.max(20, rowHeight - 10))} className="text-muted hover:text-foreground px-1 text-[8px]" title="Smaller rows">●</button>
            <input type="range" min={20} max={240} value={rowHeight} onChange={(e) => setRowHeight(Number(e.target.value))}
              className="w-14 accent-accent" title={`Row height: ${rowHeight}px`} />
            <button onClick={() => setRowHeight(Math.min(240, rowHeight + 10))} className="text-muted hover:text-foreground px-1 text-base" title="Bigger rows">●</button>
          </div>
          <label className="flex items-center gap-1 text-[10px] text-muted" title="Screenshots per row">
            SS
            <select value={ssCount} onChange={(e) => setSsCount(Number(e.target.value))}
              className="bg-background border border-border rounded px-1 py-0 text-[10px]">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button onClick={resetAll} className="text-[10px] text-danger hover:underline" title="Reset all">↺ Reset</button>
          <div className="relative">
            <button ref={colPickerBtnRef} onClick={() => setShowColPicker(!showColPicker)}
              className="text-[10px] text-muted hover:text-foreground">⚙ Columns</button>
            {showColPicker && colPickerPos && (
              <div className="fixed bg-surface border border-border rounded shadow-lg p-2 z-50 min-w-[180px] max-h-[70vh] overflow-y-auto"
                style={{ top: colPickerPos.top, left: colPickerPos.left }}>
                <div className="text-[9px] text-muted mb-1 px-1">Drag to reorder · Check to show</div>
                {pickerItems.map((col) => (
                  <div key={col.key} draggable
                    onDragStart={() => handlePickerDragStart(col.key)}
                    onDragOver={(e) => handlePickerDragOver(e, col.key)}
                    onDragEnd={handlePickerDragEnd}
                    className={`flex items-center gap-1 text-[11px] py-0.5 cursor-grab hover:bg-surface2/50 px-1 rounded ${dragCol === col.key ? "opacity-40" : ""}`}>
                    <span className="text-muted/40 text-[9px] cursor-grab">⠿</span>
                    <input type="checkbox" checked={visibleKeys.includes(col.key)}
                      onChange={() => toggleCol(col.key)} className="accent-accent" />
                    <span className="flex-1">{col.label}</span>
                    <button onClick={() => moveCol(col.key, -1)} className="text-[9px] text-muted hover:text-foreground px-0.5">▲</button>
                    <button onClick={() => moveCol(col.key, 1)} className="text-[9px] text-muted hover:text-foreground px-0.5">▼</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <table className="text-sm" style={{ tableLayout: "fixed", width: "100%", borderSpacing: `0 ${Math.max(1, Math.round(rowHeight / 30))}px`, borderCollapse: "separate" }}>
          <colgroup>
            {visibleCols.map((col, i) => {
              // "labels" (or first non-locked col if labels hidden) gets no width — absorbs extra space
              const isFlex = col.key === "labels" || (!visibleKeys.includes("labels") && !col.locked && i === visibleCols.findIndex((c) => !c.locked));
              const w = col.locked
                ? lockedWidth(col.key, rowHeight, ssCount)
                : (colWidthsRef.current[col.key] || col.defaultWidth);
              return (
                <col key={col.key} ref={(el) => { if (el) colGroupRef.current[i] = el; }}
                  style={isFlex ? { minWidth: w } : { width: w }} />
              );
            })}
          </colgroup>
          <thead className="sticky z-10 bg-surface" style={{ top: 33 }}>
            <tr className="border-b border-border text-muted text-left text-xs">
              {visibleCols.map((col, colIdx) => {
                const sortIdx = sorts.findIndex((s) => s.key === col.key);
                const sortEntry = sortIdx >= 0 ? sorts[sortIdx] : null;
                return (
                  <th key={col.key}
                    className={`px-2 py-2 font-medium relative select-none overflow-hidden border-r border-border/30 last:border-r-0 ${col.sortable ? "cursor-pointer hover:text-foreground" : ""}`}
                    onClick={(e) => handleSort(col.key, e)}
                    title={col.sortable ? "Click to sort, Shift+click for multi-sort" : undefined}>
                    {col.label}
                    {sortEntry && <SortIndicator dir={sortEntry.dir} index={sortIdx} multi={sorts.length > 1} />}
                    {!col.locked && (
                      <div onMouseDown={(e) => handleResizeStart(colIdx, col.key, e)}
                        className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize hover:bg-accent/30 transition-colors z-10" />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {games.map((game, idx) => (
              <TableRow key={game.id} game={game} idx={idx} selected={idx === selectedIdx}
                visibleCols={visibleCols} imgH={rowHeight} ssCount={ssCount} slideshow={!!slideshow} slideDelay={slideDelay} pageFocused={pageFocused} ssColVisible={ssColVisible}
                colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
                onRowClick={handleRowClick}
                onEdit={onEdit} onDelete={onDelete}
                onTagInclude={onTagInclude} onTagExclude={onTagExclude}
                onSubtagInclude={onSubtagInclude} onSubtagExclude={onSubtagExclude}
                onGenreFilter={onGenreFilter} onFeatureFilter={onFeatureFilter}
                onCommunityTagFilter={onCommunityTagFilter} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
