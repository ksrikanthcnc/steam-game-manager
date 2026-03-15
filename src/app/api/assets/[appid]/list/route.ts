import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readdirSync, existsSync } from "fs";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");

// GET /api/assets/:appid/list — list all media files on disk for a game
export async function GET(_req: NextRequest, { params }: { params: Promise<{ appid: string }> }) {
  const { appid } = await params;
  const dir = path.join(ASSETS_DIR, appid);
  if (!existsSync(dir)) return NextResponse.json({ screenshots: 0, movies: 0, header: false });

  const files = readdirSync(dir);
  const header = files.includes("header.jpg");
  const ssSet = new Set<number>();
  const hdSet = new Set<number>();
  const movieSet = new Set<number>();

  for (const f of files) {
    let m = f.match(/^ss_(\d+)\.jpg$/);
    if (m) { ssSet.add(Number(m[1])); continue; }
    m = f.match(/^ss_(\d+)_hd\.jpg$/);
    if (m) { hdSet.add(Number(m[1])); continue; }
    m = f.match(/^movie_(\d+)\.jpg$/);
    if (m) { movieSet.add(Number(m[1])); continue; }
  }

  return NextResponse.json({
    header,
    screenshots: ssSet.size,
    hdScreenshots: hdSet.size,
    movies: movieSet.size,
  });
}
