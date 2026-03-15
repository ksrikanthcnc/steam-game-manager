import { getDb, ensureSteamTag } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync/ignored
 * Accepts either:
 *   - Full dynamicstore JSON blob (auto-extracts rgIgnoredApps)
 *   - { appids: number[] } (legacy format)
 *   - Raw rgIgnoredApps object { "appid": type } or array [appid, ...]
 *
 * rgIgnoredApps types: 0 = not interested, 1 = played on another platform
 */
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const body = await req.json();

        // Parse input: extract appid→type map from various formats
        const appMap = new Map<number, number>(); // appid → ignore type (0=not interested, 1=played elsewhere)

        if (body.rgIgnoredApps) {
          // Full dynamicstore blob
          parseIgnoredApps(body.rgIgnoredApps, appMap);
        } else if (body.appids && Array.isArray(body.appids)) {
          // Legacy format: { appids: [123, 456] }
          for (const id of body.appids) appMap.set(Number(id), 0);
        } else if (Array.isArray(body)) {
          // Raw array
          for (const id of body) appMap.set(Number(id), 0);
        } else if (typeof body === "object" && !body.appids && !body.rgIgnoredApps) {
          // Raw object { "appid": type }
          parseIgnoredApps(body, appMap);
        }

        if (appMap.size === 0) {
          send({ type: "error", message: "No ignored apps found in input" });
          controller.close();
          return;
        }

        const db = getDb();
        const type0 = [...appMap.values()].filter(v => v === 0).length;
        const typeOther = appMap.size - type0;
        send({ type: "status", message: `Found ${appMap.size} ignored apps (${type0} not interested, ${typeOther} played elsewhere)` });

        // Ensure steam tag with subtags
        const { tagId, subtags } = ensureSteamTag(db);
        const ignoredSubId = subtags.ignored;
        const peSubId = subtags.played_elsewhere;

        const findGame = db.prepare("SELECT id FROM games WHERE steam_appid = ?");
        const insGT = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)");
        const insGame = db.prepare("INSERT INTO games (name, steam_appid, added_at) VALUES (?, ?, ?)");

        // Split into existing vs new
        let tagged = 0;
        const newAppids: { appid: number; ignoreType: number }[] = [];

        for (const [appid, ignoreType] of appMap) {
          const ex = findGame.get(appid) as { id: number } | undefined;
          if (ex) {
            const subId = ignoreType !== 0 ? peSubId : ignoredSubId;
            const r = insGT.run(ex.id, tagId, subId);
            if (r.changes > 0) tagged++;
          } else {
            newAppids.push({ appid, ignoreType });
          }
        }

        send({ type: "status", message: `${appMap.size - newAppids.length} existing games tagged, ${newAppids.length} new to resolve` });

        // Resolve names for new games
        let added = 0, unnamed = 0;
        if (newAppids.length > 0) {
          send({ type: "status", message: "Fetching Steam app list for name resolution..." });
          const nameMap = new Map<number, string>();
          try {
            const res = await fetch("https://api.steampowered.com/ISteamApps/GetAppList/v2/");
            if (res.ok) {
              const data = await res.json() as { applist?: { apps?: { appid: number; name: string }[] } };
              for (const app of data?.applist?.apps || []) {
                if (app.name) nameMap.set(app.appid, app.name);
              }
            }
          } catch { /* continue without */ }
          send({ type: "status", message: `Name map: ${nameMap.size} entries` });

          const today = new Date().toISOString().split("T")[0];

          for (let i = 0; i < newAppids.length; i++) {
            const { appid, ignoreType } = newAppids[i];
            let name = nameMap.get(appid);

            if (!name) {
              try {
                const detRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
                if (detRes.ok) {
                  const detData = await detRes.json() as Record<string, { success: boolean; data?: { name?: string } }>;
                  if (detData?.[String(appid)]?.success) name = detData[String(appid)].data?.name;
                }
              } catch { /* ignore */ }
            }

            if (!name) { unnamed++; continue; }

            const gameId = Number(insGame.run(name, appid, today).lastInsertRowid);
            const subId = ignoreType !== 0 ? peSubId : ignoredSubId;
            insGT.run(gameId, tagId, subId);
            added++;

            send({ type: "progress", current: i + 1, total: newAppids.length, added, unnamed, name });
          }
        }

        send({
          type: "done",
          tagged, added, unnamed,
          total: appMap.size,
          message: `Ignored sync: ${tagged} existing tagged, ${added} new added, ${unnamed} unresolved (${appMap.size} total)`,
        });
      } catch (err) {
        send({ type: "error", message: String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

function parseIgnoredApps(data: unknown, map: Map<number, number>) {
  if (Array.isArray(data)) {
    for (const id of data) map.set(Number(id), 0);
  } else if (typeof data === "object" && data !== null) {
    for (const [key, val] of Object.entries(data)) {
      const appid = Number(key);
      if (appid) map.set(appid, typeof val === "number" ? val : 0);
    }
  }
}
