import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// GET /api/subtags?tag_id=X — list subtags for a tag (or all)
export function GET(req: NextRequest) {
  const tagId = req.nextUrl.searchParams.get("tag_id");
  const db = getDb();
  if (tagId) {
    const subtags = db.prepare("SELECT * FROM subtags WHERE tag_id = ? ORDER BY name").all(tagId);
    return NextResponse.json(subtags);
  }
  const subtags = db.prepare("SELECT s.*, t.name as tag_name FROM subtags s JOIN tags t ON t.id = s.tag_id ORDER BY t.name, s.name").all();
  return NextResponse.json(subtags);
}

// POST /api/subtags — create a subtag
export async function POST(req: NextRequest) {
  const { tag_id, name, type } = await req.json();
  if (!tag_id || !name?.trim()) {
    return NextResponse.json({ error: "tag_id and name are required" }, { status: 400 });
  }
  const db = getDb();
  try {
    const subType = type === "meta" ? "meta" : "genre";
    const result = db.prepare("INSERT INTO subtags (tag_id, name, type) VALUES (?, ?, ?)").run(tag_id, name.trim(), subType);
    const subtag = db.prepare("SELECT * FROM subtags WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(subtag, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Subtag already exists for this tag" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
