import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// GET /api/tags — list all tags with game counts
export function GET() {
  const db = getDb();
  const tags = db
    .prepare(
      `SELECT t.*, COUNT(DISTINCT gt.game_id) as game_count
       FROM tags t
       LEFT JOIN game_tags gt ON gt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`
    )
    .all();
  return NextResponse.json(tags);
}

// POST /api/tags — create a tag
export async function POST(req: NextRequest) {
  const { name, color } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const db = getDb();
  try {
    const result = db
      .prepare("INSERT INTO tags (name, color) VALUES (?, ?)")
      .run(name.trim(), color || "#6366f1");
    const tag = db.prepare("SELECT * FROM tags WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(tag, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tag already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
