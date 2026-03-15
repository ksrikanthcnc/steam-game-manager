import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// POST /api/import/csv — import games from CSV (handles both sections)
// Detects columns from header row. Supports #NOT_ON_STEAM section.
export async function POST(req: NextRequest) {
  const text = await req.text();
  const lines = text.split("\n");
  if (lines.length < 2) return NextResponse.json({ error: "Empty CSV" }, { status: 400 });

  // Split into main section and not-on-steam section
  const nosMarker = lines.findIndex((l) => l.trim() === "#NOT_ON_STEAM");
  const mainLines = nosMarker >= 0 ? lines.slice(0, nosMarker) : lines;
  const nosLines = nosMarker >= 0 ? lines.slice(nosMarker + 1) : [];

  const db = getDb();
  const COLORS: Record<string, string> = {
    indie: "#6366f1", aaa: "#ef4444", coop: "#22c55e", kids: "#f59e0b",
    next: "#06b6d4", other: "#8b5cf6", tadu: "#ec4899", wishlist: "#94a3b8", owned: "#10b981",
  };

  let added = 0, updated = 0, existing = 0, tagLinks = 0;

  const run = db.transaction(() => {
    // Process main section
    const mainResult = processSection(db, mainLines, COLORS);
    added += mainResult.added;
    updated += mainResult.updated;
    existing += mainResult.existing;
    tagLinks += mainResult.tagLinks;

    // Process not-on-steam section (updates all columns)
    if (nosLines.length > 1) {
      const nosResult = processSection(db, nosLines, COLORS, true);
      added += nosResult.added;
      updated += nosResult.updated;
      existing += nosResult.existing;
      tagLinks += nosResult.tagLinks;
    }
  });

  run();
  return NextResponse.json({ added, updated, existing, tagLinks });
}

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "", inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { fields.push(cur); cur = ""; }
    else { cur += ch; }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

// Updatable game columns (direct DB columns, not virtual like l0/genres/meta)
const GAME_COLS = new Set([
  "name", "steam_appid", "notes", "added_at", "description", "developers",
  "publishers", "release_date", "review_sentiment", "positive_percent",
  "total_reviews", "metacritic_score", "steam_genres", "steam_features",
  "community_tags", "wishlist_date", "steam_image_url",
]);

function processSection(
  db: ReturnType<typeof import("@/lib/db").getDb>,
  lines: string[],
  colors: Record<string, string>,
  fullUpdate = false,
): { added: number; updated: number; existing: number; tagLinks: number } {
  let added = 0, updated = 0, existing = 0, tagLinks = 0;

  // Filter empty lines and find header
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 2) return { added, updated, existing, tagLinks };

  const header = nonEmpty[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const iId = col("id");
  const iGame = col("name") >= 0 ? col("name") : col("game");
  const iL0 = col("l0");
  const iGenres = col("genres");
  const iMeta = col("meta");

  if (iGame < 0) return { added, updated, existing, tagLinks };

  const stmts = {
    findById: db.prepare("SELECT id FROM games WHERE id = ?"),
    findByAppid: db.prepare("SELECT id FROM games WHERE steam_appid = ?"),
    findByName: db.prepare("SELECT id FROM games WHERE LOWER(name) = LOWER(?)"),
    insGame: db.prepare("INSERT INTO games (name, notes, steam_appid) VALUES (?, ?, ?)"),
    insTag: db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)"),
    getTag: db.prepare("SELECT id FROM tags WHERE name = ?"),
    insSub: db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, ?)"),
    getSub: db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?"),
    clearGameTag: db.prepare("DELETE FROM game_tags WHERE game_id = ? AND tag_id = ?"),
    insGT: db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)"),
  };

  for (let i = 1; i < nonEmpty.length; i++) {
    const line = nonEmpty[i].trim();
    if (!line) continue;
    const fields = parseRow(line);
    const name = fields[iGame];
    if (!name) continue;

    const csvId = iId >= 0 && fields[iId] ? Number(fields[iId]) : null;
    const appidIdx = col("steam_appid");
    const appid = appidIdx >= 0 && fields[appidIdx] ? Number(fields[appidIdx]) : null;
    const notesIdx = col("notes");
    const notes = notesIdx >= 0 ? fields[notesIdx] : "";

    // Find existing game: by id first, then appid, then name
    let gameId: number | null = null;
    if (csvId) {
      const row = stmts.findById.get(csvId) as { id: number } | undefined;
      if (row) gameId = row.id;
    }
    if (!gameId && appid) {
      const row = stmts.findByAppid.get(appid) as { id: number } | undefined;
      if (row) gameId = row.id;
    }
    if (!gameId) {
      const row = stmts.findByName.get(name) as { id: number } | undefined;
      if (row) gameId = row.id;
    }

    if (gameId) {
      // Update existing game — build dynamic UPDATE from available columns
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];

      for (let c = 0; c < header.length; c++) {
        const colName = header[c];
        if (!GAME_COLS.has(colName)) continue;
        if (!fullUpdate && !["name", "notes", "steam_appid", "added_at"].includes(colName)) continue;
        const val = fields[c] || null;
        if (colName === "steam_appid" || colName === "positive_percent" || colName === "total_reviews" || colName === "metacritic_score") {
          sets.push(`${colName} = ?`);
          vals.push(val ? Number(val) : null);
        } else {
          sets.push(`${colName} = ?`);
          vals.push(val);
        }
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        vals.push(gameId);
        db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
        updated++;
      } else {
        existing++;
      }
    } else {
      // Insert new game
      gameId = Number(stmts.insGame.run(name, notes || "", appid).lastInsertRowid);
      // Update extra columns if present
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      for (let c = 0; c < header.length; c++) {
        const colName = header[c];
        if (!GAME_COLS.has(colName) || ["name", "notes", "steam_appid"].includes(colName)) continue;
        const val = fields[c] || null;
        if (val) {
          if (["positive_percent", "total_reviews", "metacritic_score"].includes(colName)) {
            sets.push(`${colName} = ?`); vals.push(Number(val));
          } else {
            sets.push(`${colName} = ?`); vals.push(val);
          }
        }
      }
      if (sets.length > 0) {
        vals.push(gameId);
        db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      }
      added++;
    }

    // Handle tags
    if (iL0 >= 0 && fields[iL0]) {
      const l0 = fields[iL0];
      stmts.insTag.run(l0, colors[l0] || "#6366f1");
      const tagId = (stmts.getTag.get(l0) as { id: number }).id;

      // Clear existing links for this game+tag, then re-create from CSV
      stmts.clearGameTag.run(gameId, tagId);

      const genresStr = iGenres >= 0 ? fields[iGenres] : "";
      const metaStr = iMeta >= 0 ? fields[iMeta] : "";
      const genres = genresStr.split("|").filter(Boolean);
      const metas = metaStr.split("|").filter(Boolean);

      if (!genres.length && !metas.length) {
        stmts.insGT.run(gameId, tagId, null);
        tagLinks++;
      }
      for (const g of genres) {
        stmts.insSub.run(tagId, g, "genre");
        const sid = (stmts.getSub.get(tagId, g) as { id: number }).id;
        stmts.insGT.run(gameId, tagId, sid);
        tagLinks++;
      }
      for (const m of metas) {
        stmts.insSub.run(tagId, m, "meta");
        const sid = (stmts.getSub.get(tagId, m) as { id: number }).id;
        stmts.insGT.run(gameId, tagId, sid);
        tagLinks++;
      }
    }
  }

  return { added, updated, existing, tagLinks };
}
