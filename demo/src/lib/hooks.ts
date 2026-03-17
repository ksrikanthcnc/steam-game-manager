"use client";

import { useState, useEffect, useMemo } from "react";
import { Tag, Subtag, GameWithTags, GameTag, steamDbScore } from "./types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/data/${path}`);
  return res.json();
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

// --- Tags ---
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchJson<Tag[]>("tags.json").then((t) => { setTags(t); setLoading(false); });
  }, []);
  return { tags, loading, refresh: () => {} };
}

// --- Subtags ---
export function useSubtags() {
  const [subtags, setSubtags] = useState<Subtag[]>([]);
  useEffect(() => { fetchJson<Subtag[]>("subtags.json").then(setSubtags); }, []);
  return { subtags, refresh: () => {} };
}

// --- Genres (computed from game data) ---
export function useGenres() {
  return { genres: [] as GenreInfo[], features: [] as GenreInfo[], communityTags: [] as GenreInfo[], refresh: () => {} };
}

// --- JSON parse helper ---
function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try { const p = JSON.parse(str); return Array.isArray(p) ? p : []; } catch { return []; }
}

// --- Fuzzy match ---
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function searchScore(game: GameWithTags, query: string): number {
  const q = query.toLowerCase();
  const name = game.name.toLowerCase();
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (q.length >= 3 && fuzzyMatch(q, name)) return 3;
  return 0;
}

function filterGames(allGames: GameWithTags[], filters: Filters): GameWithTags[] {
  const {
    search, includeTags = [], excludeTags = [], includeSubtags = [], excludeSubtags = [],
    includeGenres = [], excludeGenres = [], includeFeatures = [], excludeFeatures = [],
    includeCommunityTags = [], excludeCommunityTags = [],
    includeDevelopers = [], excludeDevelopers = [],
    includePublishers = [], excludePublishers = [],
    untagged, withNotes, hideWishlistOnly, filterMode = "AND", customTagMode = "AND",
  } = filters;

  return allGames.filter((game) => {
    const gameTags: GameTag[] = game.tags || [];
    const gameTagIds = new Set(gameTags.map((t) => t.tag_id));
    const gameSubtagIds = new Set(gameTags.filter((t) => t.subtag_id).map((t) => t.subtag_id!));
    const genres = safeJsonParse(game.steam_genres);
    const features = safeJsonParse(game.steam_features);
    const ctags = safeJsonParse(game.community_tags);

    if (excludeTags.some((id) => gameTagIds.has(id))) return false;
    if (excludeSubtags.some((id) => gameSubtagIds.has(id))) return false;
    if (excludeGenres.some((g) => genres.includes(g))) return false;
    if (excludeFeatures.some((f) => features.includes(f))) return false;
    if (excludeCommunityTags.some((t) => ctags.includes(t))) return false;

    const devs = game.developers ? game.developers.split(",").map((s: string) => s.trim()) : [];
    const pubs = game.publishers ? game.publishers.split(",").map((s: string) => s.trim()) : [];
    if (excludeDevelopers.some((d) => devs.includes(d))) return false;
    if (excludePublishers.some((p) => pubs.includes(p))) return false;

    if (withNotes && !(game.notes && game.notes.trim())) return false;
    if (hideWishlistOnly && gameTags.length > 0 && gameTags.every((t) => t.tag_name === "steam")) return false;
    if (untagged && gameTags.length > 0) return false;
    if (search && searchScore(game, search) === 0) return false;

    const checks: boolean[] = [];
    const customChecks: boolean[] = [];
    if (customTagMode === "AND") {
      for (const id of includeTags) customChecks.push(gameTagIds.has(id));
      for (const id of includeSubtags) customChecks.push(gameSubtagIds.has(id));
    } else {
      if (includeTags.length > 0 || includeSubtags.length > 0) {
        customChecks.push(includeTags.some((id) => gameTagIds.has(id)) || includeSubtags.some((id) => gameSubtagIds.has(id)));
      }
    }
    if (customChecks.length > 0) checks.push(customChecks.every(Boolean));
    if (includeGenres.length > 0) checks.push(includeGenres.some((g) => genres.includes(g)));
    if (includeFeatures.length > 0) checks.push(includeFeatures.some((f) => features.includes(f)));
    if (includeCommunityTags.length > 0) checks.push(includeCommunityTags.some((t) => ctags.includes(t)));
    if (includeDevelopers.length > 0) checks.push(includeDevelopers.some((d) => devs.includes(d)));
    if (includePublishers.length > 0) checks.push(includePublishers.some((p) => pubs.includes(p)));

    if (checks.length === 0) return true;
    return filterMode === "AND" ? checks.every(Boolean) : checks.some(Boolean);
  });
}

