export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
  game_count?: number;
}

export interface Subtag {
  id: number;
  tag_id: number;
  name: string;
  type: "genre" | "meta";
  created_at: string;
}

export interface Game {
  id: number;
  name: string;
  steam_appid: number | null;
  steam_image_url: string | null;
  description: string;
  notes: string;
  steam_genres: string; // JSON array string — dev-assigned genres (Action, RPG, etc.)
  steam_features: string; // JSON array string — platform features (Single-player, Co-op, etc.)
  community_tags: string; // JSON array string — user-voted tags (Souls-like, Metroidvania, etc.)
  developers: string;
  publishers: string;
  release_date: string;
  review_sentiment: string;
  positive_percent: number;
  total_reviews: number;
  metacritic_score: number;
  screenshots: string; // JSON array string
  movies: string; // JSON array string — [{name, thumbnail_url, video_url}]
  total_screenshots: number;
  total_movies: number;
  wishlist_date: string | null;
  added_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: GameTag[];
}

export interface GameTag {
  id: number;
  game_id: number;
  tag_id: number;
  tag_name: string;
  tag_color: string;
  subtag_id: number | null;
  subtag_name: string | null;
  subtag_type: "genre" | "meta" | null;
}

export interface GameWithTags extends Game {
  tags: GameTag[];
}



/** SteamDB rating: https://steamdb.info/blog/steamdb-rating/ */
export function steamDbScore(positivePercent: number, totalReviews: number): number {
  if (totalReviews <= 0 || positivePercent <= 0) return 0;
  const pos = Math.round(totalReviews * positivePercent / 100);
  const neg = totalReviews - pos;
  const total = pos + neg;
  const avg = pos / total;
  return Math.round((avg - (avg - 0.5) * Math.pow(2, -Math.log10(total + 1))) * 100);
}

/** Color preset for score-based tinting */
export interface TintColors {
  high: string; // hex color for score >= 70
  mid: string;  // hex color for score >= 40
  low: string;  // hex color for score < 40
  opacity: number; // 0-1
}

export const COLOR_PRESETS: Record<string, TintColors> = {
  subtle: { high: "#22c55e", mid: "#f59e0b", low: "#ef4444", opacity: 0.06 },
  vivid:  { high: "#22c55e", mid: "#f59e0b", low: "#ef4444", opacity: 0.12 },
  neon:   { high: "#06b6d4", mid: "#eab308", low: "#d946ef", opacity: 0.10 },
};

/** Convert hex + opacity to rgba string */
export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/** Get tint background for a game based on score */
export function getScoreTint(
  game: GameWithTags,
  scoreSource: "steam" | "steamdb",
  tint: TintColors | null,
): string | undefined {
  if (!tint) return undefined;
  const score = scoreSource === "steamdb"
    ? (game.total_reviews > 0 ? steamDbScore(game.positive_percent, game.total_reviews) : 0)
    : game.positive_percent;
  if (score <= 0) return undefined;
  if (score >= 70) return hexToRgba(tint.high, tint.opacity);
  if (score >= 40) return hexToRgba(tint.mid, tint.opacity);
  return hexToRgba(tint.low, tint.opacity);
}

/** Get the primary display score for a game */
export function getPrimaryScore(game: GameWithTags, scoreSource: "steam" | "steamdb"): number {
  if (scoreSource === "steamdb") return game.total_reviews > 0 ? steamDbScore(game.positive_percent, game.total_reviews) : 0;
  return game.positive_percent;
}

/** Get text color for a score value */
export function scoreColor(score: number, tint: TintColors | null): string {
  const colors = tint || COLOR_PRESETS.subtle;
  if (score >= 70) return colors.high;
  if (score >= 40) return colors.mid;
  return colors.low;
}
