"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTags, useGames, useGenres, useSubtags, Filters } from "@/lib/hooks";
import { GameWithTags, Tag, Subtag, COLOR_PRESETS, TintColors } from "@/lib/types";
import Sidebar from "@/components/Sidebar";
import GameCard from "@/components/GameCard";
import GameTable from "@/components/GameTable";
import Inspector, { SteamPreview } from "@/components/Inspector";
import EditModal from "@/components/EditModal";
import ClipboardPiP from "@/components/ClipboardPiP";

function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

interface SteamResult {
  appid: number;
  name: string;
  image: string;
}

export default function Home() {
  const { tags } = useTags();
  const { subtags } = useSubtags();
  const { games, allGames, totalCount, loading, filters, setFilters, addGame, updateGame, deleteGame, allAppIds } = useGames();
  const { genres, features, communityTags } = useGenres();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const sidebarDragging = useRef(false);
  const [selectedGame, setSelectedGame] = useState<GameWithTags | null>(null);
  const [inspectorGame, setInspectorGame] = useState<GameWithTags | null>(null);
  const lastSelectedIdRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingGame, setEditingGame] = useState<GameWithTags | null>(null);
  const [similarStack, setSimilarStack] = useState<GameWithTags[]>([]);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [cardCols, setCardCols] = useState(6);
  const [slideshow, setSlideshow] = useState(false);
  const [slideSpeed, setSlideSpeed] = useState(1);
  const [clipboardSync, setClipboardSync] = useState(false);
  const [pageFocused, setPageFocused] = useState(true);
  const [defaultImage, setDefaultImage] = useState("header");
  const [genresCount, setGenresCount] = useState(3);
  const [communityTagsCount, setCommunityTagsCount] = useState(4);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [colorCoded, setColorCoded] = useState(false);
  const [scoreSource, setScoreSource] = useState<"steam" | "steamdb">("steamdb");
  const [tintColors, setTintColors] = useState<TintColors | null>(null);

  // Keep inspectorGame / selectedGame in sync when games array refreshes
  // Only update if the game data actually changed (compare by relevant fields, not reference)
  useEffect(() => {
    if (inspectorGame) {
      const fresh = games.find((g) => g.id === inspectorGame.id);
      if (fresh && fresh !== inspectorGame) {
        // Only set if data actually differs — avoid re-render from mere reference change
        const changed = fresh.name !== inspectorGame.name ||
          fresh.description !== inspectorGame.description ||
          fresh.positive_percent !== inspectorGame.positive_percent ||
          fresh.total_reviews !== inspectorGame.total_reviews ||
          fresh.steam_genres !== inspectorGame.steam_genres ||
          fresh.steam_features !== inspectorGame.steam_features ||
          fresh.community_tags !== inspectorGame.community_tags ||
          fresh.screenshots !== inspectorGame.screenshots ||
          fresh.movies !== inspectorGame.movies ||
          fresh.tags !== inspectorGame.tags ||
          fresh.notes !== inspectorGame.notes ||
          fresh.total_screenshots !== inspectorGame.total_screenshots ||
          fresh.total_movies !== inspectorGame.total_movies;
        if (changed) setInspectorGame(fresh);
      }
    }
    if (selectedGame) {
      const fresh = games.find((g) => g.id === selectedGame.id);
      if (fresh && fresh !== selectedGame) setSelectedGame(fresh);
    }
  }, [games]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate persisted prefs after mount (avoids SSR hydration mismatch)
  const hydratedRef = useRef(false);
  useEffect(() => {
    setSidebarCollapsed(loadPref("gm_sidebar", false));
    setSidebarWidth(loadPref("gm_sidebar_width", 256));
    setView(loadPref("gm_view", "cards"));
    setCardCols(loadPref("gm_cols", 6));
    hydratedRef.current = true;
  }, []);

  // Track page focus
  useEffect(() => {
    const onFocus = () => setPageFocused(true);
    const onBlur = () => setPageFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur); };
  }, []);

  // Load settings
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s: Record<string, string>) => {
      if (s.slideshow_speed) setSlideSpeed(Number(s.slideshow_speed));
      if (s.card_default_image) setDefaultImage(s.card_default_image);
      if (s.card_genres_count) setGenresCount(Number(s.card_genres_count));
      if (s.card_community_tags_count) setCommunityTagsCount(Number(s.card_community_tags_count));
      if (s.score_source === "steam") setScoreSource("steam");
      if (s.color_coded === "1") {
        setColorCoded(true);
        const preset = s.color_preset || "subtle";
        if (preset === "custom") {
          setTintColors({
            high: s.color_custom_high || "#22c55e",
            mid: s.color_custom_mid || "#f59e0b",
            low: s.color_custom_low || "#ef4444",
            opacity: parseFloat(s.color_opacity || "0.08"),
          });
        } else {
          setTintColors(COLOR_PRESETS[preset] || COLOR_PRESETS.subtle);
        }
      }
    });
  }, []);

  useEffect(() => { fetch("/api/network").then(r => r.json()).then(d => setLanIps(d.ips || [])).catch(() => {}); }, []);

  // Scroll position: save on scroll, show back-to-top
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      setShowScrollTop(el.scrollTop > 400);
      clearTimeout(timer);
      timer = setTimeout(() => sessionStorage.setItem("gm_scroll", String(el.scrollTop)), 200);
    };
    el.addEventListener("scroll", onScroll);
    return () => { el.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, []);

  // Scroll position: restore AFTER games load and render
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const el = scrollRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem("gm_scroll");
    if (!saved) return;
    const pos = Number(saved);
    if (pos <= 0) return;
    // Wait two frames for DOM to paint the cards
    requestAnimationFrame(() => requestAnimationFrame(() => { el.scrollTop = pos; }));
  }, [loading]);

  // Pagination
  const PAGE_SIZE = 40;
  const [displayLimit, setDisplayLimit] = useState(() => {
    if (typeof window === "undefined") return 40;
    const saved = sessionStorage.getItem("gm_display_limit");
    return saved ? Math.max(40, Number(saved)) : 40;
  });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const displayedGames = games.slice(0, displayLimit);

  // Reset pagination when filters change (skip initial mount to preserve restored limit)
  const filterInitRef = useRef(true);
  useEffect(() => {
    if (filterInitRef.current) { filterInitRef.current = false; return; }
    setDisplayLimit(PAGE_SIZE);
    sessionStorage.removeItem("gm_scroll");
    sessionStorage.removeItem("gm_display_limit");
    scrollRestoredRef.current = true; // don't restore after a filter change
  }, [filters]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && displayLimit < games.length) {
        setDisplayLimit((prev) => {
          const next = Math.min(prev + PAGE_SIZE, games.length);
          sessionStorage.setItem("gm_display_limit", String(next));
          return next;
        });
      }
    }, { root, rootMargin: "200px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayLimit, games.length]);

  // Unified search state
  const [searchQuery, setSearchQuery] = useState("");
  const [steamResults, setSteamResults] = useState<SteamResult[]>([]);
  const [steamLoading, setSteamLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  // Persist prefs (skip initial mount to avoid overwriting saved values)
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_view", JSON.stringify(view)); }, [view]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_cols", JSON.stringify(cardCols)); }, [cardCols]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_sidebar", JSON.stringify(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { if (hydratedRef.current) localStorage.setItem("gm_sidebar_width", JSON.stringify(sidebarWidth)); }, [sidebarWidth]);

  // When switching views, scroll to the same game that was at the top
  const viewInitRef = useRef(true);
  useEffect(() => {
    if (viewInitRef.current) { viewInitRef.current = false; return; }
    const container = scrollRef.current;
    if (!container) return;

    // Find the game-id that was at the top of the viewport before React re-renders
    // We stored it in a ref on the previous render cycle
    const targetId = topGameIdRef.current;
    if (!targetId) { container.scrollTop = 0; return; }

    // After React paints the new view, scroll to that game
    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-game-id="${targetId}"]`);
      if (el) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        container.scrollTop += elRect.top - containerRect.top;
      } else {
        container.scrollTop = 0;
      }
    });
  }, [view]);

  // Track which game is at the top of the scroll viewport
  const topGameIdRef = useRef<number | null>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let raf: number;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        // Sample a point slightly below the top of the container
        const els = container.querySelectorAll("[data-game-id]");
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.bottom > rect.top + 10) {
            topGameIdRef.current = Number(el.getAttribute("data-game-id"));
            break;
          }
        }
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // capture initial
    return () => { container.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Sidebar resize drag handler
  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragging.current) return;
      setSidebarWidth(Math.min(480, Math.max(180, ev.clientX)));
    };
    const onUp = () => {
      sidebarDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Auto-exclude not_on_steam subtags for first-time users
  useEffect(() => {
    if (subtags.length === 0) return;
    const seeded = localStorage.getItem("gm_not_on_steam_seeded");
    if (seeded) return;
    const notOnSteamIds = subtags.filter((s) => s.name === "not_on_steam").map((s) => s.id);
    const exc = filters.excludeSubtags || [];
    const missing = notOnSteamIds.filter((id) => !exc.includes(id));
    if (missing.length > 0) {
      setFilters({ ...filters, excludeSubtags: [...exc, ...missing] });
    }
    localStorage.setItem("gm_not_on_steam_seeded", "1");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtags]);

  // Tag filter toggles (shared by sidebar + card pills)
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
  const closeInspector = useCallback(() => { setSimilarStack([]); setInspectorGame(null); }, []);

  // Debounced Steam search when in search mode
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSteamResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSteamLoading(true);
      try {
        const res = await fetch(`/api/steam/search?name=${encodeURIComponent(searchQuery.trim())}`);
        const data = await res.json();
        setSteamResults(Array.isArray(data) ? data : []);
      } catch { setSteamResults([]); }
      setSteamLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync search query to filters (for DB filtering)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({ ...filters, search: searchQuery || undefined });
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;

      // Escape from search box: clear search text and blur
      if (e.key === "Escape" && e.target === searchRef.current) {
        setSearchQuery("");
        searchRef.current?.blur();
        return;
      }

      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Auto-focus search on printable key
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        searchRef.current?.focus();
        return; // let the input handle the keystroke
      }

      if (e.key === "Escape") {
        if (editingGame) setEditingGame(null);
        else if (similarStack.length > 0) setSimilarStack((s) => s.slice(0, -1));
        else if (inspectorGame) setInspectorGame(null);
        else if (selectedGame) setSelectedGame(null);
        else { searchRef.current?.focus(); }
        return;
      }
      // Enter/Space opens inspector for highlighted game
      if ((e.key === "Enter" || e.key === " ") && selectedGame && !inspectorGame) {
        e.preventDefault();
        setInspectorGame(selectedGame);
        return;
      }
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      if (document.querySelector("[data-lightbox]")) return;
      if (view !== "cards") return;
      e.preventDefault();
      const grid = document.querySelector(".game-grid-container");
      let cols = 6;
      if (grid) {
        const templateCols = getComputedStyle(grid).getPropertyValue("grid-template-columns");
        cols = templateCols ? templateCols.split(" ").length : 6;
      }
      if (!selectedGame) {
        const lastIdx = lastSelectedIdRef.current
          ? displayedGames.findIndex((g) => g.id === lastSelectedIdRef.current)
          : -1;
        const resumeIdx = lastIdx >= 0 ? lastIdx : 0;
        const resumeGame = displayedGames[resumeIdx];
        setSelectedGame(resumeGame);
        lastSelectedIdRef.current = resumeGame.id;
        return;
      }
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
      // Expand display limit when near the edge
      if (e.key === "ArrowDown" && idx + cols * 2 >= displayedGames.length && displayLimit < games.length) {
        setDisplayLimit((prev) => Math.min(prev + PAGE_SIZE, games.length));
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [selectedGame, inspectorGame, editingGame, similarStack, games, view]);

  // Click toggles inspector popup (and highlights)
  const handleSelectGame = (game: GameWithTags) => {
    if (inspectorGame?.id === game.id) {
      setInspectorGame(null);
    } else {
      setInspectorGame(game);
      setSelectedGame(game);
    }
    lastSelectedIdRef.current = game.id;
  };

  const existingAppIds = allAppIds;

  const handleAddFromSteam = useCallback(async (result: SteamResult) => {
    setAdding(true);
    try {
      const data = await addGame({
        name: result.name,
        steam_appid: result.appid,
      });
      setSteamResults((prev) => prev.filter((r) => r.appid !== result.appid));
      const gameId = data.games?.[0]?.id;
      if (!gameId) return;
      // Open modal immediately with basic data
      setEditingGame({
        id: gameId, name: result.name, steam_appid: result.appid,
        notes: "", description: "", steam_genres: "[]", steam_features: "[]",
        community_tags: "[]", developers: "", publishers: "", release_date: "",
        screenshots: "[]", movies: "[]", tags: data.games?.[0]?.tags || [],
      } as GameWithTags);
      // Fetch metadata in background, then refresh modal data
      if (result.appid) {
        fetch(`/api/games/${gameId}/fetch-metadata`, { method: "POST" }).then(async () => {
          try {
            const freshRes = await fetch(`/api/games/${gameId}`);
            if (freshRes.ok) {
              const freshGame = await freshRes.json();
              setEditingGame((prev) => prev?.id === gameId ? freshGame : prev);
            }
          } catch { /* ignore */ }
        }).catch(() => {});
      }
    } finally { setAdding(false); }
  }, [addGame]);

  const handleAddManual = useCallback(async (tagId?: number, subtagId?: number | null) => {
    if (!searchQuery.trim()) return;
    setAdding(true);
    try {
      const data = await addGame({
        name: searchQuery.trim(),
        tag_id: tagId,
        subtag_id: subtagId,
      });
      const gameId = data.games?.[0]?.id;
      if (gameId) {
        try {
          const freshRes = await fetch(`/api/games/${gameId}`);
          if (freshRes.ok) { setEditingGame(await freshRes.json()); }
        } catch {
          setEditingGame({
            id: gameId, name: searchQuery.trim(), steam_appid: null,
            notes: "", description: "", steam_genres: "[]", steam_features: "[]",
            community_tags: "[]", developers: "", publishers: "", release_date: "",
            review_sentiment: "", positive_percent: 0, total_reviews: 0,
            metacritic_score: 0, screenshots: "[]", movies: "[]",
            total_screenshots: 0, total_movies: 0,
            steam_image_url: null, wishlist_date: null,
            added_at: new Date().toISOString().split("T")[0],
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            tags: [],
          });
        }
      }
    } finally { setAdding(false); }
  }, [addGame, searchQuery]);

  const isSearching = searchQuery.trim().length >= 2;
  const isFiltered = (filters.includeTags?.length || 0) > 0 ||
    (filters.excludeTags?.length || 0) > 0 ||
    (filters.includeSubtags?.length || 0) > 0 ||
    (filters.excludeSubtags?.length || 0) > 0 ||
    (filters.includeGenres?.length || 0) > 0 ||
    (filters.excludeGenres?.length || 0) > 0 ||
    (filters.includeFeatures?.length || 0) > 0 ||
    (filters.excludeFeatures?.length || 0) > 0 ||
    (filters.includeCommunityTags?.length || 0) > 0 ||
    (filters.excludeCommunityTags?.length || 0) > 0 ||
    (filters.includeDevelopers?.length || 0) > 0 ||
    (filters.excludeDevelopers?.length || 0) > 0 ||
    (filters.includePublishers?.length || 0) > 0 ||
    (filters.excludePublishers?.length || 0) > 0 ||
    filters.untagged || filters.withNotes || filters.hideWishlistOnly || isSearching;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        tags={tags} subtags={subtags} genres={genres} features={features} communityTags={communityTags}
        games={games} filters={filters} onChange={setFilters}
        collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        width={sidebarWidth}
      />
      {!sidebarCollapsed && (
        <div className="w-1.5 shrink-0 cursor-col-resize flex items-center justify-center hover:bg-accent/20 active:bg-accent/30 transition-colors group"
          onMouseDown={onSidebarDragStart}>
          <div className="w-0.5 h-8 rounded bg-border group-hover:bg-accent/50 transition-colors" />
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0">
          <h1 className="text-sm font-semibold mr-2">🎮 Games</h1>

          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search... (note: dev: appid:)"
            className="flex-1 max-w-lg bg-background border border-border rounded px-3 py-1 text-sm focus:outline-none focus:border-accent"
          />

          {/* Tag selector removed — each search result row has its own */}

          <select
            value={filters.sort || "name"}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value, sorts: [{ key: e.target.value, dir: filters.dir || "asc" }] })}
            className="bg-background border border-border rounded px-2 py-1 text-xs">
            <option value="name">Name</option>
            <option value="tag">Tag</option>
            <option value="genre">Genre</option>
            <option value="community_tag">Community Tag</option>
            <option value="rating">Rating</option>
            <option value="steamdb">SteamDB</option>
            <option value="reviews">Reviews</option>
            <option value="metacritic">Metacritic</option>
            <option value="sentiment">Sentiment</option>
            <option value="release_date">Release</option>
            <option value="wishlist_date">Wishlist Date</option>
            <option value="added_at">Added</option>
          </select>
          <button
            onClick={() => {
              const newDir = filters.dir === "desc" ? "asc" : "desc";
              const newSorts = (filters.sorts || []).map(s => ({ ...s, dir: newDir as "asc" | "desc" }));
              setFilters({ ...filters, dir: newDir as "asc" | "desc", sorts: newSorts.length > 0 ? newSorts : undefined });
            }}
            className="bg-background border border-border rounded px-2 py-1 text-xs text-muted hover:text-foreground"
            title={filters.dir === "desc" ? "Descending" : "Ascending"}
          >{filters.dir === "desc" ? "↓" : "↑"}</button>

          <div className="flex gap-0.5 bg-background rounded border border-border">
            <button onClick={() => setView("cards")}
              className={`px-2 py-1 text-xs rounded-l ${view === "cards" ? "bg-accent text-white" : "text-muted"}`}>&#x25A6;</button>
            <button onClick={() => setView("table")}
              className={`px-2 py-1 text-xs rounded-r ${view === "table" ? "bg-accent text-white" : "text-muted"}`}>&#x2630;</button>
          </div>

          <button
            onClick={() => setSlideshow(!slideshow)}
            className={`px-2 py-1 text-xs rounded border ${slideshow ? "bg-accent/20 border-accent text-accent" : "bg-background border-border text-muted"}`}
            title={`Slideshow ${slideshow ? "on" : "off"} (${slideSpeed}s)`}
          >▶</button>
          {view === "cards" && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setCardCols(Math.min(8, cardCols + 1))} className="text-muted hover:text-foreground px-1 text-[8px]" title="Smaller cards">●</button>
              <input type="range" min={2} max={8} value={9 - cardCols} onChange={(e) => setCardCols(9 - Number(e.target.value))}
                className="w-16 accent-accent" title={`${cardCols} columns`} />
              <button onClick={() => setCardCols(Math.max(2, cardCols - 1))} className="text-muted hover:text-foreground px-1 text-base" title="Bigger cards">●</button>
            </div>
          )}

          <span className="text-xs text-muted">
            {isFiltered ? `${games.length}/${totalCount}` : `${totalCount}`} games
            {displayLimit < games.length && (
              <button
                onClick={() => { setDisplayLimit(games.length); sessionStorage.setItem("gm_display_limit", String(games.length)); }}
                className="ml-1.5 px-1.5 py-0.5 rounded border border-border hover:text-foreground hover:border-accent transition-colors"
              >Load all ({games.length})</button>
            )}
          </span>

          <button
            onClick={() => {
              window.open("/clipboard", "clipboard_sync", "width=500,height=300,top=100,right=0,resizable=yes,scrollbars=no");
            }}
            className="px-2 py-1 text-xs rounded border bg-background border-border text-muted hover:text-foreground"
            title="Open clipboard popup window"
          >📋</button>
          <button
            onClick={() => setClipboardSync(!clipboardSync)}
            className={`px-2 py-1 text-xs rounded border ${clipboardSync ? "bg-green-500/20 border-green-500 text-green-400" : "bg-background border-border text-muted"}`}
            title={`PiP clipboard ${clipboardSync ? "on" : "off"}`}
          >🖼</button>

          {lanIps.length > 0 && <span className="text-[10px] text-muted">{lanIps[0]}:3000</span>}
          <a href="/settings" className="text-xs text-muted hover:text-foreground">⚙️</a>
        </div>

        {/* Filter chips */}
        {isFiltered && (
          <FilterChips tags={tags} subtags={subtags} filters={filters} onChange={setFilters} onClearSearch={() => setSearchQuery("")} />
        )}

        {/* Main content area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 relative">
          {loading ? (
            <div className="text-center text-muted py-12">Loading games...</div>
          ) : games.length === 0 && !isSearching ? (
            <div className="text-center text-muted py-12">No games found. Add some or adjust filters.</div>
          ) : view === "cards" ? (
            <>
              {displayedGames.length > 0 && (
                <div className="game-grid-container grid gap-3" style={{ gridTemplateColumns: `repeat(${cardCols}, minmax(0, 1fr))` }}>
                  {displayedGames.map((game) => (
                    <GameCard key={game.id} game={game} selected={selectedGame?.id === game.id} onClick={() => handleSelectGame(game)}
                      slideshow={slideshow} slideDelay={slideSpeed * 1000} pageFocused={pageFocused}
                      defaultImage={defaultImage} genresCount={genresCount} communityTagsCount={communityTagsCount}
                      colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
                      onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
                      onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
                      onGenreFilter={onGenreFilter}
                      onCommunityTagFilter={onCommunityTagFilter}
                    />
                  ))}
                </div>
              )}
              {isSearching && (
                <SteamResultsSection
                  query={searchQuery} steamResults={steamResults} steamLoading={steamLoading}
                  existingAppIds={existingAppIds} adding={adding} onAddSteam={handleAddFromSteam}
                  onAddManual={handleAddManual} tags={tags}
                  onClickExisting={(appid) => { const g = allGames.find(g => g.steam_appid === appid); if (g) setInspectorGame(g); }}
                />
              )}
            </>
          ) : (
            <>
              {games.length > 0 && (
                <GameTable games={displayedGames} tags={tags} loading={loading} onUpdate={updateGame} onDelete={deleteGame}
                  slideshow={slideshow} slideDelay={slideSpeed * 1000} pageFocused={pageFocused}
                  colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
                  onSelect={handleSelectGame}
                  onNavigate={(game) => { setSelectedGame(game); if (inspectorGame) setInspectorGame(game); lastSelectedIdRef.current = game.id; }}
                  onEdit={setEditingGame}
                  sorts={filters.sorts || []}
                  onSortChange={(s) => setFilters({ ...filters, sorts: s, sort: s.length === 1 ? s[0].key : undefined, dir: s.length === 1 ? s[0].dir : undefined })}
                  onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
                  onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
                  onGenreFilter={onGenreFilter}
                  onFeatureFilter={onFeatureFilter}
                  onCommunityTagFilter={onCommunityTagFilter} />
              )}
              {isSearching && (
                <SteamResultsSection
                  query={searchQuery} steamResults={steamResults} steamLoading={steamLoading}
                  existingAppIds={existingAppIds} adding={adding} onAddSteam={handleAddFromSteam}
                  onAddManual={handleAddManual} tags={tags}
                  onClickExisting={(appid) => { const g = allGames.find(g => g.steam_appid === appid); if (g) setInspectorGame(g); }}
                />
              )}
            </>
          )}
          {displayLimit < games.length && (
            <div ref={sentinelRef} className="text-center text-muted text-xs py-6 flex items-center justify-center gap-3">
              <span>Showing {displayedGames.length} of {games.length}...</span>
              <button
                onClick={() => { setDisplayLimit(games.length); sessionStorage.setItem("gm_display_limit", String(games.length)); }}
                className="px-2 py-0.5 rounded border border-border text-muted hover:text-foreground hover:border-accent transition-colors"
              >Load all</button>
            </div>
          )}
        </div>
      </div>

      {inspectorGame && (
        <Inspector game={inspectorGame} mode="popup" onClose={closeInspector} onEdit={setEditingGame} onDelete={deleteGame} tags={tags} onUpdate={updateGame}
          colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
          onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
          onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
          onGenreFilter={onGenreFilter}
          onFeatureFilter={onFeatureFilter}
          onCommunityTagFilter={onCommunityTagFilter}
          onSimilarClick={async (gameId) => {
            const found = allGames.find((g) => g.id === gameId);
            if (found) { setSimilarStack((s) => [...s, found]); return; }
            try {
              const res = await fetch(`/api/games/${gameId}`);
              if (res.ok) { const g = await res.json(); setSimilarStack((s) => [...s, g]); }
            } catch {}
          }} />
      )}

      {similarStack.map((sg, idx) => (
        <Inspector key={`similar-${sg.id}-${idx}`} game={sg} mode="popup"
          onClose={() => setSimilarStack((s) => s.filter((_, i) => i !== idx))}
          onEdit={setEditingGame} onDelete={deleteGame} tags={tags} onUpdate={updateGame}
          colorCoded={colorCoded} scoreSource={scoreSource} tintColors={tintColors}
          onTagInclude={toggleIncTag} onTagExclude={toggleExcTag}
          onSubtagInclude={toggleIncSub} onSubtagExclude={toggleExcSub}
          onGenreFilter={onGenreFilter}
          onFeatureFilter={onFeatureFilter}
          onCommunityTagFilter={onCommunityTagFilter}
          onSimilarClick={async (gameId) => {
            const found = allGames.find((g) => g.id === gameId);
            if (found) { setSimilarStack((s) => [...s, found]); return; }
            try {
              const res = await fetch(`/api/games/${gameId}`);
              if (res.ok) { const g = await res.json(); setSimilarStack((s) => [...s, g]); }
            } catch {}
          }} />
      ))}

      {editingGame && (
        <EditModal game={editingGame} tags={tags}
          onSave={async (id, data) => {
            await updateGame(id, data);
            setEditingGame(null);
            const updated = games.find((g) => g.id === id);
            if (updated) {
              if (selectedGame?.id === id) setSelectedGame(updated);
              if (inspectorGame?.id === id) setInspectorGame(updated);
            }
          }}
          onClose={() => setEditingGame(null)}
        />
      )}

      <ClipboardPiP active={clipboardSync} />

      {/* Back to top */}
      {showScrollTop && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-5 right-5 z-40 w-9 h-9 rounded-full bg-accent/80 hover:bg-accent text-white flex items-center justify-center shadow-lg text-lg transition-opacity"
          title="Back to top"
        >↑</button>
      )}
    </div>
  );
}


// Steam results section shown below local matches when searching
function SteamResultsSection({ query, steamResults, steamLoading, existingAppIds, adding, onAddSteam, onAddManual, tags, onClickExisting }: {
  query: string;
  steamResults: SteamResult[];
  steamLoading: boolean;
  existingAppIds: Set<number | null>;
  adding: boolean;
  onAddSteam: (r: SteamResult, tagId?: number, subtagId?: number | null) => void;
  onAddManual: (tagId?: number, subtagId?: number | null) => void;
  tags: Tag[];
  onClickExisting?: (appid: number) => void;
}) {
  return (
    <div className="mt-6 space-y-3 max-w-4xl">
      <h2 className="text-xs uppercase tracking-wider text-muted flex items-center gap-2">
        Steam results
        {steamLoading && <span className="text-accent animate-pulse text-[10px]">searching...</span>}
      </h2>
      {steamResults.length > 0 ? (
        <div className="space-y-1">
          {steamResults.map((r) => (
            <SteamResultRow key={r.appid} result={r} tags={tags}
              alreadyExists={existingAppIds.has(r.appid)}
              adding={adding} onAdd={onAddSteam} onClickExisting={onClickExisting} />
          ))}
        </div>
      ) : !steamLoading && query.trim().length >= 2 && (
        <div className="text-sm text-muted py-4 text-center bg-surface rounded-lg border border-border/50">
          No Steam results for &quot;{query}&quot;
        </div>
      )}
      <ManualAddRow query={query} tags={tags} adding={adding} onAdd={onAddManual} />
    </div>
  );
}

// Per-row Steam result with its own tag selector
function SteamResultRow({ result, tags, alreadyExists, adding, onAdd, onClickExisting }: {
  result: SteamResult; tags: Tag[]; alreadyExists: boolean; adding: boolean;
  onAdd: (r: SteamResult) => void;
  onClickExisting?: (appid: number) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <>
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent transition-colors cursor-pointer ${
      alreadyExists ? "opacity-60 hover:opacity-90 bg-surface/50 hover:bg-surface2/30" : "bg-surface hover:bg-surface2/50"
    }`} onClick={() => alreadyExists ? onClickExisting?.(result.appid) : setShowPreview(true)}>
      <img src={result.image} alt="" className="w-24 h-[28px] object-cover rounded"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      <div className="flex-1 min-w-0">
        <span className="text-sm">{result.name}</span>
        <span className="text-[10px] text-muted ml-2">AppID: {result.appid}</span>
      </div>
      {alreadyExists ? (
        <span className="text-[10px] text-green-400">✓ in library</span>
      ) : (
        <span className="text-[10px] text-accent">+ add</span>
      )}
    </div>
    {showPreview && (
      <SteamPreview
        appid={result.appid} name={result.name} image={result.image}
        onClose={() => setShowPreview(false)}
        onAdd={() => { onAdd(result); setShowPreview(false); }}
        tags={tags} adding={adding}
      />
    )}
    </>
  );
}

