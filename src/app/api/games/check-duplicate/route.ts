import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// GET /api/games/check-duplicate?name=X — check if a game name already exists
export function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ exists: false });

  const db = getDb();
  const existing = db
    .prepare("SELECT id, name FROM games WHERE LOWER(name) = LOWER(?)")
    .all(name.trim());

  return NextResponse.json({
    exists: existing.length > 0,
    matches: existing,
  });
}
