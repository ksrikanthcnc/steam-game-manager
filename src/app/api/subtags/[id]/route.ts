import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// DELETE /api/subtags/:id
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM subtags WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}

// PUT /api/subtags/:id
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, type } = await req.json();
  const db = getDb();
  if (name?.trim()) {
    db.prepare("UPDATE subtags SET name = ? WHERE id = ?").run(name.trim(), id);
  }
  if (type === "genre" || type === "meta") {
    db.prepare("UPDATE subtags SET type = ? WHERE id = ?").run(type, id);
  }
  const subtag = db.prepare("SELECT * FROM subtags WHERE id = ?").get(id);
  return NextResponse.json(subtag);
}
