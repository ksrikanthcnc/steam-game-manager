import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// PUT /api/tags/:id — update a tag
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, color } = await req.json();
  const db = getDb();
  db.prepare("UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?").run(
    name?.trim() || null,
    color || null,
    id
  );
  const tag = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  return NextResponse.json(tag);
}

// DELETE /api/tags/:id — delete a tag and its associations
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
