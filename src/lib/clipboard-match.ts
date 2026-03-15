import { GameWithTags } from "@/lib/types";

function similarity(a: string, b: string): number {
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const dp: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[la][lb]) / (la + lb);
}

export interface MatchResult {
  type: "exact" | "partial" | "fuzzy" | "none";
  games: GameWithTags[];
}

export interface MatchConfig {
  partialLimit: number;
  fuzzyLimit: number;
  fuzzyThreshold: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  partialLimit: 8,
  fuzzyLimit: 6,
  fuzzyThreshold: 0.5,
};

export function findMatches(query: string, games: GameWithTags[], config: MatchConfig = DEFAULT_MATCH_CONFIG): MatchResult {
  const q = query.toLowerCase().trim();
  if (!q || q.length < 2) return { type: "none", games: [] };

  const exact = games.filter((g) => g.name.toLowerCase() === q);
  if (exact.length > 0) return { type: "exact", games: exact };

  const partial = games.filter((g) => {
    const n = g.name.toLowerCase();
    return n.includes(q) || q.includes(n);
  });
  if (partial.length > 0) return { type: "partial", games: partial.slice(0, config.partialLimit) };

  const fuzzy = games
    .map((g) => ({ game: g, score: similarity(q, g.name.toLowerCase()) }))
    .filter((r) => r.score > config.fuzzyThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.fuzzyLimit)
    .map((r) => r.game);
  if (fuzzy.length > 0) return { type: "fuzzy", games: fuzzy };

  return { type: "none", games: [] };
}