function safeFirst(json: string | null | undefined): string {
  if (!json) return "";
  try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr.join(", ").toLowerCase() : ""; } catch { return ""; }
}

function sortGames(games: GameWithTags[], sort?: string, dir?: "asc" | "desc", sorts?: { key: string; dir: "asc" | "desc" }[]): GameWithTags[] {
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
    case "rating": case "score": {
      const av = a.positive_percent || 0, bv = b.positive_percent || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "reviews": {
      const av = a.total_reviews || 0, bv = b.total_reviews || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "release_date": {
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
    case "tag": case "tags": {
      const aTag = (a.tags || []).map(t => t.tag_name).join(", ").toLowerCase();
      const bTag = (b.tags || []).map(t => t.tag_name).join(", ").toLowerCase();
      if (!aTag && !bTag) return 0; if (!aTag) return 1; if (!bTag) return -1;
      return d * aTag.localeCompare(bTag);
    }
    case "genre": case "genres": {
      const aG = safeFirst(a.steam_genres), bG = safeFirst(b.steam_genres);
      if (!aG && !bG) return 0; if (!aG) return 1; if (!bG) return -1;
      return d * aG.localeCompare(bG);
    }
    case "developers": {
      const av = (a.developers || "").toLowerCase(), bv = (b.developers || "").toLowerCase();
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

// --- Main hook ---
export function useGames() {
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({});

  useEffect(() => {
    Promise.all([
      fetchJson<Record<string, unknown>[]>("games.json"),
      fetchJson<{ game_id: number; tag_id: number; subtag_id: number | null; tag_name: string; tag_color: string; subtag_name: string | null; subtag_type: string | null }[]>("game_tags.json"),
    ]).then(([rawGames, rawTags]) => {
      const tagsByGame = new Map<number, GameTag[]>();
      for (const t of rawTags) {
        if (!tagsByGame.has(t.game_id)) tagsByGame.set(t.game_id, []);
        tagsByGame.get(t.game_id)!.push({
          id: 0, game_id: t.game_id, tag_id: t.tag_id,
          tag_name: t.tag_name, tag_color: t.tag_color,
          subtag_id: t.subtag_id, subtag_name: t.subtag_name,
          subtag_type: t.subtag_type as "genre" | "meta" | null,
        });
      }
      const games: GameWithTags[] = rawGames.map((g: Record<string, unknown>) => ({
        ...g,
        tags: tagsByGame.get(g.id as number) || [],
      })) as GameWithTags[];
      setAllGames(games);
      setLoading(false);
    });
  }, []);

  const games = useMemo(() => {
    const filtered = filterGames(allGames, filters);
    if (filters.search) {
      const scored = filtered.map((g) => ({ g, s: searchScore(g, filters.search!) }));
      scored.sort((a, b) => {
        if (a.s !== b.s) return a.s - b.s;
        const sorted = sortGames([a.g, b.g], filters.sort, filters.dir);
        return sorted[0] === a.g ? -1 : 1;
      });
      return scored.map((x) => x.g);
    }
    return sortGames(filtered, filters.sort, filters.dir, filters.sorts);
  }, [allGames, filters]);

  const totalCount = allGames.length;
  const allAppIds = useMemo(() => new Set(allGames.filter(g => g.steam_appid).map(g => g.steam_appid)), [allGames]);

  return { games, allGames, totalCount, loading, filters, setFilters, refresh: () => {}, allAppIds };
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
