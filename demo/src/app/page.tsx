"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useTags, useGames, useSubtags, Filters, computeDynamicCounts } from "@/lib/hooks";
import { GameWithTags, Tag, Subtag, COLOR_PRESETS, TintColors } from "@/lib/types";
import Sidebar from "@/components/Sidebar";
import GameCard from "@/components/GameCard";
import GameTable from "@/components/GameTable";
import Inspector from "@/components/Inspector";

function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export default function Home() {
  const { tags } = useTags();
  const { subtags } = useSubtags();
  const { games, totalCount, loading, filters, setFilters } = useGames();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const sidebarDragging = useRef(false);
  const [selectedGame, setSelectedGame] = useState<GameWithTags | null>(null);
  const [inspectorGame, setInspectorGame] = useState<GameWithTags | null>(null);
  const lastSelectedIdRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [cardCols, setCardCols] = useState(6);
  const [slideshow, setSlideshow] = useState(false);
  const [slideSpeed, setSlideSpeed] = useState(1);
  const [pageFocused, setPageFocused] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [colorCoded, setColorCoded] = useState(false);
  const [scoreSource, setScoreSource] = useState<"steam" | "steamdb">("steamdb");
  const [tintColors, setTintColors] = useState<TintColors | null>(null);

  // Compute genres/features/communityTags from game data
  const dyn = computeDynamicCounts(games);
  const genres = Array.from(dyn.genreCounts.entries()).map(([name, count]) => ({ name, count }));
  const features = Array.from(dyn.featureCounts.entries()).map(([name, count]) => ({ name, count }));
  const communityTags = Array.from(dyn.communityTagCounts.entries()).map(([name, count]) => ({ name, count }));

  // Keep inspectorGame / selectedGame in sync when games array refreshes
  useEffect(() => {
    if (inspectorGame) { const fresh = games.find((g) => g.id === inspectorGame.id); if (fresh && fresh !== inspectorGame) setInspectorGame(fresh); }
    if (selectedGame) { const fresh = games.find((g) => g.id === selectedGame.id); if (fresh && fresh !== selectedGame) setSelectedGame(fresh); }
  }, [games]); // eslint-disable-line react-hooks/exhaustive-deps

  const hydratedRef = useRef(false);
  useEffect(() => {
    setSidebarCollapsed(loadPref("gm_sidebar", false));
    setSidebarWidth(loadPref("gm_sidebar_width", 256));
    setView(loadPref("gm_view", "cards"));
    setCardCols(loadPref("gm_cols", 6));
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    const onFocus = () => setPageFocused(true);
    const onBlur = () => setPageFocused(false);
    window.addEventListener("focus", onFocus); window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur); };
  }, []);

  // Scroll
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Pagination
  const PAGE_SIZE = 40;
  const [displayLimit, setDisplayLimit] = useState(40);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const displayedGames = games.slice(0, displayLimit);

  useEffect(() => { setDisplayLimit(PAGE_SIZE); }, [filters]);

  useEffect(() => {
    const sentinel = sentinelRef.current; const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && displayLimit < games.length) setDisplayLimit((prev) => Math.min(prev + PAGE_SIZE, games.length));
    }, { root, rootMargin: "200px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayLimit, games.length]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setFilters({ ...filters, search: searchQuery || undefined }), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist prefs
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_view", JSON.stringify(view)); }, [view]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_cols", JSON.stringify(cardCols)); }, [cardCols]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_sidebar", JSON.stringify(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_sidebar_width", JSON.stringify(sidebarWidth)); }, [sidebarWidth]);

  // Sidebar resize
  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); sidebarDragging.current = true;
    const onMove = (ev: MouseEvent) => { if (!sidebarDragging.current) return; setSidebarWidth(Math.min(480, Math.max(180, ev.clientX))); };
    const onUp = () => { sidebarDragging.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, []);

  // Tag filter toggles
  const toggleIncTag = useCallback((id: number) => {
    const inc = filters.includeTags || [], exc = filters.excludeTags || [];
    if (inc.includes(id)) setFilters({ ...filters, includeTags: inc.filter((t) => t !== id) });
    else setFilters({ ...filters, includeTags: [...inc, id], excludeTags: exc.filter((t) => t !== id) });
  }, [filters, setFilters]);
  const toggleExcTag = useCallback((id: number) => {
    const exc = filters.excludeTags || [], inc = filters.includeTags || [];
    if (exc.includes(id)) setFilters({ ...filters, excludeTags: exc.filter((t) => t !== id) });
    else setFilters({ ...filters, excludeTags: [...exc, id], includeTags: inc.filter((t) => t !== id) });
  }, [filters, setFilters]);
  const toggleIncSub = useCallback((id: number) => {
    const inc = filters.includeSubtags || [], exc = filters.excludeSubtags || [];
    if (inc.includes(id)) setFilters({ ...filters, includeSubtags: inc.filter((t) => t !== id) });
    else setFilters({ ...filters, includeSubtags: [...inc, id], excludeSubtags: exc.filter((t) => t !== id) });
  }, [filters, setFilters]);
  const toggleExcSub = useCallback((id: number) => {
    const exc = filters.excludeSubtags || [], inc = filters.includeSubtags || [];
    if (exc.includes(id)) setFilters({ ...filters, excludeSubtags: exc.filter((t) => t !== id) });
    else setFilters({ ...filters, excludeSubtags: [...exc, id], includeSubtags: inc.filter((t) => t !== id) });
  }, [filters, setFilters]);
  const toggleStrFilter = useCallback((incKey: keyof typeof filters, excKey: keyof typeof filters, val: string, mode: "include" | "exclude") => {
    const inc = ((filters[incKey] as string[]) || []);
    const exc = ((filters[excKey] as string[]) || []);
    if (mode === "include") {
      if (inc.includes(val)) setFilters({ ...filters, [incKey]: inc.filter((v) => v !== val) });
      else setFilters({ ...filters, [incKey]: [...inc, val], [excKey]: exc.filter((v) => v !== val) });
    } else {
      if (exc.includes(val)) setFilters({ ...filters, [excKey]: exc.filter((v) => v !== val) });
      else setFilters({ ...filters, [excKey]: [...exc, val], [incKey]: inc.filter((v) => v !== val) });
    }
  }, [filters, setFilters]);
  const onGenreFilter = useCallback((name: string, mode: "include" | "exclude") => toggleStrFilter("includeGenres", "excludeGenres", name, mode), [toggleStrFilter]);
  const onFeatureFilter = useCallback((name: string, mode: "include" | "exclude") => toggleStrFilter("includeFeatures", "excludeFeatures", name, mode), [toggleStrFilter]);
  const onCommunityTagFilter = useCallback((name: string, mode: "include" | "exclude") => toggleStrFilter("includeCommunityTags", "excludeCommunityTags", name, mode), [toggleStrFilter]);
  const closeInspector = useCallback(() => setInspectorGame(null), []);

  // Keyboard
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "Escape" && e.target === searchRef.current) { setSearchQuery(""); searchRef.current?.blur(); return; }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { searchRef.current?.focus(); return; }
      if (e.key === "Escape") {
        if (inspectorGame) setInspectorGame(null);
        else if (selectedGame) setSelectedGame(null);
        else searchRef.current?.focus();
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && selectedGame && !inspectorGame) { e.preventDefault(); setInspectorGame(selectedGame); return; }
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      if (view !== "cards") return;
      e.preventDefault();
      const grid = document.querySelector(".game-grid-container");
      let cols = 6;
      if (grid) { const tc = getComputedStyle(grid).getPropertyValue("grid-template-columns"); cols = tc ? tc.split(" ").length : 6; }
      if (!selectedGame) { const g = displayedGames[0]; if (g) { setSelectedGame(g); lastSelectedIdRef.current = g.id; } return; }
      const idx = displayedGames.findIndex((g) => g.id === selectedGame.id);
      if (idx === -1) return;
      let nextIdx = idx;
      if (e.key === "ArrowRight" && idx < displayedGames.length - 1) nextIdx = idx + 1;
      if (e.key === "ArrowLeft" && idx > 0) nextIdx = idx - 1;
      if (e.key === "ArrowDown" && idx + cols < displayedGames.length) nextIdx = idx + cols;
      if (e.key === "ArrowUp" && idx - cols >= 0) nextIdx = idx - cols;
      if (nextIdx !== idx) {
        const nextGame = displayedGames[nextIdx];
        setSelectedGame(nextGame);
        if (inspectorGame) setInspectorGame(nextGame);
        lastSelectedIdRef.current = nextGame.id;
        document.querySelector(`[data-game-id="${nextGame.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [selectedGame, inspectorGame, games, view, displayedGames]);

  const handleSelectGame = (game: GameWithTags) => {
    if (inspectorGame?.id === game.id) setInspectorGame(null);
    else { setInspectorGame(game); setSelectedGame(game); }
    lastSelectedIdRef.current = game.id;
  };

  const isSearching = !!searchQuery.trim();
  const isFiltered = (filters.includeTags?.length || 0) > 0 || (filters.excludeTags?.length || 0) > 0 ||
    (filters.includeSubtags?.length || 0) > 0 || (filters.excludeSubtags?.length || 0) > 0 ||
    (filters.includeGenres?.length || 0) > 0 || (filters.excludeGenres?.length || 0) > 0 ||
    (filters.includeFeatures?.length || 0) > 0 || (filters.excludeFeatures?.length || 0) > 0 ||
    (filters.includeCommunityTags?.length || 0) > 0 || (filters.excludeCommunityTags?.length || 0) > 0 ||
    (filters.includeDevelopers?.length || 0) > 0 || (filters.excludeDevelopers?.length || 0) > 0 ||
    (filters.includePublishers?.length || 0) > 0 || (filters.excludePublishers?.length || 0) > 0 ||
    filters.untagged || filters.withNotes || filters.hideWishlistOnly || isSearching;

  // Dummy no-op for table's required props
  const noop = async () => {};

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar tags={tags} subtags={subtags} genres={genres} features={features} communityTags={communityTags}
        games={games} filters={filters} onChange={setFilters}
        collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        width={sidebarWidth} />
      {!sidebarCollapsed && (
        <div className="w-1.5 shrink-0 cursor-col-resize flex items-center justify-center hover:bg-accent/20 active:bg-accent/30 transition-colors group" onMouseDown={onSidebarDragStart}>
          <div className="w-0.5 h-8 rounded bg-border group-hover:bg-accent/50 transition-colors" />
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0">
          <h1 className="text-sm font-semibold mr-2">🎮 Games <span className="text-[10px] text-muted font-normal">(demo)</span></h1>
          <input ref={searchRef} type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..." className="flex-1 max-w-lg bg-background border border-border rounded px-3 py-1 text-sm focus:outline-none focus:border-accent" />
          <select value={filters.sort || "name"} onChange={(e) => setFilters({ ...filters, sort: e.target.value, sorts: [{ key: e.target.value, dir: filters.dir || "asc" }] })}
            className="bg-background border border-border rounded px-2 py-1 text-xs">
            <option value="name">Name</option><option value="tag">Tag</option><option value="genre">Genre</option>
            <option value="rating">Rating</option><option value="steamdb">SteamDB</option><option value="reviews">Reviews</option>
            <option value="metacritic">Metacritic</option><option value="sentiment">Sentiment</option>
            <option value="release_date">Release</option><option value="added_at">Added</option>
          </select>
          <button onClick={() => { const d = filters.dir === "desc" ? "asc" : "desc"; const s = (filters.sorts || []).map(s => ({ ...s, dir: d as "asc" | "desc" })); setFilters({ ...filters, dir: d as "asc" | "desc", sorts: s.length > 0 ? s : undefined }); }}
            className="bg-background border border-border rounded px-2 py-1 text-xs text-muted hover:text-foreground">{filters.dir === "desc" ? "↓" : "↑"}</button>
          <div className="flex gap-0.5 bg-background rounded border border-border">
            <button onClick={() => setView("cards")} className={`px-2 py-1 text-xs rounded-l ${view === "cards" ? "bg-accent text-white" : "text-muted"}`}>▦</button>
            <button onClick={() => setView("table")} className={`px-2 py-1 text-xs rounded-r ${view === "table" ? "bg-accent text-white" : "text-muted"}`}>☰</button>
          </div>
          <button onClick={() => setSlideshow(!slideshow)}
            className={`px-2 py-1 text-xs rounded border ${slideshow ? "bg-accent/20 border-accent text-accent" : "bg-background border-border text-muted"}`}
            title={`Slideshow ${slideshow ? "on" : "off"}`}>▶</button>
          {view === "cards" && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setCardCols(Math.min(8, cardCols + 1))} className="text-muted hover:text-foreground px-1 text-[8px]">●</button>
              <input type="range" min={2} max={8} value={9 - cardCols} onChange={(e) => setCardCols(9 - Number(e.target.value))} className="w-16 accent-accent" />
              <button onClick={() => setCardCols(Math.max(2, cardCols - 1))} className="text-muted hover:text-foreground px-1 text-base">●</button>
            </div>
          )}
          <span className="text-xs text-muted">{isFiltered ? `${games.length}/${totalCount}` : `${totalCount}`} games</span>
          <Link href="/settings" className="text-xs text-muted hover:text-accent" title="Settings">⚙</Link>
        </div>
        {isFiltered && <FilterChips tags={tags} subtags={subtags} filters={filters} onChange={setFilters} onClearSearch={() => setSearchQuery("")} />}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 relative">
          {loading ? (<div className="text-center text-muted py-12">Loading games...</div>
          ) : games.length === 0 ? (<div className="text-center text-muted py-12">No games found. Adjust filters.</div>
          ) : view === "cards" ? (
            <div className="game-grid-container grid gap-3" style={{ gridTemplateColumns: `repeat(${cardCols}, minmax(0, 1fr))` }}>
              {displayedGames.map((game) => (
                <GameCard key={game.id} game={game} selected={selectedGame?.id === game.id} onClick={() => handleSelectGame(game)}
                  slideshow={slideshow} slideDelay={slideSpeed * 1000} pageFocused={pageFocused}
                  colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
                  onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
                  onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
                  onGenreFilter={onGenreFilter} onCommunityTagFilter={onCommunityTagFilter} />
              ))}
            </div>
          ) : (
            <GameTable games={displayedGames} tags={tags} loading={loading} onUpdate={noop} onDelete={noop}
              slideshow={slideshow} slideDelay={slideSpeed * 1000} pageFocused={pageFocused}
              colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
              onSelect={handleSelectGame}
              onNavigate={(game) => { setSelectedGame(game); if (inspectorGame) setInspectorGame(game); }}
              sorts={filters.sorts || []}
              onSortChange={(s) => setFilters({ ...filters, sorts: s, sort: s.length === 1 ? s[0].key : undefined, dir: s.length === 1 ? s[0].dir : undefined })}
              onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
              onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
              onGenreFilter={onGenreFilter} onFeatureFilter={onFeatureFilter} onCommunityTagFilter={onCommunityTagFilter} />
          )}
          {displayLimit < games.length && (
            <div ref={sentinelRef} className="text-center text-muted text-xs py-6">Showing {displayedGames.length} of {games.length}...</div>
          )}
        </div>
      </div>
      {inspectorGame && (
        <Inspector game={inspectorGame} onClose={closeInspector} tags={tags}
          colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
          onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
          onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
          onGenreFilter={onGenreFilter} onFeatureFilter={onFeatureFilter} onCommunityTagFilter={onCommunityTagFilter} />
      )}
      {showScrollTop && (
        <button onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-5 right-5 z-40 w-9 h-9 rounded-full bg-accent/80 hover:bg-accent text-white flex items-center justify-center shadow-lg text-lg">↑</button>
      )}
    </div>
  );
}

function FilterChips({ tags, subtags, filters, onChange, onClearSearch }: { tags: Tag[]; subtags: Subtag[]; filters: Filters; onChange: (f: Filters) => void; onClearSearch?: () => void }) {
  const chips: { label: string; color: string; type: "include" | "exclude"; onRemove: () => void }[] = [];
  for (const id of filters.includeTags || []) { const tag = tags.find((t) => t.id === id); if (tag) chips.push({ label: tag.name, color: tag.color, type: "include", onRemove: () => onChange({ ...filters, includeTags: (filters.includeTags || []).filter((t) => t !== id) }) }); }
  for (const id of filters.excludeTags || []) { const tag = tags.find((t) => t.id === id); if (tag) chips.push({ label: tag.name, color: "#ef4444", type: "exclude", onRemove: () => onChange({ ...filters, excludeTags: (filters.excludeTags || []).filter((t) => t !== id) }) }); }
  for (const id of filters.includeSubtags || []) { const sub = subtags.find((s) => s.id === id); if (sub) { const parent = tags.find((t) => t.id === sub.tag_id); chips.push({ label: parent ? `${parent.name}>${sub.name}` : sub.name, color: sub.type === "genre" ? "#6366f1" : "#f59e0b", type: "include", onRemove: () => onChange({ ...filters, includeSubtags: (filters.includeSubtags || []).filter((t) => t !== id) }) }); } }
  for (const id of filters.excludeSubtags || []) { const sub = subtags.find((s) => s.id === id); if (sub) { const parent = tags.find((t) => t.id === sub.tag_id); chips.push({ label: parent ? `${parent.name}>${sub.name}` : sub.name, color: "#ef4444", type: "exclude", onRemove: () => onChange({ ...filters, excludeSubtags: (filters.excludeSubtags || []).filter((t) => t !== id) }) }); } }
  const addStr = (items: string[] | undefined, type: "include" | "exclude", prefix: string, key: keyof Filters) => {
    for (const val of items || []) chips.push({ label: `${prefix}: ${val}`, color: type === "include" ? "#6366f1" : "#ef4444", type, onRemove: () => onChange({ ...filters, [key]: ((filters[key] as string[]) || []).filter((v) => v !== val) }) });
  };
  addStr(filters.includeGenres, "include", "Genre", "includeGenres"); addStr(filters.excludeGenres, "exclude", "Genre", "excludeGenres");
  addStr(filters.includeFeatures, "include", "Feature", "includeFeatures"); addStr(filters.excludeFeatures, "exclude", "Feature", "excludeFeatures");
  addStr(filters.includeCommunityTags, "include", "CTag", "includeCommunityTags"); addStr(filters.excludeCommunityTags, "exclude", "CTag", "excludeCommunityTags");
  addStr(filters.includeDevelopers, "include", "Dev", "includeDevelopers"); addStr(filters.excludeDevelopers, "exclude", "Dev", "excludeDevelopers");
  addStr(filters.includePublishers, "include", "Pub", "includePublishers"); addStr(filters.excludePublishers, "exclude", "Pub", "excludePublishers");
  if (filters.untagged) chips.push({ label: "Untagged only", color: "#f59e0b", type: "include", onRemove: () => onChange({ ...filters, untagged: false }) });
  if (filters.withNotes) chips.push({ label: "With notes", color: "#6366f1", type: "include", onRemove: () => onChange({ ...filters, withNotes: false }) });
  if (filters.hideWishlistOnly) chips.push({ label: "Curated only", color: "#6366f1", type: "include", onRemove: () => onChange({ ...filters, hideWishlistOnly: false }) });
  if (chips.length === 0) return null;
  return (
    <div className="px-4 py-1.5 border-b border-border flex flex-wrap gap-1 items-center shrink-0">
      <span className="text-[10px] text-muted mr-1">Active:</span>
      {chips.map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
          style={{ backgroundColor: chip.color + "18", border: `1px solid ${chip.color}40`, color: chip.color, textDecoration: chip.type === "exclude" ? "line-through" : undefined }}>
          {chip.type === "exclude" && "−"}{chip.label}
          <button onClick={chip.onRemove} className="hover:opacity-70 ml-0.5 font-bold" style={{ color: chip.color }}>×</button>
        </span>
      ))}
      <button onClick={() => { onChange({ ...filters, includeTags: [], excludeTags: [], includeSubtags: [], excludeSubtags: [], includeGenres: [], excludeGenres: [], includeFeatures: [], excludeFeatures: [], includeCommunityTags: [], excludeCommunityTags: [], includeDevelopers: [], excludeDevelopers: [], includePublishers: [], excludePublishers: [], untagged: false, withNotes: false, hideWishlistOnly: false, search: undefined }); onClearSearch?.(); }} className="text-[10px] text-danger hover:underline ml-1">Clear all</button>
    </div>
  );
}