// Manual add with tag selector
function ManualAddRow({ query, tags, adding, onAdd }: {
  query: string; tags: Tag[]; adding: boolean;
  onAdd: (tagId?: number, subtagId?: number | null) => void;
}) {
  const [tagId, setTagId] = useState<number | "">("");
  const [subtags, setSubtags] = useState<Subtag[]>([]);
  const [subtagId, setSubtagId] = useState<number | "">("");

  useEffect(() => {
    if (!tagId) { setSubtags([]); setSubtagId(""); return; }
    fetch(`/api/subtags?tag_id=${tagId}`).then((r) => r.json()).then(setSubtags);
  }, [tagId]);

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onAdd(tagId || undefined, subtagId || null)} disabled={adding}
        className="text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50">
        <span className="text-accent mr-1">+</span> Add &quot;{query}&quot; manually
      </button>
      <select value={tagId} onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : "")}
        className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px]">
        <option value="">No tag</option>
        {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {subtags.length > 0 && (
        <select value={subtagId} onChange={(e) => setSubtagId(e.target.value ? Number(e.target.value) : "")}
          className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px]">
          <option value="">No subtag</option>
          {subtags.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}

// Active filter chips bar
function FilterChips({ tags, subtags, filters, onChange, onClearSearch }: { tags: Tag[]; subtags: Subtag[]; filters: Filters; onChange: (f: Filters) => void; onClearSearch?: () => void }) {
  const chips: { label: string; color: string; type: "include" | "exclude"; onRemove: () => void }[] = [];

  for (const id of filters.includeTags || []) {
    const tag = tags.find((t) => t.id === id);
    if (tag) chips.push({
      label: tag.name, color: tag.color, type: "include",
      onRemove: () => onChange({ ...filters, includeTags: (filters.includeTags || []).filter((t) => t !== id) }),
    });
  }
  for (const id of filters.excludeTags || []) {
    const tag = tags.find((t) => t.id === id);
    if (tag) chips.push({
      label: tag.name, color: "#ef4444", type: "exclude",
      onRemove: () => onChange({ ...filters, excludeTags: (filters.excludeTags || []).filter((t) => t !== id) }),
    });
  }

  for (const id of filters.includeSubtags || []) {
    const sub = subtags.find((s) => s.id === id);
    if (sub) {
      const parent = tags.find((t) => t.id === sub.tag_id);
      chips.push({
        label: parent ? `${parent.name}>${sub.name}` : sub.name, color: sub.type === "genre" ? "#6366f1" : "#f59e0b", type: "include",
        onRemove: () => onChange({ ...filters, includeSubtags: (filters.includeSubtags || []).filter((t) => t !== id) }),
      });
    }
  }
  for (const id of filters.excludeSubtags || []) {
    const sub = subtags.find((s) => s.id === id);
    if (sub) {
      const parent = tags.find((t) => t.id === sub.tag_id);
      chips.push({
        label: parent ? `${parent.name}>${sub.name}` : sub.name, color: "#ef4444", type: "exclude",
        onRemove: () => onChange({ ...filters, excludeSubtags: (filters.excludeSubtags || []).filter((t) => t !== id) }),
      });
    }
  }

  const addStringChips = (items: string[] | undefined, type: "include" | "exclude", prefix: string, filterKey: keyof Filters) => {
    for (const val of items || []) {
      chips.push({
        label: `${prefix}: ${val}`, color: type === "include" ? "#6366f1" : "#ef4444", type,
        onRemove: () => onChange({ ...filters, [filterKey]: ((filters[filterKey] as string[]) || []).filter((v) => v !== val) }),
      });
    }
  };

  addStringChips(filters.includeGenres, "include", "Genre", "includeGenres");
  addStringChips(filters.excludeGenres, "exclude", "Genre", "excludeGenres");
  addStringChips(filters.includeFeatures, "include", "Feature", "includeFeatures");
  addStringChips(filters.excludeFeatures, "exclude", "Feature", "excludeFeatures");
  addStringChips(filters.includeCommunityTags, "include", "CTag", "includeCommunityTags");
  addStringChips(filters.excludeCommunityTags, "exclude", "CTag", "excludeCommunityTags");
  addStringChips(filters.includeDevelopers, "include", "Dev", "includeDevelopers");
  addStringChips(filters.excludeDevelopers, "exclude", "Dev", "excludeDevelopers");
  addStringChips(filters.includePublishers, "include", "Pub", "includePublishers");
  addStringChips(filters.excludePublishers, "exclude", "Pub", "excludePublishers");

  if (filters.untagged) {
    chips.push({ label: "Untagged only", color: "#f59e0b", type: "include",
      onRemove: () => onChange({ ...filters, untagged: false }) });
  }
  if (filters.withNotes) {
    chips.push({ label: "With notes", color: "#6366f1", type: "include",
      onRemove: () => onChange({ ...filters, withNotes: false }) });
  }
  if (filters.hideWishlistOnly) {
    chips.push({ label: "Curated only", color: "#6366f1", type: "include",
      onRemove: () => onChange({ ...filters, hideWishlistOnly: false }) });
  }

  if (chips.length === 0) return null;

  return (
    <div className="px-4 py-1.5 border-b border-border flex flex-wrap gap-1 items-center shrink-0">
      <span className="text-[10px] text-muted mr-1">Active:</span>
      {chips.map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
          style={{
            backgroundColor: chip.color + "18", border: `1px solid ${chip.color}40`, color: chip.color,
            textDecoration: chip.type === "exclude" ? "line-through" : undefined,
          }}>
          {chip.type === "exclude" && "−"}{chip.label}
          <button onClick={chip.onRemove} className="hover:opacity-70 ml-0.5 font-bold" style={{ color: chip.color }}>×</button>
        </span>
      ))}
      <button onClick={() => { onChange({
        ...filters, includeTags: [], excludeTags: [], includeSubtags: [], excludeSubtags: [],
        includeGenres: [], excludeGenres: [],
        includeFeatures: [], excludeFeatures: [], includeCommunityTags: [], excludeCommunityTags: [],
        includeDevelopers: [], excludeDevelopers: [], includePublishers: [], excludePublishers: [],
        untagged: false, withNotes: false, hideWishlistOnly: false, search: undefined,
      }); onClearSearch?.(); }} className="text-[10px] text-danger hover:underline ml-1">Clear all</button>
    </div>
  );
}
