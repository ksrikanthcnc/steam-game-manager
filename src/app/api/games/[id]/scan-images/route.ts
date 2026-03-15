import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");

// POST /api/games/:id/scan-images — scan manual folder and update screenshots
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const game = db.prepare("SELECT id, steam_appid FROM games WHERE id = ?").get(id) as { id: number; steam_appid: number | null } | undefined;
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const folder = game.steam_appid ? String(game.steam_appid) : `manual_${game.id}`;
  const dir = path.join(ASSETS_DIR, folder);

  if (!existsSync(dir)) {
    return NextResponse.json({ screenshots: 0, header: false, message: `Folder not found: ${folder}/` });
  }

  const files = readdirSync(dir);
  const header = files.includes("header.jpg");
  const ssFiles = files.filter((f) => /^ss_\d+(_hd)?\.jpg$/.test(f));
  const ssIndices = new Set(ssFiles.map((f) => f.match(/^ss_(\d+)/)?.[1]).filter(Boolean));
  const ssCount = ssIndices.size;

  // Build a placeholder screenshots array (just needs the right length)
  const ssArray = Array.from({ length: ssCount }, (_, i) => `ss_${i}.jpg`);
  db.prepare("UPDATE games SET screenshots = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(ssArray), id);

  return NextResponse.json({ screenshots: ssCount, header, folder, message: `Found ${ssCount} screenshots, header: ${header}` });
}
