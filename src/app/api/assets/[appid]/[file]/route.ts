import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ appid: string; file: string }> }
) {
  const { appid, file } = await params;
  if (!/^[\w.-]+$/.test(file) || !/^(manual_)?\d+$/.test(appid)) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }

  let filePath = path.join(ASSETS_DIR, appid, file);

  // Fallback: HD → low-res, low-res → HD
  if (!existsSync(filePath)) {
    const hdMatch = file.match(/^(ss_\d+)_hd\.jpg$/);
    const loMatch = file.match(/^(ss_\d+)\.jpg$/);
    if (hdMatch) {
      const fallback = path.join(ASSETS_DIR, appid, `${hdMatch[1]}.jpg`);
      if (existsSync(fallback)) filePath = fallback;
    } else if (loMatch) {
      const fallback = path.join(ASSETS_DIR, appid, `${loMatch[1]}_hd.jpg`);
      if (existsSync(fallback)) filePath = fallback;
    }
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const data = await readFile(filePath);
  const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return new NextResponse(data, {
    headers: { "Content-Type": mime, "Cache-Control": "no-cache" },
  });
}
