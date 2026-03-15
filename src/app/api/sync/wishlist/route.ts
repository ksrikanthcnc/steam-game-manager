import { getDb, ensureSteamTag, getSteamCredentials } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const db = getDb();
        const { steamId, apiKey } = getSteamCredentials(db);
        if (!steamId || !apiKey) {
          send({ type: "error", message: "Steam ID and API Key must be configured in Settings." });
          controller.close();
          return;
        }

        // Ensure wishlist_date column
        const cols = db.prepare("PRAGMA table_info(games)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "wishlist_date")) {
          db.exec("ALTER TABLE games ADD COLUMN wishlist_date TEXT");
        }

        send({ type: "status", message: "Fetching wishlist from Steam..." });

        // 1. Fetch wishlist (with retry)
        let wlData: { response?: { items?: { appid: number; date_added: number }[] } } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const wlRes = await fetch(
            `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}&key=${apiKey}`
          );
          if (wlRes.ok) { wlData = await wlRes.json(); break; }
          if (wlRes.status === 429 || wlRes.status >= 500) {
            send({ type: "status", message: `Steam API ${wlRes.status}, retrying in ${(attempt + 1) * 5}s...` });
            await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
            continue;
          }
          send({ type: "error", message: `Steam API error: ${wlRes.status}` }); controller.close(); return;
        }
        if (!wlData) { send({ type: "error", message: "Failed after 3 retries" }); controller.close(); return; }
        const items = wlData?.response?.items || [];
        send({ type: "status", message: `Found ${items.length} wishlist items` });

        if (items.length === 0) { send({ type: "done", added: 0, existing: 0, removed: 0 }); controller.close(); return; }

        // 2. Build name map from Steam GetAppList
        send({ type: "status", message: "Fetching Steam app list for name resolution..." });
        const nameMap = new Map<number, string>();
        try {
          const appListRes = await fetch("https://api.steampowered.com/ISteamApps/GetAppList/v2/");
          if (appListRes.ok) {
            const appListData = await appListRes.json() as { applist?: { apps?: { appid: number; name: string }[] } };
            for (const app of appListData?.applist?.apps || []) {
              if (app.name) nameMap.set(app.appid, app.name);
            }
          }
        } catch { /* continue without */ }
        send({ type: "status", message: `Name map: ${nameMap.size} entries` });

        // 3. Ensure steam tag with subtags
        const { tagId, subtags } = ensureSteamTag(db);
        const wishlistSubId = subtags.wishlist;

        const findGame = db.prepare("SELECT id FROM games WHERE steam_appid = ?");
        const insGame = db.prepare("INSERT INTO games (name, steam_appid, wishlist_date, added_at) VALUES (?, ?, ?, ?)");
        const insGT = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)");
        const updateWishDate = db.prepare("UPDATE games SET wishlist_date = ? WHERE id = ? AND (wishlist_date IS NULL OR wishlist_date = '')");

        let added = 0, existing = 0, unnamed = 0, tagged = 0;
        const wishlistAppIds = new Set<number>();
        const newItems: { appid: number; wishDate: string | null }[] = [];

        // Fast pass: check existing games in bulk
        for (const item of items) {
          const appid = item.appid;
          wishlistAppIds.add(appid);
          const wishDate = item.date_added ? new Date(item.date_added * 1000).toISOString().split("T")[0] : null;

          const ex = findGame.get(appid) as { id: number } | undefined;
          if (ex) {
            existing++;
            const r = insGT.run(ex.id, tagId, wishlistSubId);
            if (r.changes > 0) tagged++;
            if (wishDate) updateWishDate.run(wishDate, ex.id);
          } else {
            newItems.push({ appid, wishDate });
          }
        }

        send({ type: "status", message: `${existing} already in DB, ${newItems.length} new to resolve` });

        // Only fetch names for truly new games
        for (let i = 0; i < newItems.length; i++) {
          const { appid, wishDate } = newItems[i];
          let name = nameMap.get(appid);

          if (!name) {
            try {
              const detRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
              if (detRes.ok) {
                const detData = await detRes.json() as Record<string, { success: boolean; data?: { name?: string } }>;
                if (detData?.[String(appid)]?.success) {
                  name = detData[String(appid)].data?.name || undefined;
                }
              }
            } catch { /* ignore */ }
          }

          if (!name) { unnamed++; continue; }
          const today = new Date().toISOString().split("T")[0];
          const gameId = Number(insGame.run(name, appid, wishDate, today).lastInsertRowid);
          insGT.run(gameId, tagId, wishlistSubId);
          added++;
          tagged++;

          send({ type: "progress", current: i + 1, total: newItems.length, added, unnamed, name });
        }

        // 4. Detect removed wishlist items
        // Games that have the steam/wishlist subtag but their appid is NOT in the current wishlist
        const dbWishlistGames = db.prepare(`
          SELECT g.id, g.steam_appid, g.name FROM games g
          JOIN game_tags gt ON gt.game_id = g.id
          WHERE gt.tag_id = ? AND gt.subtag_id = ? AND g.steam_appid IS NOT NULL
        `).all(tagId, wishlistSubId) as { id: number; steam_appid: number; name: string }[];

        const removed: string[] = [];
        const rmSubId = subtags.removed_from_wishlist;

        for (const g of dbWishlistGames) {
          if (!wishlistAppIds.has(g.steam_appid)) {
            // Tag with removed_from_wishlist subtag
            db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)").run(g.id, tagId, rmSubId);
            removed.push(g.name);
          }
        }

        send({
          type: "done",
          added, existing, unnamed, tagged,
          removed: removed.length,
          removedNames: removed.slice(0, 20),
          message: `Wishlist sync complete: ${added} new, ${existing} existing, ${removed.length} removed`,
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
