import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

function ensureDetailsCacheTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS steam_details_cache (
      appid INTEGER PRIMARY KEY,
      name TEXT,
      header_image TEXT,
      short_description TEXT,
      genres TEXT,
      categories TEXT,
      raw_json TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

// GET /api/steam/details?appid=X — get full Steam app details, cached
export async function GET(req: NextRequest) {
  const appid = req.nextUrl.searchParams.get("appid");
  if (!appid) return NextResponse.json({ error: "appid required" }, { status: 400 });

  const db = ensureDetailsCacheTable();

  // Check cache
  const cached = db
    .prepare("SELECT * FROM steam_details_cache WHERE appid = ?")
    .get(appid) as { appid: number; raw_json: string } | undefined;

  if (cached) {
    return NextResponse.json({ ...JSON.parse(cached.raw_json), source: "cache" });
  }

  // Fetch from Steam
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`;
    const res = await fetch(url, {
      headers: { "User-Agent": "GameCollectionManager/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Steam API error" }, { status: 502 });
    }

    const data = await res.json();
    const appData = data[appid];

    if (!appData?.success) {
      return NextResponse.json({ error: "App not found on Steam" }, { status: 404 });
    }

    const details = appData.data;

    // Cache with extracted fields + full raw JSON
    db.prepare(
      `INSERT OR REPLACE INTO steam_details_cache 
       (appid, name, header_image, short_description, genres, categories, raw_json) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      appid,
      details.name || null,
      details.header_image || null,
      details.short_description || null,
      JSON.stringify(details.genres || []),
      JSON.stringify(details.categories || []),
      JSON.stringify(details)
    );

    return NextResponse.json({ ...details, source: "steam" });
  } catch {
    return NextResponse.json({ error: "Failed to fetch from Steam" }, { status: 500 });
  }
}
