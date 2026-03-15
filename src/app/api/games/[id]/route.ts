import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// GET /api/games/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(id);
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tags = db
    .prepare(
      `SELECT gt.*, t.name as tag_name, t.color as tag_color, s.name as subtag_name, s.type as subtag_type
       FROM game_tags gt
       JOIN tags t ON t.id = gt.tag_id
       LEFT JOIN subtags s ON s.id = gt.subtag_id
       WHERE gt.game_id = ?`
    )
    .all(id);

  return NextResponse.json({ ...(game as object), tags });
}

// PUT /api/games/:id
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, notes, tags } = body;
  const db = getDb();

  // Check for duplicate steam_appid
  if ("steam_appid" in body && body.steam_appid) {
    const existing = db.prepare("SELECT id, name FROM games WHERE steam_appid = ? AND id != ?").get(body.steam_appid, id) as { id: number; name: string } | undefined;
    if (existing) {
      return NextResponse.json({ error: `Steam AppID ${body.steam_appid} already used by "${existing.name}" (id ${existing.id})` }, { status: 409 });
    }
  }

  // Only update scalar fields that are explicitly provided
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  if (name !== undefined) { sets.push("name = ?"); vals.push(name?.trim() || null); }
  if ("steam_appid" in body) { sets.push("steam_appid = ?"); vals.push(body.steam_appid ?? null); }
  if (notes !== undefined) { sets.push("notes = ?"); vals.push(notes ?? null); }
  if ("description" in body) { sets.push("description = ?"); vals.push(body.description ?? ""); }
  if ("steam_genres" in body) { sets.push("steam_genres = ?"); vals.push(typeof body.steam_genres === "string" ? body.steam_genres : JSON.stringify(body.steam_genres ?? [])); }
  if ("steam_features" in body) { sets.push("steam_features = ?"); vals.push(typeof body.steam_features === "string" ? body.steam_features : JSON.stringify(body.steam_features ?? [])); }
  if ("developers" in body) { sets.push("developers = ?"); vals.push(body.developers ?? ""); }
  if ("publishers" in body) { sets.push("publishers = ?"); vals.push(body.publishers ?? ""); }
  if ("release_date" in body) { sets.push("release_date = ?"); vals.push(body.release_date ?? ""); }
  if ("added_at" in body) { sets.push("added_at = ?"); vals.push(body.added_at ?? null); }
  vals.push(id);

  db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

  // If tags array provided, replace all tag associations
  if (Array.isArray(tags)) {
    db.prepare("DELETE FROM game_tags WHERE game_id = ?").run(id);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)"
    );
    for (const t of tags) {
      insert.run(id, t.tag_id, t.subtag_id || null);
    }
  }

  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(id);
  const gameTags = db
    .prepare(
      `SELECT gt.*, t.name as tag_name, t.color as tag_color, s.name as subtag_name, s.type as subtag_type
       FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
       LEFT JOIN subtags s ON s.id = gt.subtag_id
       WHERE gt.game_id = ?`
    )
    .all(id);

  return NextResponse.json({ ...(game as object), tags: gameTags });
}

// DELETE /api/games/:id
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM games WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
