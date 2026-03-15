import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

// GET /api/games/all — returns ALL games with tags in one shot (for client-side filtering)
export function GET() {
  const db = getDb();

  const games = db.prepare("SELECT * FROM games ORDER BY name").all();

  // Fetch all game_tags in one query
  const tagRows = db.prepare(
    `SELECT gt.*, t.name as tag_name, t.color as tag_color, s.name as subtag_name, s.type as subtag_type
     FROM game_tags gt
     JOIN tags t ON t.id = gt.tag_id
     LEFT JOIN subtags s ON s.id = gt.subtag_id
     ORDER BY t.name, s.name`
  ).all() as { game_id: number }[];

  const tagMap = new Map<number, typeof tagRows>();
  for (const row of tagRows) {
    if (!tagMap.has(row.game_id)) tagMap.set(row.game_id, []);
    tagMap.get(row.game_id)!.push(row);
  }
  for (const game of games as { id: number; tags?: unknown[] }[]) {
    game.tags = tagMap.get(game.id) || [];
  }

  return NextResponse.json(games);
}
