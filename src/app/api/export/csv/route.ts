import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

// All possible columns for CSV export (excluding internal timestamps)
const ALL_COLS = [
  "id", "name", "steam_appid", "notes", "added_at", "l0", "genres", "meta",
  "description", "developers", "publishers", "release_date",
  "review_sentiment", "positive_percent", "total_reviews", "metacritic_score",
  "steam_genres", "steam_features", "community_tags",
  "wishlist_date", "steam_image_url",
] as const;

// Default columns for the main section
const DEFAULT_COLS = ["id", "name", "steam_appid", "notes", "added_at", "l0", "genres", "meta"];

// Not-on-steam section always gets all columns
const NOS_COLS = ALL_COLS;

function escape(s: string | null | undefined): string {
  if (!s) return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type GameRow = {
  id: number; name: string; steam_appid: number | null; notes: string;
  added_at: string | null; tag_name: string | null;
  genres: string | null; meta: string | null;
  description: string; developers: string; publishers: string;
  release_date: string; review_sentiment: string;
  positive_percent: number; total_reviews: number; metacritic_score: number;
  steam_genres: string; steam_features: string; community_tags: string;
  wishlist_date: string | null; steam_image_url: string | null;
};

function colValue(row: GameRow, col: string): string {
  switch (col) {
    case "id": return String(row.id);
    case "name": return escape(row.name);
    case "steam_appid": return row.steam_appid ? String(row.steam_appid) : "";
    case "notes": return escape(row.notes);
    case "added_at": return row.added_at || "";
    case "l0": return escape(row.tag_name);
    case "genres": return escape(row.genres);
    case "meta": return escape(row.meta);
    case "description": return escape(row.description);
    case "developers": return escape(row.developers);
    case "publishers": return escape(row.publishers);
    case "release_date": return escape(row.release_date);
    case "review_sentiment": return escape(row.review_sentiment);
    case "positive_percent": return row.positive_percent ? String(row.positive_percent) : "";
    case "total_reviews": return row.total_reviews ? String(row.total_reviews) : "";
    case "metacritic_score": return row.metacritic_score ? String(row.metacritic_score) : "";
    case "steam_genres": return escape(row.steam_genres === "[]" ? "" : row.steam_genres);
    case "steam_features": return escape(row.steam_features === "[]" ? "" : row.steam_features);
    case "community_tags": return escape(row.community_tags === "[]" ? "" : row.community_tags);
    case "wishlist_date": return row.wishlist_date || "";
    case "steam_image_url": return escape(row.steam_image_url);
    default: return "";
  }
}

export function GET() {
  const db = getDb();

  // Read configured columns from settings
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'csv_export_columns'").get() as { value: string } | undefined;
  const mainCols = settingRow ? JSON.parse(settingRow.value) as string[] : DEFAULT_COLS;

  const rows = db.prepare(`
    SELECT g.id, g.name, g.steam_appid, g.notes, g.added_at,
           g.description, g.developers, g.publishers, g.release_date,
           g.review_sentiment, g.positive_percent, g.total_reviews, g.metacritic_score,
           g.steam_genres, g.steam_features, g.community_tags,
           g.wishlist_date, g.steam_image_url,
           t.name as tag_name,
           GROUP_CONCAT(CASE WHEN s.type = 'genre' THEN s.name END, '|') as genres,
           GROUP_CONCAT(CASE WHEN s.type = 'meta' THEN s.name END, '|') as meta
    FROM games g
    LEFT JOIN game_tags gt ON gt.game_id = g.id
    LEFT JOIN tags t ON t.id = gt.tag_id
    LEFT JOIN subtags s ON s.id = gt.subtag_id
    GROUP BY g.id, gt.tag_id
    ORDER BY g.id, t.name
  `).all() as GameRow[];

  // Split into steam and not-on-steam
  const steamRows = rows.filter((r) => r.steam_appid != null);
  const nosIds = new Set(rows.filter((r) => r.steam_appid == null).map((r) => r.id));
  const nosRows = rows.filter((r) => nosIds.has(r.id));

  // Main section
  const csvLines: string[] = [];
  csvLines.push(mainCols.join(","));
  for (const row of steamRows) {
    csvLines.push(mainCols.map((c) => colValue(row, c)).join(","));
  }

  // Not-on-steam section (all columns, always)
  if (nosRows.length > 0) {
    csvLines.push("");
    csvLines.push("#NOT_ON_STEAM");
    const nosCols = Array.from(NOS_COLS);
    csvLines.push(nosCols.join(","));
    for (const row of nosRows) {
      csvLines.push(nosCols.map((c) => colValue(row, c)).join(","));
    }
  }

  const csv = csvLines.join("\n") + "\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="games-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
