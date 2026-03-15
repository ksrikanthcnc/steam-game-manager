import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, existsSync } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");

// GET /api/games — list games with filtering
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search") || "";
  const includeTags = sp.getAll("include_tag");
  const excludeTags = sp.getAll("exclude_tag");
  const includeSubtags = sp.getAll("include_subtag");
  const excludeSubtags = sp.getAll("exclude_subtag");
  const includeGenres = sp.getAll("include_genre");
  const excludeGenres = sp.getAll("exclude_genre");
  const includeFeatures = sp.getAll("include_feature");
  const excludeFeatures = sp.getAll("exclude_feature");
  const includeCommunityTags = sp.getAll("include_ctag");
  const excludeCommunityTags = sp.getAll("exclude_ctag");
  const sortBy = sp.get("sort") || "name";
  const sortDir = sp.get("dir") === "desc" ? "DESC" : "ASC";
  const untagged = sp.get("untagged") === "true";
  const filterMode = sp.get("filter_mode") === "OR" ? "OR" : "AND";

  const db = getDb();

  // Get total count (unfiltered)
  const totalRow = db.prepare("SELECT COUNT(*) as total FROM games").get() as { total: number };
  const totalCount = totalRow.total;

  let query = `
    SELECT DISTINCT g.*
    FROM games g
  `;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // --- Include filters: AND or OR mode ---
  const includeConditions: string[] = [];
  const includeParams: (string | number)[] = [];

  if (includeTags.length > 0) {
    query += ` LEFT JOIN game_tags gt_inc ON gt_inc.game_id = g.id`;
    includeConditions.push(`gt_inc.tag_id IN (${includeTags.map(() => "?").join(",")})`);
    includeParams.push(...includeTags.map(Number));
  }

  if (includeSubtags.length > 0) {
    if (includeTags.length === 0) {
      query += ` LEFT JOIN game_tags gt_sub ON gt_sub.game_id = g.id`;
    }
    const alias = includeTags.length > 0 ? "gt_inc" : "gt_sub";
    includeConditions.push(`${alias}.subtag_id IN (${includeSubtags.map(() => "?").join(",")})`);
    includeParams.push(...includeSubtags.map(Number));
  }

  for (const genre of includeGenres) {
    includeConditions.push(`g.steam_genres LIKE ?`);
    includeParams.push(`%"${genre}"%`);
  }
  for (const feat of includeFeatures) {
    includeConditions.push(`g.steam_features LIKE ?`);
    includeParams.push(`%"${feat}"%`);
  }
  for (const ctag of includeCommunityTags) {
    includeConditions.push(`g.community_tags LIKE ?`);
    includeParams.push(`%"${ctag}"%`);
  }

  if (includeConditions.length > 0) {
    const joiner = filterMode === "OR" ? " OR " : " AND ";
    conditions.push(`(${includeConditions.join(joiner)})`);
    params.push(...includeParams);
  }

  // --- Exclude filters: always AND ---
  if (excludeTags.length > 0) {
    conditions.push(`g.id NOT IN (
      SELECT game_id FROM game_tags WHERE tag_id IN (${excludeTags.map(() => "?").join(",")})
    )`);
    params.push(...excludeTags.map(Number));
  }

  if (excludeSubtags.length > 0) {
    conditions.push(`g.id NOT IN (
      SELECT game_id FROM game_tags WHERE subtag_id IN (${excludeSubtags.map(() => "?").join(",")})
    )`);
    params.push(...excludeSubtags.map(Number));
  }

  for (const genre of excludeGenres) {
    conditions.push(`g.steam_genres NOT LIKE ?`);
    params.push(`%"${genre}"%`);
  }
  for (const feat of excludeFeatures) {
    conditions.push(`g.steam_features NOT LIKE ?`);
    params.push(`%"${feat}"%`);
  }
  for (const ctag of excludeCommunityTags) {
    conditions.push(`g.community_tags NOT LIKE ?`);
    params.push(`%"${ctag}"%`);
  }

  // --- Other conditions (always AND) ---
  if (untagged) {
    conditions.push(`g.id NOT IN (SELECT game_id FROM game_tags)`);
  }
  if (search) {
    conditions.push(`g.name LIKE ?`);
    params.push(`%${search}%`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(" AND ");
  }

  const validSorts: Record<string, string> = {
    name: "g.name",
    created_at: "g.created_at",
    updated_at: "g.updated_at",
  };
  const sortCol = validSorts[sortBy] || "g.name";
  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const games = db.prepare(query).all(...params);

  // Fetch tags for all returned games
  if (games.length > 0) {
    const gameIds = (games as { id: number }[]).map((g) => g.id);
    const placeholders = gameIds.map(() => "?").join(",");
    const tagRows = db
      .prepare(
        `SELECT gt.*, t.name as tag_name, t.color as tag_color, s.name as subtag_name, s.type as subtag_type
         FROM game_tags gt
         JOIN tags t ON t.id = gt.tag_id
         LEFT JOIN subtags s ON s.id = gt.subtag_id
         WHERE gt.game_id IN (${placeholders})`
      )
      .all(...gameIds);

    const tagMap = new Map<number, typeof tagRows>();
    for (const row of tagRows as { game_id: number }[]) {
      if (!tagMap.has(row.game_id)) tagMap.set(row.game_id, []);
      tagMap.get(row.game_id)!.push(row);
    }
    for (const game of games as { id: number; tags?: unknown[] }[]) {
      game.tags = tagMap.get(game.id) || [];
    }
  }

  return NextResponse.json({ games, total: totalCount });
}


// POST /api/games — create a game
export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  // Support bulk add
  const items = Array.isArray(body) ? body : [body];
  const results: { id: number | bigint; name: string }[] = [];

  const today = new Date().toISOString().split("T")[0];
  const insertGame = db.prepare(
    "INSERT INTO games (name, steam_appid, notes, added_at) VALUES (?, ?, ?, ?)"
  );
  const insertGameTag = db.prepare(
    "INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)"
  );
  const checkDupe = db.prepare(
    "SELECT id FROM games WHERE steam_appid = ? OR LOWER(name) = LOWER(?)"
  );

  const transaction = db.transaction(() => {
    for (const item of items) {
      if (!item.name?.trim()) continue;

      // Skip duplicates by steam_appid or exact name match
      if (item.steam_appid) {
        const existing = checkDupe.get(item.steam_appid, item.name.trim());
        if (existing) {
          results.push({ id: (existing as { id: number }).id, name: item.name.trim() });
          continue;
        }
      }

      const result = insertGame.run(
        item.name.trim(),
        item.steam_appid || null,
        item.notes || "",
        today
      );
      const gameId = result.lastInsertRowid;

      if (item.tag_id) {
        insertGameTag.run(gameId, item.tag_id, item.subtag_id || null);
      }

      // Auto-create manual image folder for non-steam games
      if (!item.steam_appid) {
        const folder = path.join(ASSETS_DIR, `manual_${gameId}`);
        if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
      }

      results.push({ id: gameId, name: item.name.trim() });
    }
  });

  transaction();

  return NextResponse.json(
    { added: results.length, games: results },
    { status: 201 }
  );
}
