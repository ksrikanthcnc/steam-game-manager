"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Tag, Subtag, GameWithTags, GameTag, steamDbScore } from "./types";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export interface Filters {
  search?: string;
  includeTags?: number[];
  excludeTags?: number[];
  includeSubtags?: number[];
  excludeSubtags?: number[];
  includeGenres?: string[];
  excludeGenres?: string[];
  includeFeatures?: string[];
  excludeFeatures?: string[];
  includeCommunityTags?: string[];
  excludeCommunityTags?: string[];
  includeDevelopers?: string[];
  excludeDevelopers?: string[];
  includePublishers?: string[];
  excludePublishers?: string[];
  sort?: string;
  sorts?: { key: string; dir: "asc" | "desc" }[];
  dir?: "asc" | "desc";
  untagged?: boolean;
  withNotes?: boolean;
  hideWishlistOnly?: boolean;
  filterMode?: "AND" | "OR";
  customTagMode?: "AND" | "OR";
}

export interface GenreInfo { name: string; count: number; }
export interface SteamTagData { genres: GenreInfo[]; features: GenreInfo[]; communityTags: GenreInfo[]; }

// --- Tags ---
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setTags(await fetcher<Tag[]>("/api/tags"));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addTag = async (name: string, color?: string) => {
    const res = await fetch("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    await refresh();
  };
  const deleteTag = async (id: number) => { await fetch(`/api/tags/${id}`, { method: "DELETE" }); await refresh(); };
  const updateTag = async (id: number, data: Partial<Tag>) => {
    await fetch(`/api/tags/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    await refresh();
  };

  return { tags, loading, refresh, addTag, deleteTag, updateTag };
}

// --- Subtags ---
export function useSubtags(tagId?: number) {
  const [subtags, setSubtags] = useState<Subtag[]>([]);

  const refresh = useCallback(async () => {
    const url = tagId ? `/api/subtags?tag_id=${tagId}` : "/api/subtags";
    setSubtags(await fetcher<Subtag[]>(url));
  }, [tagId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addSubtag = async (tag_id: number, name: string, type: "genre" | "meta" = "genre") => {
    const res = await fetch("/api/subtags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag_id, name, type }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    await refresh();
  };
  const deleteSubtag = async (id: number) => { await fetch(`/api/subtags/${id}`, { method: "DELETE" }); await refresh(); };

  return { subtags, refresh, addSubtag, deleteSubtag };
}

// --- Genres ---
export function useGenres() {
  const [data, setData] = useState<SteamTagData>({ genres: [], features: [], communityTags: [] });
  const refresh = useCallback(async () => { setData(await fetcher<SteamTagData>("/api/genres")); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...data, refresh };
}

// --- JSON parse helper ---
function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; } catch { return []; }
}

// --- Dynamic counts ---
export function computeDynamicCounts(games: GameWithTags[]) {
  const genreCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();
  const communityTagCounts = new Map<string, number>();
  const customTagCounts = new Map<number, number>();
  const subtagCounts = new Map<number, number>();
  const developerCounts = new Map<string, number>();
  const publisherCounts = new Map<string, number>();

  for (const game of games) {
    for (const g of safeJsonParse(game.steam_genres)) genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    for (const f of safeJsonParse(game.steam_features)) featureCounts.set(f, (featureCounts.get(f) || 0) + 1);
    for (const t of safeJsonParse(game.community_tags)) communityTagCounts.set(t, (communityTagCounts.get(t) || 0) + 1);
    if (game.developers) {
      for (const d of game.developers.split(",").map((s: string) => s.trim()).filter(Boolean))
        developerCounts.set(d, (developerCounts.get(d) || 0) + 1);
    }
    if (game.publishers) {
      for (const p of game.publishers.split(",").map((s: string) => s.trim()).filter(Boolean))
        publisherCounts.set(p, (publisherCounts.get(p) || 0) + 1);
    }
    if (game.tags) {
      for (const t of game.tags) {
        customTagCounts.set(t.tag_id, (customTagCounts.get(t.tag_id) || 0) + 1);
        if (t.subtag_id) subtagCounts.set(t.subtag_id, (subtagCounts.get(t.subtag_id) || 0) + 1);
      }
    }
  }
  return { genreCounts, featureCounts, communityTagCounts, customTagCounts, subtagCounts, developerCounts, publisherCounts };
}

// --- Client-side filter + sort ---
/** Fuzzy match: all chars of query appear in order in target */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Parse prefix search like "note:foo" or "appid:123". Returns { field, value } or null for plain search. */
function parseSearchPrefix(query: string): { field: string; value: string } | null {
  const m = query.match(/^(note|notes|appid|dev|developer):(.+)/i);
  if (!m) return null;
  const field = m[1].toLowerCase();
  return { field: field === "notes" ? "note" : field === "developer" ? "dev" : field, value: m[2].trim() };
}

/** Score a game against search query. Lower = better match, 0 = no match. */
function searchScore(game: GameWithTags, query: string): number {
  const prefix = parseSearchPrefix(query);

  if (prefix) {
    const v = prefix.value.toLowerCase();
    if (!v) return 0;
    if (prefix.field === "note") {
      const notes = (game.notes || "").toLowerCase();
      if (notes.includes(v)) return 1;
      return 0;
    }
    if (prefix.field === "appid") {
      const appid = String(game.steam_appid || "");
      if (appid === v) return 1;
      if (appid.startsWith(v)) return 2;
      return 0;
    }
    if (prefix.field === "dev") {
      const dev = (game.developers || "").toLowerCase();
      if (dev.includes(v)) return 1;
      return 0;
    }
    return 0;
  }

  const q = query.toLowerCase();
  const name = game.name.toLowerCase();

  // Tier 1: starts-with (best)
  if (name.startsWith(q)) return 1;
  // Tier 2: contains
  if (name.includes(q)) return 2;
  // Tier 3: fuzzy (only for queries >= 3 chars to avoid noise)
  if (q.length >= 3 && fuzzyMatch(q, name)) return 3;
  // No match
  return 0;
}

function filterGames(allGames: GameWithTags[], filters: Filters): GameWithTags[] {
  const {
    search, includeTags = [], excludeTags = [], includeSubtags = [], excludeSubtags = [],
    includeGenres = [], excludeGenres = [], includeFeatures = [], excludeFeatures = [],
    includeCommunityTags = [], excludeCommunityTags = [],
    includeDevelopers = [], excludeDevelopers = [],
    includePublishers = [], excludePublishers = [],
    untagged, withNotes, hideWishlistOnly, filterMode = "AND",
    customTagMode = "AND",
  } = filters;

  return allGames.filter((game) => {
    const gameTags: GameTag[] = game.tags || [];
    const gameTagIds = new Set(gameTags.map((t) => t.tag_id));
    const gameSubtagIds = new Set(gameTags.filter((t) => t.subtag_id).map((t) => t.subtag_id!));
    const genres = safeJsonParse(game.steam_genres);
    const features = safeJsonParse(game.steam_features);
    const ctags = safeJsonParse(game.community_tags);

    // Excludes (always AND)
    if (excludeTags.some((id) => gameTagIds.has(id))) return false;
    if (excludeSubtags.some((id) => gameSubtagIds.has(id))) return false;
    if (excludeGenres.some((g) => genres.includes(g))) return false;
    if (excludeFeatures.some((f) => features.includes(f))) return false;
    if (excludeCommunityTags.some((t) => ctags.includes(t))) return false;

    const devs = game.developers ? game.developers.split(",").map((s: string) => s.trim()) : [];
    const pubs = game.publishers ? game.publishers.split(",").map((s: string) => s.trim()) : [];
    if (excludeDevelopers.some((d) => devs.includes(d))) return false;
    if (excludePublishers.some((p) => pubs.includes(p))) return false;

    // With notes
    if (withNotes && !(game.notes && game.notes.trim())) return false;

    // Hide wishlist-only (games whose only L0 tag is "steam")
    if (hideWishlistOnly && gameTags.length > 0 && gameTags.every((t) => t.tag_name === "steam")) return false;

    // Untagged
    if (untagged && gameTags.length > 0) return false;

    // Search (scored: starts-with > contains > fuzzy)
    if (search) {
      if (searchScore(game, search) === 0) return false;
    }

    // Includes
    const checks: boolean[] = [];

    // Custom tags: local AND/OR for tags + subtags combined
    // Each individual selected tag/subtag is its own check in AND mode
    const customChecks: boolean[] = [];
    if (customTagMode === "AND") {
      for (const id of includeTags) customChecks.push(gameTagIds.has(id));
      for (const id of includeSubtags) customChecks.push(gameSubtagIds.has(id));
    } else {
      // OR: any match across all selected tags and subtags
      if (includeTags.length > 0 || includeSubtags.length > 0) {
        customChecks.push(
          includeTags.some((id) => gameTagIds.has(id)) ||
          includeSubtags.some((id) => gameSubtagIds.has(id))
        );
      }
    }
    if (customChecks.length > 0) {
      checks.push(customChecks.every(Boolean));
    }

    // In AND mode, each selected item is its own check (must match ALL).
    // In OR mode, any match within or across categories passes.
    if (filterMode === "AND") {
      for (const g of includeGenres) checks.push(genres.includes(g));
      for (const f of includeFeatures) checks.push(features.includes(f));
      for (const t of includeCommunityTags) checks.push(ctags.includes(t));
      for (const d of includeDevelopers) checks.push(devs.includes(d));
      for (const p of includePublishers) checks.push(pubs.includes(p));
    } else {
      if (includeGenres.length > 0) checks.push(includeGenres.some((g) => genres.includes(g)));
      if (includeFeatures.length > 0) checks.push(includeFeatures.some((f) => features.includes(f)));
      if (includeCommunityTags.length > 0) checks.push(includeCommunityTags.some((t) => ctags.includes(t)));
      if (includeDevelopers.length > 0) checks.push(includeDevelopers.some((d) => devs.includes(d)));
      if (includePublishers.length > 0) checks.push(includePublishers.some((p) => pubs.includes(p)));
    }

    if (checks.length === 0) return true;
    return filterMode === "AND" ? checks.every(Boolean) : checks.some(Boolean);
  });
}

function safeFirst(json: string | null | undefined): string {
  if (!json) return "";
  try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr.join(", ").toLowerCase() : ""; } catch { return ""; }
}

function sortGames(games: GameWithTags[], sort?: string, dir?: "asc" | "desc", sorts?: { key: string; dir: "asc" | "desc" }[]): GameWithTags[] {
  // Build sort entries: multi-sort takes priority, fallback to single sort
  const entries = sorts && sorts.length > 0 ? sorts : sort ? [{ key: sort, dir: dir || "asc" as const }] : [{ key: "name", dir: dir || "asc" as const }];
  const sorted = [...games];
  sorted.sort((a, b) => {
    for (const entry of entries) {
      const cmp = compareBySortKey(a, b, entry.key, entry.dir === "desc" ? -1 : 1);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return sorted;
}

function compareBySortKey(a: GameWithTags, b: GameWithTags, sort: string, d: number): number {
  switch (sort) {
    case "name": return d * a.name.localeCompare(b.name);
    case "added_at": {
      const av = a.added_at || "", bv = b.added_at || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "updated_at": return d * (a.updated_at.localeCompare(b.updated_at));
    case "rating": case "score": {
      const av = a.positive_percent || 0, bv = b.positive_percent || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "reviews": case "reviewCount": {
      const av = a.total_reviews || 0, bv = b.total_reviews || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "release_date": case "release": {
      const av = a.release_date || "", bv = b.release_date || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "metacritic": {
      const av = a.metacritic_score || 0, bv = b.metacritic_score || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "steamdb": {
      const av = a.total_reviews > 0 ? steamDbScore(a.positive_percent, a.total_reviews) : 0;
      const bv = b.total_reviews > 0 ? steamDbScore(b.positive_percent, b.total_reviews) : 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "sentiment": {
      const av = a.review_sentiment || "", bv = b.review_sentiment || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "wishlist_date": {
      const av = a.wishlist_date || "", bv = b.wishlist_date || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "tag": case "tags": {
      const aTag = (a.tags || []).map(t => t.tag_name).join(", ").toLowerCase();
      const bTag = (b.tags || []).map(t => t.tag_name).join(", ").toLowerCase();
      if (!aTag && !bTag) return 0; if (!aTag) return 1; if (!bTag) return -1;
      if (aTag !== bTag) return d * aTag.localeCompare(bTag);
      const aSub = (a.tags || []).map(t => t.subtag_name || "").join(", ").toLowerCase();
      const bSub = (b.tags || []).map(t => t.subtag_name || "").join(", ").toLowerCase();
      if (aSub !== bSub) return d * aSub.localeCompare(bSub);
      return a.name.localeCompare(b.name);
    }
    case "genre": case "genres": {
      const aG = safeFirst(a.steam_genres), bG = safeFirst(b.steam_genres);
      if (!aG && !bG) return 0; if (!aG) return 1; if (!bG) return -1;
      if (aG !== bG) return d * aG.localeCompare(bG);
      return a.name.localeCompare(b.name);
    }
    case "community_tag": case "community": {
      const aC = safeFirst(a.community_tags), bC = safeFirst(b.community_tags);
      if (!aC && !bC) return 0; if (!aC) return 1; if (!bC) return -1;
      if (aC !== bC) return d * aC.localeCompare(bC);
      return a.name.localeCompare(b.name);
    }
    case "features": {
      const aF = safeFirst(a.steam_features), bF = safeFirst(b.steam_features);
      if (!aF && !bF) return 0; if (!aF) return 1; if (!bF) return -1;
      if (aF !== bF) return d * aF.localeCompare(bF);
      return a.name.localeCompare(b.name);
    }
    case "developers": {
      const av = (a.developers || "").toLowerCase(), bv = (b.developers || "").toLowerCase();
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "publishers": {
      const av = (a.publishers || "").toLowerCase(), bv = (b.publishers || "").toLowerCase();
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "appid": {
      const av = a.steam_appid || 0, bv = b.steam_appid || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    default: return d * a.name.localeCompare(b.name);
  }
}

// --- Main hook: load all games once, filter client-side ---
export function useGames() {
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersRaw] = useState<Filters>(() => {
    const saved = loadJson<Filters>("gm_filters", {});
    // Default hideWishlistOnly to true for new users
    if (saved.hideWishlistOnly === undefined) saved.hideWishlistOnly = true;
    return saved;
  });

  const setFilters = useCallback((f: Filters) => {
    setFiltersRaw(f);
    const { search, ...persistable } = f;
    saveJson("gm_filters", persistable);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const data = await fetcher<GameWithTags[]>("/api/games/all");
    setAllGames(data);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Refetch when window regains focus (e.g. after syncing on settings page)
  useEffect(() => {
    const onFocus = () => refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Client-side filter + sort (memoized)
  // When search is active, sort by relevance first, then normal sort as tiebreaker
  const games = useMemo(() => {
    const filtered = filterGames(allGames, filters);
    if (filters.search) {
      const scored = filtered.map((g) => ({ g, s: searchScore(g, filters.search!) }));
      scored.sort((a, b) => {
        if (a.s !== b.s) return a.s - b.s; // lower score = better match
        // tiebreaker: normal sort
        const sorted = sortGames([a.g, b.g], filters.sort, filters.dir);
        return sorted[0] === a.g ? -1 : 1;
      });
      return scored.map((x) => x.g);
    }
    return sortGames(filtered, filters.sort, filters.dir, filters.sorts);
  }, [allGames, filters]);

  const totalCount = allGames.length;

  const addGame = async (game: { name: string; tag_id?: number; subtag_id?: number | null; steam_appid?: number; notes?: string }) => {
    const res = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(game) });
    if (!res.ok) throw new Error("Failed to add game");
    const data = await res.json();
    await refresh();
    return data as { added: number; games: { id: number; name: string }[] };
  };

  const updateGame = async (id: number, data: Record<string, unknown>) => {
    const res = await fetch(`/api/games/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Save failed (${res.status})`);
    }
    await refresh(true);
  };

  const deleteGame = async (id: number) => {
    await fetch(`/api/games/${id}`, { method: "DELETE" });
    await refresh(true);
  };

  const allAppIds = useMemo(() => new Set(allGames.filter(g => g.steam_appid).map(g => g.steam_appid)), [allGames]);

  return { games, allGames, totalCount, loading, filters, setFilters, refresh, addGame, updateGame, deleteGame, allAppIds };
}
