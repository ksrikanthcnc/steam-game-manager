import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// Ensure settings table exists
function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  return db;
}

const DEFAULTS: Record<string, string> = {
  screenshot_quality: "thumbnail", // "thumbnail" (600x338) or "full" (1920x1080)
  max_screenshots: "5",
  max_movies: "2",
  slideshow_speed: "1", // seconds
  clip_partial_limit: "8",    // max partial matches shown
  clip_fuzzy_limit: "6",      // max fuzzy matches shown
  clip_fuzzy_threshold: "0.5", // minimum similarity score for fuzzy match
  card_default_image: "header", // "header", "ss_0", "ss_1", "ss_2", etc.
  card_genres_count: "3",       // max genres shown on card
  card_community_tags_count: "4", // max community tags shown on card
  csv_export_columns: '["id","name","steam_appid","notes","added_at","l0","genres","meta"]',
};

// GET /api/settings — return all settings
export async function GET() {
  const db = ensureTable();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return NextResponse.json(settings);
}

// PUT /api/settings — update a setting
export async function PUT(req: NextRequest) {
  const db = ensureTable();
  const { key, value } = await req.json();
  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
  return NextResponse.json({ ok: true });
}
