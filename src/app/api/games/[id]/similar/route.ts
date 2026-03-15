import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// GET /api/games/:id/similar — find similar games (from pre-computed table or on-the-fly)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  // Try pre-computed table first
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='game_similarities'"
    ).get();

    if (tableExists) {
      const rows = db.prepare(`
        SELECT gs.similar_id as id, g.name, g.steam_appid, gs.score, gs.shared
        FROM game_similarities gs
        JOIN games g ON g.id = gs.similar_id
        WHERE gs.game_id = ?
        ORDER BY gs.score DESC
        LIMIT 8
      `).all(id) as { id: number; name: string; steam_appid: number | null; score: number; shared: string }[];

      if (rows.length > 0) {
        return NextResponse.json(rows.map((r) => ({
          ...r, shared: safeJson(r.shared as unknown as string | null),
        })));
      }
    }
  } catch { /* fall through to on-the-fly */ }

  // On-the-fly fallback
  const game = db.prepare("SELECT community_tags, steam_genres FROM games WHERE id = ?").get(id) as
    { community_tags: string | null; steam_genres: string | null } | undefined;
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const srcTags: string[] = safeJson(game.community_tags);
  const srcGenres: string[] = safeJson(game.steam_genres);

  if (srcTags.length === 0 && srcGenres.length === 0) {
    return NextResponse.json([]);
  }

  const srcTagWeights = new Map<string, number>();
  for (let i = 0; i < srcTags.length; i++) {
    srcTagWeights.set(srcTags[i].toLowerCase(), 1 / (1 + i * 0.15));
  }

  const srcGenreSet = new Set(srcGenres.map((g) => g.toLowerCase()));

  const others = db.prepare(
    "SELECT id, name, steam_appid, community_tags, steam_genres FROM games WHERE id != ?"
  ).all(id) as { id: number; name: string; steam_appid: number | null; community_tags: string | null; steam_genres: string | null }[];

  const scored: { id: number; name: string; steam_appid: number | null; score: number; shared: string[] }[] = [];

  for (const other of others) {
    const otherTags: string[] = safeJson(other.community_tags);
    const otherGenres: string[] = safeJson(other.steam_genres);

    let score = 0;
    const shared: string[] = [];

    for (let j = 0; j < otherTags.length; j++) {
      const tag = otherTags[j].toLowerCase();
      const srcWeight = srcTagWeights.get(tag);
      if (srcWeight !== undefined) {
        const otherWeight = 1 / (1 + j * 0.15);
        score += srcWeight * otherWeight;
        shared.push(otherTags[j]);
      }
    }

    for (const g of otherGenres) {
      if (srcGenreSet.has(g.toLowerCase())) {
        score += 0.15;
      }
    }

    if (score > 0.3) {
      scored.push({ id: other.id, name: other.name, steam_appid: other.steam_appid, score, shared: shared.slice(0, 5) });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return NextResponse.json(scored.slice(0, 8));
}

function safeJson(s: string | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}
