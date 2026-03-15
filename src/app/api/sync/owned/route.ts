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

        send({ type: "status", message: "Fetching owned games from Steam..." });

        const res = await fetch(
          `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
        );
        if (!res.ok) {
          send({ type: "error", message: `Steam API error: ${res.status}` });
          controller.close();
          return;
        }

        const data = await res.json() as {
          response?: {
            game_count?: number;
            games?: { appid: number; name: string; playtime_forever?: number }[];
          };
        };
        const games = data?.response?.games || [];
        send({ type: "status", message: `Found ${games.length} owned games` });

        if (games.length === 0) {
          send({ type: "done", added: 0, existing: 0, message: "No owned games found." });
          controller.close();
          return;
        }

        // Ensure steam tag with subtags
        const { tagId, subtags } = ensureSteamTag(db);
        const ownedSubId = subtags.owned;

        // Fetch wishlist data to get wishlist_date for owned games
        send({ type: "status", message: "Fetching wishlist for date matching..." });
        const wishlistDates = new Map<number, string>();
        try {
          const wlRes = await fetch(
            `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}&key=${apiKey}`
          );
          if (wlRes.ok) {
            const wlData = await wlRes.json() as { response?: { items?: { appid: number; date_added: number }[] } };
            for (const item of wlData?.response?.items || []) {
              if (item.date_added) {
                wishlistDates.set(item.appid, new Date(item.date_added * 1000).toISOString().split("T")[0]);
              }
            }
          }
        } catch { /* continue without */ }
        send({ type: "status", message: `Wishlist dates: ${wishlistDates.size} entries` });

        const findGame = db.prepare("SELECT id FROM games WHERE steam_appid = ?");
        const insGame = db.prepare("INSERT INTO games (name, steam_appid, wishlist_date, added_at) VALUES (?, ?, ?, ?)");
        const insGT = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)");
        const updateWishDate = db.prepare("UPDATE games SET wishlist_date = ? WHERE id = ? AND (wishlist_date IS NULL OR wishlist_date = '')");

        let added = 0, existing = 0, tagged = 0;
        const today = new Date().toISOString().split("T")[0];

        for (let i = 0; i < games.length; i++) {
          const g = games[i];
          const wishDate = wishlistDates.get(g.appid) || null;
          const ex = findGame.get(g.appid) as { id: number } | undefined;
          if (ex) {
            existing++;
            const r = insGT.run(ex.id, tagId, ownedSubId);
            if (r.changes > 0) tagged++;
            // Backfill wishlist_date if we have it and game doesn't
            if (wishDate) updateWishDate.run(wishDate, ex.id);
          } else {
            const gameId = Number(insGame.run(g.name, g.appid, wishDate, today).lastInsertRowid);
            insGT.run(gameId, tagId, ownedSubId);
            added++;
            tagged++;
          }

          if ((i + 1) % 10 === 0 || i === games.length - 1) {
            send({ type: "progress", current: i + 1, total: games.length, added, existing });
          }
        }

        send({
          type: "done",
          added,
          existing,
          tagged,
          message: `Owned games sync complete: ${added} new, ${existing} already in DB, ${tagged} newly tagged as "owned"`,
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
