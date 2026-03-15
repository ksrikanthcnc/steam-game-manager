import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "games.db");

let db: Database.Database | null = null;

export function resetDb(): void {
  if (db) { db.close(); db = null; }
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

export function reinitDb(): void {
  if (db) { db.close(); db = null; }
  getDb(); // re-opens and re-runs initSchema (column migrations + asset sync)
}

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const start = Date.now();
  console.log("[db] Initializing database...");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);
  console.log(`[db] Ready in ${Date.now() - start}ms`);
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'genre',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(tag_id, name)
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steam_appid INTEGER,
      steam_image_url TEXT,
      description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      steam_genres TEXT DEFAULT '[]',
      steam_features TEXT DEFAULT '[]',
      community_tags TEXT DEFAULT '[]',
      developers TEXT DEFAULT '',
      publishers TEXT DEFAULT '',
      release_date TEXT DEFAULT '',
      review_sentiment TEXT DEFAULT '',
      positive_percent INTEGER DEFAULT 0,
      total_reviews INTEGER DEFAULT 0,
      metacritic_score INTEGER DEFAULT 0,
      screenshots TEXT DEFAULT '[]',
      movies TEXT DEFAULT '[]',
      total_screenshots INTEGER DEFAULT 0,
      total_movies INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      subtag_id INTEGER,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE SET NULL,
      UNIQUE(game_id, tag_id, subtag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
    CREATE INDEX IF NOT EXISTS idx_game_tags_game ON game_tags(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags(tag_id);
  `);

  // Migration: add type column to subtags if missing
  const cols = db.prepare("PRAGMA table_info(subtags)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "type")) {
    db.exec("ALTER TABLE subtags ADD COLUMN type TEXT DEFAULT 'genre'");
  }

  // Migration: add movies column to games if missing
  const gameCols = db.prepare("PRAGMA table_info(games)").all() as { name: string }[];
  if (!gameCols.some((c) => c.name === "movies")) {
    db.exec("ALTER TABLE games ADD COLUMN movies TEXT DEFAULT '[]'");
  }

  // Migration: add total_screenshots / total_movies columns
  if (!gameCols.some((c) => c.name === "total_screenshots")) {
    db.exec("ALTER TABLE games ADD COLUMN total_screenshots INTEGER DEFAULT 0");
  }
  if (!gameCols.some((c) => c.name === "total_movies")) {
    db.exec("ALTER TABLE games ADD COLUMN total_movies INTEGER DEFAULT 0");
  }
  if (!gameCols.some((c) => c.name === "wishlist_date")) {
    db.exec("ALTER TABLE games ADD COLUMN wishlist_date TEXT");
  }

  // Migration: add added_at column + backfill from wishlist_date
  if (!gameCols.some((c) => c.name === "added_at")) {
    db.exec("ALTER TABLE games ADD COLUMN added_at TEXT");
    // Backfill: copy existing wishlist_date (which has real+fallback mix) into added_at
    db.exec("UPDATE games SET added_at = wishlist_date WHERE wishlist_date IS NOT NULL AND wishlist_date != ''");
    // For any remaining NULLs, use today's date
    const today = new Date().toISOString().split("T")[0];
    db.prepare("UPDATE games SET added_at = ? WHERE added_at IS NULL OR added_at = ''").run(today);
  }

  // Startup: sync total_screenshots/total_movies from disk
  syncAssetCounts(db);
}

/** Ensure "steam" L0 tag with subtags: wishlist, removed_from_wishlist, owned, ignored, played_elsewhere */
export function ensureSteamTag(db: Database.Database): {
  tagId: number;
  subtags: Record<string, number>;
} {
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES ('steam', '#66c0f4')").run();
  const tag = db.prepare("SELECT id FROM tags WHERE name = 'steam'").get() as { id: number };
  const names = ["wishlist", "removed_from_wishlist", "owned", "ignored", "played_elsewhere"];
  const subtags: Record<string, number> = {};
  for (const name of names) {
    const stype = (name === "wishlist" || name === "owned") ? "meta" : "meta";
    db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, ?)").run(tag.id, name, stype);
    const row = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?").get(tag.id, name) as { id: number };
    subtags[name] = row.id;
  }
  return { tagId: tag.id, subtags };
}

function syncAssetCounts(db: Database.Database) {
  const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");
  if (!fs.existsSync(ASSETS_DIR)) return;

  const games = db.prepare("SELECT id, steam_appid FROM games").all() as { id: number; steam_appid: number | null }[];
  const update = db.prepare("UPDATE games SET total_screenshots = ?, total_movies = ? WHERE id = ? AND (total_screenshots != ? OR total_movies != ?)");

  let changed = 0;
  const tx = db.transaction(() => {
    for (const g of games) {
      const dir = path.join(ASSETS_DIR, String(g.steam_appid || `manual_${g.id}`));
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      const ss = files.filter((f) => /^ss_\d+\.jpg$/.test(f)).length;
      const mov = files.filter((f) => f.endsWith(".mp4")).length;
      const r = update.run(ss, mov, g.id, ss, mov);
      if (r.changes > 0) changed++;
    }
  });
  tx();
  const scanned = games.filter(g => fs.existsSync(path.join(ASSETS_DIR, String(g.steam_appid || `manual_${g.id}`)))).length;
  console.log(`[db] Asset scan: ${scanned} games checked, ${changed} updated`);
}

/** Read Steam API key and Steam ID from the settings table */
export function getSteamCredentials(db: Database.Database): { steamId: string; apiKey: string } {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const get = (key: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || "";
  };
  return { steamId: get("steam_id"), apiKey: get("steam_api_key") };
}
