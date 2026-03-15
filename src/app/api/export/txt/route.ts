import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

// GET /api/export/txt — export in cleanup-style tree format
// tag (0 indent)
//   plain games (1 indent)
//   --- meta (1 indent)
//     --- genre (2 indent)
//       game (3 indent)
//     meta-only game (2 indent)
//   --- genre (1 indent)
//     genre-only game (2 indent)
export function GET() {
  const db = getDb();

  const rows = db.prepare(`
    SELECT g.id, g.name, g.steam_appid, g.notes, g.added_at,
           t.name as tag_name,
           s.name as subtag_name, s.type as subtag_type
    FROM games g
    LEFT JOIN game_tags gt ON gt.game_id = g.id
    LEFT JOIN tags t ON t.id = gt.tag_id
    LEFT JOIN subtags s ON s.id = gt.subtag_id
    ORDER BY t.name, g.id ASC
  `).all() as {
    id: number; name: string; steam_appid: number | null; notes: string; added_at: string | null;
    tag_name: string | null; subtag_name: string | null; subtag_type: string | null;
  }[];

  type GameInfo = {
    id: number; name: string; steam_appid: number | null;
    notes: string; added_at: string | null;
    metas: string[]; genres: string[];
  };

  const tagMap = new Map<string, Map<number, GameInfo>>();
  const untaggedMap = new Map<number, GameInfo>();

  for (const r of rows) {
    if (!r.tag_name) {
      if (!untaggedMap.has(r.id))
        untaggedMap.set(r.id, { id: r.id, name: r.name, steam_appid: r.steam_appid, notes: r.notes, added_at: r.added_at, metas: [], genres: [] });
      continue;
    }
    if (!tagMap.has(r.tag_name)) tagMap.set(r.tag_name, new Map());
    const gMap = tagMap.get(r.tag_name)!;
    if (!gMap.has(r.id))
      gMap.set(r.id, { id: r.id, name: r.name, steam_appid: r.steam_appid, notes: r.notes, added_at: r.added_at, metas: [], genres: [] });
    const entry = gMap.get(r.id)!;
    if (r.subtag_name) {
      // not_on_steam is treated as a regular genre subtag (gets its own section)
      if (r.subtag_type === "meta") {
        if (!entry.metas.includes(r.subtag_name)) entry.metas.push(r.subtag_name);
      } else {
        if (!entry.genres.includes(r.subtag_name)) entry.genres.push(r.subtag_name);
      }
    }
  }

  const lines: string[] = [];

  for (const [tagName, gMap] of tagMap) {
    lines.push(`--- ${tagName}`);
    const all = Array.from(gMap.values());
    all.sort((a, b) => a.id - b.id);

    // 1) Plain — no subtags (at top, no header)
    const plain = all.filter((g) => g.metas.length === 0 && g.genres.length === 0);
    for (const g of plain) writeName(lines, g, "\t");

    // 2) Meta sections (alpha sorted)
    const withMeta = all.filter((g) => g.metas.length > 0);
    const metaSections = new Map<string, GameInfo[]>();
    for (const g of withMeta) {
      const k = g.metas[0];
      if (!metaSections.has(k)) metaSections.set(k, []);
      metaSections.get(k)!.push(g);
    }
    for (const mk of Array.from(metaSections.keys()).sort()) {
      lines.push(`\t--- ${mk}`);
      const metaIsNos = mk === "not_on_steam";
      const games = metaSections.get(mk)!;
      const withGenre = games.filter((g) => g.genres.length > 0);
      const noGenre = games.filter((g) => g.genres.length === 0);
      const genreGroups = new Map<string, GameInfo[]>();
      for (const g of withGenre) {
        const k = g.genres[0];
        if (!genreGroups.has(k)) genreGroups.set(k, []);
        genreGroups.get(k)!.push(g);
      }
      for (const gk of Array.from(genreGroups.keys()).sort()) {
        lines.push(`\t\t--- ${gk}`);
        const isNos = metaIsNos || gk === "not_on_steam";
        for (const g of genreGroups.get(gk)!) writeName(lines, g, "\t\t\t", isNos);
      }
      for (const g of noGenre) writeName(lines, g, "\t\t", metaIsNos);
    }

    // 3) Genre only — no meta
    const genreOnly = all.filter((g) => g.metas.length === 0 && g.genres.length > 0);
    const genreSections = new Map<string, GameInfo[]>();
    for (const g of genreOnly) {
      const k = g.genres[0];
      if (!genreSections.has(k)) genreSections.set(k, []);
      genreSections.get(k)!.push(g);
    }
    for (const gk of Array.from(genreSections.keys()).sort()) {
      lines.push(`\t--- ${gk}`);
      const isNos = gk === "not_on_steam";
      for (const g of genreSections.get(gk)!) writeName(lines, g, "\t\t", isNos);
    }
  }

  if (untaggedMap.size > 0) {
    lines.push(`--- untagged`);
    for (const g of untaggedMap.values()) writeName(lines, g, "\t");
  }

  const txt = lines.join("\n") + "\n";
  return new NextResponse(txt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="games-export-${new Date().toISOString().slice(0, 10)}.txt"`,
    },
  });
}

function writeName(lines: string[], g: { name: string; steam_appid: number | null; notes: string }, indent: string, inNotOnSteamSection = false) {
  // Inside a not_on_steam section: always --- prefix
  // Outside: --- prefix only if no steam_appid
  const prefix = inNotOnSteamSection || !g.steam_appid ? "--- " : "";
  lines.push(`${indent}${prefix}${g.name}`);
  if (g.notes?.trim()) lines.push(`${indent}\t--- note: ${g.notes.trim()}`);
}
