import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const db = getDb();
    const result = db.pragma("wal_checkpoint(TRUNCATE)");
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
