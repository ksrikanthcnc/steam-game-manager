"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Filters, GenreInfo, computeDynamicCounts } from "@/lib/hooks";
import { Tag, Subtag, GameWithTags } from "@/lib/types";

type SortMode = "alpha" | "count";
type SteamTab = "genres" | "features" | "devpub";
type LayoutMode = "tabbed" | "classic";

const TOP_GENRES = new Set([
  "Action", "Adventure", "Casual", "Indie", "Massively Multiplayer",
  "Racing", "RPG", "Simulation", "Sports", "Strategy",
  "Free to Play", "Early Access",
]);

function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

interface Props {
  tags: Tag[];
  subtags: Subtag[];
  genres: GenreInfo[];
  features: GenreInfo[];
  communityTags: GenreInfo[];
  games: GameWithTags[];
  filters: Filters;
  onChange: (filters: Filters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width?: number;
}

export default function Sidebar({
  tags, subtags, genres, features, communityTags, games,
  filters, onChange, collapsed, onToggleCollapse, width = 256,
}: Props) {
  const [search, setSearch] = useState("");
  const [expandedTagIds, setExpandedTagIds] = useState<Set<number>>(new Set());
  const [steamTab, setSteamTab] = useState<SteamTab>("genres");
  const [steamSort, setSteamSort] = useState<SortMode>("count");
  const [layout, setLayout] = useState<LayoutMode>("tabbed");
  const [splitPct, setSplitPct] = useState(50);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Classic accordion states
  const [genresOpen, setGenresOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [devsOpen, setDevsOpen] = useState(false);
  const [pubsOpen, setPubsOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  // Hydrate prefs after mount
  useEffect(() => {
    setLayout(loadPref<LayoutMode>("gm_sidebar_layout", "tabbed"));
    setSplitPct(loadPref<number>("gm_sidebar_split", 50));
  }, []);

  const toggleLayout = useCallback(() => {
    setLayout((prev) => {
      const next = prev === "tabbed" ? "classic" : "tabbed";
      localStorage.setItem("gm_sidebar_layout", JSON.stringify(next));
      return next;
    });
  }, []);

  // Drag resize handler
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = Math.min(80, Math.max(20, ((ev.clientY - rect.top) / rect.height) * 100));
      setSplitPct(pct);
    };
    const onUp = () => {
      draggingRef.current = false;
      setSplitPct((p) => { localStorage.setItem("gm_sidebar_split", JSON.stringify(p)); return p; });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const dyn = useMemo(() => computeDynamicCounts(games), [games]);
  const q = search.toLowerCase();

  const subsByTag = useMemo(() => {
    const m = new Map<number, Subtag[]>();
    for (const s of subtags) {
      if (!m.has(s.tag_id)) m.set(s.tag_id, []);
      m.get(s.tag_id)!.push(s);
    }
    for (const [, arr] of m) arr.sort((a, b) => (dyn.subtagCounts.get(b.id) || 0) - (dyn.subtagCounts.get(a.id) || 0));
    return m;
  }, [subtags, dyn.subtagCounts]);

  const sortedTags = useMemo(() =>
    [...tags].sort((a, b) => (dyn.customTagCounts.get(b.id) || 0) - (dyn.customTagCounts.get(a.id) || 0)),
  [tags, dyn.customTagCounts]);

  // Toggle helpers
  const toggleIncTag = (id: number) => {
    const inc = filters.includeTags || [], exc = filters.excludeTags || [];
    if (inc.includes(id)) onChange({ ...filters, includeTags: inc.filter((t) => t !== id) });
    else onChange({ ...filters, includeTags: [...inc, id], excludeTags: exc.filter((t) => t !== id) });
  };
  const toggleExcTag = (id: number) => {
    const exc = filters.excludeTags || [], inc = filters.includeTags || [];
    if (exc.includes(id)) onChange({ ...filters, excludeTags: exc.filter((t) => t !== id) });
    else onChange({ ...filters, excludeTags: [...exc, id], includeTags: inc.filter((t) => t !== id) });
  };
  const toggleIncSub = (id: number) => {
    const inc = filters.includeSubtags || [], exc = filters.excludeSubtags || [];
    if (inc.includes(id)) onChange({ ...filters, includeSubtags: inc.filter((t) => t !== id) });
    else onChange({ ...filters, includeSubtags: [...inc, id], excludeSubtags: exc.filter((t) => t !== id) });
  };
  const toggleExcSub = (id: number) => {
    const exc = filters.excludeSubtags || [], inc = filters.includeSubtags || [];
    if (exc.includes(id)) onChange({ ...filters, excludeSubtags: exc.filter((t) => t !== id) });
    else onChange({ ...filters, excludeSubtags: [...exc, id], includeSubtags: inc.filter((t) => t !== id) });
  };
  const toggleStr = (incKey: keyof Filters, excKey: keyof Filters, val: string, mode: "include" | "exclude") => {
    const inc = ((filters[incKey] as string[]) || []);
    const exc = ((filters[excKey] as string[]) || []);
    if (mode === "include") {
      if (inc.includes(val)) onChange({ ...filters, [incKey]: inc.filter((v) => v !== val) });
      else onChange({ ...filters, [incKey]: [...inc, val], [excKey]: exc.filter((v) => v !== val) });
    } else {
      if (exc.includes(val)) onChange({ ...filters, [excKey]: exc.filter((v) => v !== val) });
      else onChange({ ...filters, [excKey]: [...exc, val], [incKey]: inc.filter((v) => v !== val) });
    }
  };

  const hasFilters =
    (filters.includeTags?.length || 0) > 0 || (filters.excludeTags?.length || 0) > 0 ||
    (filters.includeSubtags?.length || 0) > 0 || (filters.excludeSubtags?.length || 0) > 0 ||
    (filters.includeGenres?.length || 0) > 0 || (filters.excludeGenres?.length || 0) > 0 ||
    (filters.includeFeatures?.length || 0) > 0 || (filters.excludeFeatures?.length || 0) > 0 ||
    (filters.includeCommunityTags?.length || 0) > 0 || (filters.excludeCommunityTags?.length || 0) > 0 ||
    (filters.includeDevelopers?.length || 0) > 0 || (filters.excludeDevelopers?.length || 0) > 0 ||
    (filters.includePublishers?.length || 0) > 0 || (filters.excludePublishers?.length || 0) > 0 ||
    filters.untagged || filters.withNotes || filters.hideWishlistOnly;

  const isActive = (name: string, incKey: keyof Filters, excKey: keyof Filters) =>
    ((filters[incKey] as string[]) || []).includes(name) || ((filters[excKey] as string[]) || []).includes(name);

  // Sorted/filtered lists
  const sortSteam = (items: GenreInfo[], countMap: Map<string, number>) =>
    items.map((i) => ({ ...i, dc: countMap.get(i.name) || 0 }))
      .sort((a, b) => steamSort === "count" ? b.dc - a.dc : a.name.localeCompare(b.name));

  const fGenres = useMemo(() => {
    const filtered = q ? genres.filter((g) => g.name.toLowerCase().includes(q)) : genres;
    return sortSteam(filtered, dyn.genreCounts)
      .filter((g) => g.dc > 0 || isActive(g.name, "includeGenres", "excludeGenres"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genres, q, dyn.genreCounts, steamSort, filters.includeGenres, filters.excludeGenres]);

  const fComm = useMemo(() => {
    const filtered = q ? communityTags.filter((t) => t.name.toLowerCase().includes(q)) : communityTags;
    return sortSteam(filtered, dyn.communityTagCounts)
      .filter((c) => c.dc > 0 || isActive(c.name, "includeCommunityTags", "excludeCommunityTags"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityTags, q, dyn.communityTagCounts, steamSort, filters.includeCommunityTags, filters.excludeCommunityTags]);

  const fFeats = useMemo(() => {
    const filtered = q ? features.filter((f) => f.name.toLowerCase().includes(q)) : features;
    return sortSteam(filtered, dyn.featureCounts)
      .filter((f) => f.dc > 0 || isActive(f.name, "includeFeatures", "excludeFeatures"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, q, dyn.featureCounts, steamSort, filters.includeFeatures, filters.excludeFeatures]);

  const devItems = useMemo(() => {
    const items = Array.from(dyn.developerCounts.entries()).map(([name, count]) => ({ name, count, dc: count }));
    const filtered = q ? items.filter((d) => d.name.toLowerCase().includes(q)) : items;
    return filtered
      .filter((d) => d.dc > 0 || isActive(d.name, "includeDevelopers", "excludeDevelopers"))
      .sort((a, b) => steamSort === "count" ? b.dc - a.dc : a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dyn.developerCounts, q, steamSort, filters.includeDevelopers, filters.excludeDevelopers]);

  const pubItems = useMemo(() => {
    const items = Array.from(dyn.publisherCounts.entries()).map(([name, count]) => ({ name, count, dc: count }));
    const filtered = q ? items.filter((p) => p.name.toLowerCase().includes(q)) : items;
    return filtered
      .filter((p) => p.dc > 0 || isActive(p.name, "includePublishers", "excludePublishers"))
      .sort((a, b) => steamSort === "count" ? b.dc - a.dc : a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dyn.publisherCounts, q, steamSort, filters.includePublishers, filters.excludePublishers]);

  // Merged genres + community for tabbed "Genres" tab
  type MergedItem = { name: string; dc: number; kind: "genre" | "community"; inc: boolean; exc: boolean };
  const mergedGenres: MergedItem[] = useMemo(() => {
    const genreItems: MergedItem[] = fGenres.map((g) => ({
      name: g.name, dc: g.dc, kind: "genre" as const,
      inc: (filters.includeGenres || []).includes(g.name),
      exc: (filters.excludeGenres || []).includes(g.name),
    }));
    const commItems: MergedItem[] = fComm.map((c) => ({
      name: c.name, dc: c.dc, kind: "community" as const,
      inc: (filters.includeCommunityTags || []).includes(c.name),
      exc: (filters.excludeCommunityTags || []).includes(c.name),
    }));
    const seen = new Map<string, MergedItem>();
    for (const g of genreItems) seen.set(g.name.toLowerCase(), g);
    const result = [...genreItems];
    for (const c of commItems) {
      if (!seen.has(c.name.toLowerCase())) { result.push(c); seen.set(c.name.toLowerCase(), c); }
    }
    return result.sort((a, b) => steamSort === "count" ? b.dc - a.dc : a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fGenres, fComm, steamSort, filters.includeGenres, filters.excludeGenres, filters.includeCommunityTags, filters.excludeCommunityTags]);

  const allTagsExpanded = sortedTags.length > 0 && sortedTags.every((t) => expandedTagIds.has(t.id) || !(subsByTag.get(t.id)?.length));
  const toggleExpandAll = useCallback(() => {
    setExpandedTagIds(allTagsExpanded ? new Set() : new Set(sortedTags.filter((t) => (subsByTag.get(t.id)?.length || 0) > 0).map((t) => t.id)));
  }, [allTagsExpanded, sortedTags, subsByTag]);

  if (collapsed) {
    return (
      <div className="w-10 bg-surface border-r border-border flex flex-col items-center py-3 shrink-0">
        <button onClick={onToggleCollapse} className="text-muted hover:text-foreground text-lg" title="Expand">&#x25B8;</button>
      </div>
    );
  }

  const clearAll = () => onChange({
    ...filters, includeTags: [], excludeTags: [], includeSubtags: [], excludeSubtags: [],
    includeGenres: [], excludeGenres: [], includeFeatures: [], excludeFeatures: [],
    includeCommunityTags: [], excludeCommunityTags: [],
    includeDevelopers: [], excludeDevelopers: [], includePublishers: [], excludePublishers: [],
    untagged: false, withNotes: false, hideWishlistOnly: false,
  });

  const notOnSteamIds = subtags.filter((s) => s.name === "not_on_steam").map((s) => s.id);

  const resetDefaults = () => onChange({
    ...filters, includeTags: [], excludeTags: [], includeSubtags: [], excludeSubtags: [...notOnSteamIds],
    includeGenres: [], excludeGenres: [], includeFeatures: [], excludeFeatures: [],
    includeCommunityTags: [], excludeCommunityTags: [],
    includeDevelopers: [], excludeDevelopers: [], includePublishers: [], excludePublishers: [],
    untagged: false, withNotes: false, hideWishlistOnly: true, customTagMode: "AND",
  });

  // ─── Shared pieces ───
  const headerBar = (
    <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
      <span className="text-xs font-medium text-muted uppercase tracking-wider">Filters</span>
      <div className="flex gap-1.5 items-center">
        <button onClick={toggleLayout}
          className="text-[9px] px-1 py-0.5 rounded text-muted hover:text-foreground bg-surface2/50"
          title={layout === "tabbed" ? "Switch to classic accordion" : "Switch to tabbed layout"}
        >{layout === "tabbed" ? "☰" : "⊞"}</button>
        <button onClick={() => onChange({ ...filters, filterMode: filters.filterMode === "OR" ? "AND" : "OR" })}
          className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${filters.filterMode === "OR" ? "bg-accent/20 text-accent" : "bg-surface2/50 text-muted"}`}
        >{filters.filterMode === "OR" ? "OR" : "AND"}</button>
        <button onClick={clearAll} className={`text-[10px] text-danger hover:underline ${hasFilters ? "" : "hidden"}`}>Clear</button>
        <button onClick={resetDefaults} className="text-[10px] text-muted hover:text-foreground" title="Reset to defaults">Reset</button>
        <button onClick={onToggleCollapse} className="text-muted hover:text-foreground text-sm">&#x25C2;</button>
      </div>
    </div>
  );

  const searchBar = (
    <div className="px-3 py-1.5 shrink-0">
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter..."
        className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-accent" />
    </div>
  );

  const quickFilters = (
    <div className="px-3 py-0.5 flex flex-col gap-0.5 shrink-0">
      <button onClick={() => onChange({ ...filters, untagged: !filters.untagged })}
        className={`w-full text-left px-2 py-0.5 rounded text-[11px] ${filters.untagged ? "bg-warning/20 text-warning" : "text-muted hover:text-foreground hover:bg-surface2/50"}`}
      >&#x25CB; Untagged only</button>
      <button onClick={() => onChange({ ...filters, withNotes: !filters.withNotes })}
        className={`w-full text-left px-2 py-0.5 rounded text-[11px] ${filters.withNotes ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground hover:bg-surface2/50"}`}
      >📝 With notes</button>
      <button onClick={() => onChange({ ...filters, hideWishlistOnly: !filters.hideWishlistOnly })}
        className={`w-full text-left px-2 py-0.5 rounded text-[11px] ${filters.hideWishlistOnly ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground hover:bg-surface2/50"}`}
      >🎯 Curated only</button>
      {notOnSteamIds.length > 0 && (() => {
        const exc = filters.excludeSubtags || [];
        const allExcluded = notOnSteamIds.every((id) => exc.includes(id));
        return (
          <button onClick={() => {
            if (allExcluded) onChange({ ...filters, excludeSubtags: exc.filter((id) => !notOnSteamIds.includes(id)) });
            else onChange({ ...filters, excludeSubtags: [...exc.filter((id) => !notOnSteamIds.includes(id)), ...notOnSteamIds] });
          }}
            className={`w-full text-left px-2 py-0.5 rounded text-[11px] ${allExcluded ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground hover:bg-surface2/50"}`}
          >🚫 Hide not on Steam</button>
        );
      })()}
    </div>
  );

  // ─── Custom tags panel (shared between both layouts) ───
  const customTagsContent = (
    <div className="px-2 pb-2">
      {sortedTags.filter((tag) => {
        const count = dyn.customTagCounts.get(tag.id) || 0;
        return count > 0 || (filters.includeTags || []).includes(tag.id) || (filters.excludeTags || []).includes(tag.id);
      }).map((tag) => {
        const isInc = (filters.includeTags || []).includes(tag.id);
        const isExc = (filters.excludeTags || []).includes(tag.id);
        const count = dyn.customTagCounts.get(tag.id) || 0;
        const isOpen = expandedTagIds.has(tag.id);
        const subs = subsByTag.get(tag.id) || [];
        const fSubs = (q ? subs.filter((s) => s.name.toLowerCase().includes(q) || tag.name.toLowerCase().includes(q)) : subs)
          .filter((s) => (dyn.subtagCounts.get(s.id) || 0) > 0 || (filters.includeSubtags || []).includes(s.id) || (filters.excludeSubtags || []).includes(s.id));
        return (
          <div key={tag.id}>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors hover:bg-surface2/50"
              onClick={() => toggleIncTag(tag.id)}
              onContextMenu={(e) => { e.preventDefault(); toggleExcTag(tag.id); }}
              style={{
                backgroundColor: isInc ? tag.color + "15" : isExc ? "#ef444415" : undefined,
                borderLeft: isInc ? `3px solid ${tag.color}` : isExc ? "3px solid #ef4444" : "3px solid transparent",
              }}
              title="Click=include, Right-click=exclude"
            >
              {subs.length > 0 && (
                <button onClick={(e) => { e.stopPropagation(); setExpandedTagIds(prev => { const n = new Set(prev); if (n.has(tag.id)) n.delete(tag.id); else n.add(tag.id); return n; }); }}
                  className="text-[10px] text-muted hover:text-foreground w-3 shrink-0"
                >{isOpen ? "\u25BE" : "\u25B8"}</button>
              )}
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
              <span className="flex-1 truncate" style={{
                color: isExc ? "#ef4444" : isInc ? tag.color : undefined,
                textDecoration: isExc ? "line-through" : undefined,
              }}>{tag.name}</span>
              <span className="text-[10px] text-muted">{count}</span>
            </div>
            {isOpen && fSubs.length > 0 && (() => {
              const genreSubs = fSubs.filter((s) => s.type === "genre");
              const metaSubs = fSubs.filter((s) => s.type === "meta");
              return (
                <div className="ml-5 mr-1 mb-1 grid grid-cols-2 gap-x-1">
                  <div>
                    {genreSubs.length > 0 && <div className="text-[8px] uppercase tracking-wider text-indigo-400 px-1 pt-0.5 pb-0.5 font-medium">genre</div>}
                    {genreSubs.map((sub) => <SubItem key={sub.id} sub={sub} count={dyn.subtagCounts.get(sub.id) || 0} accent="#818cf8" inc={(filters.includeSubtags || []).includes(sub.id)} exc={(filters.excludeSubtags || []).includes(sub.id)} onInc={() => toggleIncSub(sub.id)} onExc={() => toggleExcSub(sub.id)} />)}
                  </div>
                  <div>
                    {metaSubs.length > 0 && <div className="text-[8px] uppercase tracking-wider text-amber-400 px-1 pt-0.5 pb-0.5 font-medium">meta</div>}
                    {metaSubs.map((sub) => <SubItem key={sub.id} sub={sub} count={dyn.subtagCounts.get(sub.id) || 0} accent="#f59e0b" inc={(filters.includeSubtags || []).includes(sub.id)} exc={(filters.excludeSubtags || []).includes(sub.id)} onInc={() => toggleIncSub(sub.id)} onExc={() => toggleExcSub(sub.id)} />)}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );

  // ═══════════════════════════════════════════
  // CLASSIC ACCORDION LAYOUT
  // ═══════════════════════════════════════════
  if (layout === "classic") {
    return (
      <div className="bg-surface border-r border-border flex flex-col shrink-0 overflow-hidden" style={{ width }}>
        {headerBar}
        {searchBar}
        <div className="flex-1 overflow-y-auto">
          {quickFilters}

          <AccordionSection title={`Steam Genres (${fGenres.length})`} open={genresOpen} onToggle={() => setGenresOpen(!genresOpen)}
            sort={steamSort} onSort={() => setSteamSort(steamSort === "count" ? "alpha" : "count")}>
            {fGenres.map((g) => (
              <StrItem key={g.name} name={g.name} count={g.dc}
                inc={(filters.includeGenres || []).includes(g.name)} exc={(filters.excludeGenres || []).includes(g.name)}
                hi={TOP_GENRES.has(g.name)}
                onInc={() => toggleStr("includeGenres", "excludeGenres", g.name, "include")}
                onExc={() => toggleStr("includeGenres", "excludeGenres", g.name, "exclude")} />
            ))}
          </AccordionSection>

          <AccordionSection title={`Features (${fFeats.length})`} open={featuresOpen} onToggle={() => setFeaturesOpen(!featuresOpen)}
            sort={steamSort} onSort={() => setSteamSort(steamSort === "count" ? "alpha" : "count")}>
            {fFeats.map((f) => (
              <StrItem key={f.name} name={f.name} count={f.dc}
                inc={(filters.includeFeatures || []).includes(f.name)} exc={(filters.excludeFeatures || []).includes(f.name)}
                onInc={() => toggleStr("includeFeatures", "excludeFeatures", f.name, "include")}
                onExc={() => toggleStr("includeFeatures", "excludeFeatures", f.name, "exclude")} />
            ))}
          </AccordionSection>

          <AccordionSection title={`Community (${fComm.length})`} open={communityOpen} onToggle={() => setCommunityOpen(!communityOpen)}
            sort={steamSort} onSort={() => setSteamSort(steamSort === "count" ? "alpha" : "count")}>
            {fComm.length > 0 ? fComm.map((c) => (
              <StrItem key={c.name} name={c.name} count={c.dc}
                inc={(filters.includeCommunityTags || []).includes(c.name)} exc={(filters.excludeCommunityTags || []).includes(c.name)}
                onInc={() => toggleStr("includeCommunityTags", "excludeCommunityTags", c.name, "include")}
                onExc={() => toggleStr("includeCommunityTags", "excludeCommunityTags", c.name, "exclude")} />
            )) : <div className="px-2 py-2 text-[9px] text-muted text-center italic">Run warmup to fetch</div>}
          </AccordionSection>

          <AccordionSection title={`Developers (${devItems.length})`} open={devsOpen} onToggle={() => setDevsOpen(!devsOpen)}
            sort={steamSort} onSort={() => setSteamSort(steamSort === "count" ? "alpha" : "count")}>
            {devItems.map((d) => (
              <StrItem key={d.name} name={d.name} count={d.dc}
                inc={(filters.includeDevelopers || []).includes(d.name)} exc={(filters.excludeDevelopers || []).includes(d.name)}
                onInc={() => toggleStr("includeDevelopers", "excludeDevelopers", d.name, "include")}
                onExc={() => toggleStr("includeDevelopers", "excludeDevelopers", d.name, "exclude")} />
            ))}
          </AccordionSection>

          <AccordionSection title={`Publishers (${pubItems.length})`} open={pubsOpen} onToggle={() => setPubsOpen(!pubsOpen)}
            sort={steamSort} onSort={() => setSteamSort(steamSort === "count" ? "alpha" : "count")}>
            {pubItems.map((p) => (
              <StrItem key={p.name} name={p.name} count={p.dc}
                inc={(filters.includePublishers || []).includes(p.name)} exc={(filters.excludePublishers || []).includes(p.name)}
                onInc={() => toggleStr("includePublishers", "excludePublishers", p.name, "include")}
                onExc={() => toggleStr("includePublishers", "excludePublishers", p.name, "exclude")} />
            ))}
          </AccordionSection>

          {/* Custom Tags */}
          <div className="mt-0.5">
            <div className="px-3 py-1 flex items-center justify-between cursor-pointer hover:bg-surface2/30" onClick={() => setTagsOpen(!tagsOpen)}>
              <span className="text-[9px] uppercase tracking-wider text-muted font-medium">
                {tagsOpen ? "\u25BE" : "\u25B8"} Custom Tags ({tags.length})
              </span>
              <div className="flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); toggleExpandAll(); }}
                  className="text-[9px] px-1 py-0 rounded text-muted hover:text-foreground"
                  title={allTagsExpanded ? "Collapse all" : "Expand all"}
                >{allTagsExpanded ? "⊟" : "⊞"}</button>
                <button onClick={(e) => { e.stopPropagation(); onChange({ ...filters, customTagMode: filters.customTagMode === "OR" ? "AND" : "OR" }); }}
                  className={`text-[9px] px-1 py-0 rounded font-bold ${filters.customTagMode === "OR" ? "bg-accent/20 text-accent" : "bg-surface2/50 text-muted"}`}
                  title="AND = must match all, OR = match any"
                >{filters.customTagMode === "OR" ? "OR" : "AND"}</button>
              </div>
            </div>
            {tagsOpen && customTagsContent}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // TABBED LAYOUT (with resizable split)
  // ═══════════════════════════════════════════
  const tabCounts = {
    genres: mergedGenres.length,
    features: fFeats.length,
    devpub: devItems.length + pubItems.length,
  };

  return (
    <div className="bg-surface border-r border-border flex flex-col shrink-0 overflow-hidden" style={{ width }}>
      {headerBar}
      {searchBar}
      {quickFilters}

      {/* Resizable split container */}
      <div ref={splitContainerRef} className="flex flex-col flex-1 min-h-0">
        {/* ─── Upper: Steam tabs ─── */}
        <div className="flex flex-col min-h-0" style={{ height: `${splitPct}%` }}>
          <div className="flex items-center border-y border-border shrink-0">
            {(["genres", "features", "devpub"] as SteamTab[]).map((tab) => (
              <button key={tab} onClick={() => setSteamTab(tab)}
                className={`flex-1 text-[9px] uppercase tracking-wider py-1.5 transition-colors ${
                  steamTab === tab ? "text-accent border-b-2 border-accent bg-accent/5" : "text-muted hover:text-foreground"
                }`}
              >
                {tab === "genres" ? `Genres ${tabCounts.genres}` : tab === "features" ? `Feats ${tabCounts.features}` : `Dev/Pub`}
              </button>
            ))}
            <button onClick={() => setSteamSort(steamSort === "count" ? "alpha" : "count")}
              className="text-[9px] text-muted hover:text-foreground px-1.5 shrink-0 border-l border-border"
            >{steamSort === "count" ? "#↓" : "Az"}</button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {steamTab === "genres" && (
              <div className="px-2 py-1 space-y-0.5">
                {mergedGenres.length > 0 ? mergedGenres.map((item) => (
                  <SteamTagItem key={`${item.kind}-${item.name}`} name={item.name} count={item.dc}
                    kind={item.kind} inc={item.inc} exc={item.exc}
                    hi={TOP_GENRES.has(item.name)}
                    onInc={() => item.kind === "genre"
                      ? toggleStr("includeGenres", "excludeGenres", item.name, "include")
                      : toggleStr("includeCommunityTags", "excludeCommunityTags", item.name, "include")}
                    onExc={() => item.kind === "genre"
                      ? toggleStr("includeGenres", "excludeGenres", item.name, "exclude")
                      : toggleStr("includeCommunityTags", "excludeCommunityTags", item.name, "exclude")} />
                )) : <div className="px-2 py-3 text-[9px] text-muted text-center italic">No genres found</div>}
              </div>
            )}

            {steamTab === "features" && (
              <div className="px-2 py-1 space-y-0.5">
                {fFeats.map((f) => (
                  <StrItem key={f.name} name={f.name} count={f.dc}
                    inc={(filters.includeFeatures || []).includes(f.name)}
                    exc={(filters.excludeFeatures || []).includes(f.name)}
                    onInc={() => toggleStr("includeFeatures", "excludeFeatures", f.name, "include")}
                    onExc={() => toggleStr("includeFeatures", "excludeFeatures", f.name, "exclude")} />
                ))}
              </div>
            )}

            {steamTab === "devpub" && (
              <div className="grid grid-cols-2 gap-x-0.5 px-1 py-1">
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-cyan-400 px-1.5 py-0.5 font-medium sticky top-0 bg-surface z-10">Dev ({devItems.length})</div>
                  <div className="space-y-0.5">
                    {devItems.map((d) => (
                      <StrItem key={d.name} name={d.name} count={d.dc} small
                        inc={(filters.includeDevelopers || []).includes(d.name)}
                        exc={(filters.excludeDevelopers || []).includes(d.name)}
                        onInc={() => toggleStr("includeDevelopers", "excludeDevelopers", d.name, "include")}
                        onExc={() => toggleStr("includeDevelopers", "excludeDevelopers", d.name, "exclude")} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-orange-400 px-1.5 py-0.5 font-medium sticky top-0 bg-surface z-10">Pub ({pubItems.length})</div>
                  <div className="space-y-0.5">
                    {pubItems.map((p) => (
                      <StrItem key={p.name} name={p.name} count={p.dc} small
                        inc={(filters.includePublishers || []).includes(p.name)}
                        exc={(filters.excludePublishers || []).includes(p.name)}
                        onInc={() => toggleStr("includePublishers", "excludePublishers", p.name, "include")}
                        onExc={() => toggleStr("includePublishers", "excludePublishers", p.name, "exclude")} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Drag handle ─── */}
        <div className="h-1.5 shrink-0 cursor-row-resize flex items-center justify-center hover:bg-accent/20 active:bg-accent/30 transition-colors group"
          onMouseDown={onDragStart}>
          <div className="w-8 h-0.5 rounded bg-border group-hover:bg-accent/50 transition-colors" />
        </div>

        {/* ─── Lower: Custom Tags ─── */}
        <div className="flex flex-col min-h-0" style={{ height: `${100 - splitPct}%` }}>
          <div className="px-3 py-1 flex items-center justify-between shrink-0 border-t border-border">
            <span className="text-[9px] uppercase tracking-wider text-muted font-medium">Custom Tags ({tags.length})</span>
            <div className="flex items-center gap-1">
              <button onClick={toggleExpandAll}
                className="text-[9px] px-1 py-0 rounded text-muted hover:text-foreground"
                title={allTagsExpanded ? "Collapse all" : "Expand all"}
              >{allTagsExpanded ? "⊟" : "⊞"}</button>
              <button onClick={() => onChange({ ...filters, customTagMode: filters.customTagMode === "OR" ? "AND" : "OR" })}
                className={`text-[9px] px-1 py-0 rounded font-bold ${filters.customTagMode === "OR" ? "bg-accent/20 text-accent" : "bg-surface2/50 text-muted"}`}
                title="AND = must match all, OR = match any"
              >{filters.customTagMode === "OR" ? "OR" : "AND"}</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {customTagsContent}
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Helper components ───

function AccordionSection({ title, open, onToggle, sort, onSort, children }: {
  title: string; open: boolean; onToggle: () => void;
  sort: SortMode; onSort: () => void; children: React.ReactNode;
}) {
  return (
    <div className="mt-0.5">
      <div className="px-3 py-1 flex items-center justify-between cursor-pointer hover:bg-surface2/30" onClick={onToggle}>
        <span className="text-[9px] uppercase tracking-wider text-muted font-medium">
          {open ? "\u25BE" : "\u25B8"} {title}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onSort(); }}
          className="text-[9px] text-muted hover:text-foreground"
        >{sort === "count" ? "#\u2193" : "Az"}</button>
      </div>
      {open && <div className="px-2 py-0.5 space-y-0.5 max-h-[40vh] overflow-y-auto">{children}</div>}
    </div>
  );
}

function SteamTagItem({ name, count, kind, inc, exc, hi, onInc, onExc }: {
  name: string; count: number; kind: "genre" | "community"; inc: boolean; exc: boolean; hi?: boolean;
  onInc: () => void; onExc: () => void;
}) {
  const accent = kind === "genre" ? "#2dd4bf" : "#818cf8";
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors hover:bg-surface2/50"
      onClick={onInc} onContextMenu={(e) => { e.preventDefault(); onExc(); }}
      style={{
        backgroundColor: inc ? accent + "15" : exc ? "#ef444415" : undefined,
        borderLeft: inc ? `3px solid ${accent}` : exc ? "3px solid #ef4444" : "3px solid transparent",
      }}
      title={`${kind === "genre" ? "Steam genre" : "Community tag"} · Click=include, Right-click=exclude`}
    >
      {kind === "genre" && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-teal-400/60" />}
      <span className={`flex-1 truncate ${hi && !inc && !exc ? "text-foreground font-medium" : ""}`}
        style={{ color: exc ? "#ef4444" : inc ? accent : undefined, textDecoration: exc ? "line-through" : undefined }}
      >{name}</span>
      <span className="text-[10px] text-muted">{count}</span>
    </div>
  );
}

function SubItem({ sub, count, accent, inc, exc, onInc, onExc }: {
  sub: Subtag; count: number; accent: string; inc: boolean; exc: boolean;
  onInc: () => void; onExc: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] cursor-pointer transition-colors hover:bg-surface2/50"
      onClick={onInc} onContextMenu={(e) => { e.preventDefault(); onExc(); }}
      style={{
        backgroundColor: inc ? accent + "15" : exc ? "#ef444415" : undefined,
        borderLeft: inc ? `2px solid ${accent}` : exc ? "2px solid #ef4444" : "2px solid transparent",
      }}
      title="Click=include, Right-click=exclude"
    >
      <span className="flex-1 truncate" style={{
        color: exc ? "#ef4444" : inc ? accent : undefined,
        textDecoration: exc ? "line-through" : undefined,
      }}>{sub.name}</span>
      <span className="text-[9px] text-muted">{count}</span>
    </div>
  );
}

function StrItem({ name, count, inc, exc, hi, small, onInc, onExc }: {
  name: string; count: number; inc: boolean; exc: boolean; hi?: boolean; small?: boolean;
  onInc: () => void; onExc: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition-colors hover:bg-surface2/50 ${small ? "text-[10px]" : "text-[11px]"}`}
      onClick={onInc} onContextMenu={(e) => { e.preventDefault(); onExc(); }}
      style={{
        backgroundColor: inc ? "#6366f115" : exc ? "#ef444415" : undefined,
        borderLeft: inc ? "3px solid #6366f1" : exc ? "3px solid #ef4444" : "3px solid transparent",
      }}
      title="Click=include, Right-click=exclude"
    >
      <span className={`flex-1 truncate ${hi && !inc && !exc ? "text-foreground font-medium" : ""}`}
        style={{ color: exc ? "#ef4444" : inc ? "#818cf8" : undefined, textDecoration: exc ? "line-through" : undefined }}
      >{name}</span>
      <span className={`text-muted ${small ? "text-[8px]" : "text-[10px]"}`}>{count}</span>
    </div>
  );
}
