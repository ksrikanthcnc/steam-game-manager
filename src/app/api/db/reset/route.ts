import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Re-run DB init: migrations, asset count sync, steam tag migration */
export async function POST() {
  try {
    // Force re-init by closing and re-opening
    const { reinitDb } = await import("@/lib/db");
    reinitDb();
    return NextResponse.json({ ok: true, message: "Database re-initialized" });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
