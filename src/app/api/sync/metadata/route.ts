import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<unknown | null> {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
}

async function fetchStorePage(appid: number): Promise<string | null> {
  try {
    const r = await fetch(`https://store.steampowered.com/app/${appid}/`, {
      headers: {
        Cookie: "birthtime=0; wants_mature_content=1; lastagecheckage=1-0-1990",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

function parseCommunityTags(html: string): string[] {
  const m = html.match(/InitAppTagModal\(\s*\d+,\s*(\[[\s\S]*?\]),/);
  if (!m) return [];
  try {
    return (JSON.parse(m[1]) as { name: string }[]).slice(0, 20).map((t) => t.name);
  } catch { return []; }
}

type Source = "appdetails" | "reviews" | "community";
type CacheRow = {
  appid: number; appdetails: string | null;
  reviews: string | null; store_page_tags: string | null;
};

function ensureTables() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS steam_cache (
    appid INTEGER PRIMARY KEY, appdetails TEXT, reviews TEXT,
    store_page_tags TEXT, fetched_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_sessions (
    source TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    last_appid INTEGER,
    status TEXT DEFAULT 'running'
  )`);
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

function getSetting(db: ReturnType<typeof getDb>, key: string, fb: number) {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r ? parseInt(r.value, 10) || fb : fb;
}

const SOURCE_LABEL: Record<Source, string> = {
  appdetails: "App Details", reviews: "Reviews", community: "Community Tags",
};
const CACHE_COL: Record<Source, keyof CacheRow> = {
  appdetails: "appdetails", reviews: "reviews", community: "store_page_tags",
};

/**
 * GET /api/sync/metadata — returns session status for all sources
 */
export async function GET() {
  const db = ensureTables();
  const sessions = db.prepare("SELECT * FROM sync_sessions").all() as {
    source: string; started_at: string; total: number; done: number;
    failed: number; last_appid: number | null; status: string;
  }[];

  // Also count how many games need fetching per source (missing cache)
  const totalGames = (db.prepare("SELECT COUNT(*) as c FROM games WHERE steam_appid IS NOT NULL").get() as { c: number }).c;

  const cacheStats: Record<string, number> = {};
  for (const src of ["appdetails", "reviews", "store_page_tags"] as const) {
    const r = db.prepare(`SELECT COUNT(*) as c FROM steam_cache WHERE ${src} IS NOT NULL AND ${src} != ''`).get() as { c: number };
    cacheStats[src] = r.c;
  }

  return Response.json({
    totalGames,
    cached: {
      appdetails: cacheStats.appdetails,
      reviews: cacheStats.reviews,
      community: cacheStats.store_page_tags,
    },
    sessions: Object.fromEntries(sessions.map((s) => [s.source, s])),
  });
}

/**
 * POST /api/sync/metadata
 * Query params:
 *   source=appdetails|reviews|community|all (default: all)
 *   mode=missing|resume|fresh
 *     missing = only fetch games with no cache for this source (default, always resumable)
 *     resume  = continue an interrupted re-fetch-all session
 *     fresh   = start a new re-fetch-all session from scratch
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const sourceParam = url.searchParams.get("source") || "all";
  const mode = (url.searchParams.get("mode") || "missing") as "missing" | "resume" | "fresh";
  const sources: Source[] = sourceParam === "all"
    ? ["appdetails", "reviews", "community"]
    : [sourceParam as Source];
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const db = ensureTables();
        const maxSS = getSetting(db, "max_screenshots", 5);
        const maxMov = getSetting(db, "max_movies", 2);
        const concurrency = getSetting(db, "meta_concurrency", 1);

        const allGames = db.prepare(
          "SELECT id, name, steam_appid FROM games WHERE steam_appid IS NOT NULL ORDER BY name"
        ).all() as { id: number; name: string; steam_appid: number }[];

        // Build cache lookup
        const cacheMap = new Map<number, CacheRow>();
        for (const r of db.prepare("SELECT appid, appdetails, reviews, store_page_tags FROM steam_cache").all() as CacheRow[]) {
          cacheMap.set(r.appid, r);
        }

        let totalOk = 0, totalFail = 0;

        // ── Unified per-game mode: fetch all 3 sources per game in parallel ──
        if (sourceParam === "all" && mode === "missing") {
          // Find games missing ANY source
          const needsFetch = allGames.filter((g) => {
            const cached = cacheMap.get(g.steam_appid);
            return !cached || !cached.appdetails || !cached.reviews || !cached.store_page_tags;
          });

          send({ type: "status", message: `${needsFetch.length} games need metadata (all 3 sources per game, concurrency: ${concurrency})` });

          let ok = 0, fail = 0, rateLimitHits = 0;

          for (let i = 0; i < needsFetch.length; i += concurrency) {
            const batch = needsFetch.slice(i, i + concurrency);
            const results = await Promise.allSettled(batch.map(async (g) => {
              const appid = g.steam_appid;
              const cached = cacheMap.get(appid);
              const fetches: Promise<void>[] = [];

              if (!cached?.appdetails) {
                fetches.push((async () => {
                  const result = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
                  if (!result) throw new Error("rate_limit");
                  upsertCacheCol(db, cacheMap, appid, "appdetails", JSON.stringify(result));
                })());
              }
              if (!cached?.reviews) {
                fetches.push((async () => {
                  const result = await fetchJson(
                    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`
                  );
                  upsertCacheCol(db, cacheMap, appid, "reviews", JSON.stringify(result));
                })());
              }
              if (!cached?.store_page_tags) {
                fetches.push((async () => {
                  const html = await fetchStorePage(appid);
                  const ctags = html ? parseCommunityTags(html) : [];
                  upsertCacheCol(db, cacheMap, appid, "store_page_tags", JSON.stringify(ctags));
                })());
              }

              await Promise.all(fetches);
              return g;
            }));

            for (let j = 0; j < results.length; j++) {
              const r = results[j];
              if (r.status === "fulfilled") {
                ok++;
              } else {
                if (r.reason?.message === "rate_limit") {
                  rateLimitHits++;
                  if (rateLimitHits >= 3) {
                    send({ type: "status", message: "Rate limited, pausing 60s..." });
                    await sleep(60000); rateLimitHits = 0;
                    i -= concurrency; break;
                  }
                } else { fail++; }
              }
            }

            send({ type: "progress", current: Math.min(i + concurrency, needsFetch.length), total: needsFetch.length, ok, fail, name: batch[batch.length - 1].name });
            await sleep(500);
          }

          totalOk = ok; totalFail = fail;
          send({ type: "status", message: `Fetch done: ${ok} games ok, ${fail} errors` });

        } else {
          // ── Per-source mode (single source, or resume/fresh) ──
          for (const src of sources) {
            const col = CACHE_COL[src];
            let needsFetch: typeof allGames;

            if (mode === "missing") {
              needsFetch = allGames.filter((g) => {
                const cached = cacheMap.get(g.steam_appid);
                return !cached || !cached[col];
              });
            } else if (mode === "resume") {
              const session = db.prepare("SELECT * FROM sync_sessions WHERE source = ?").get(src) as {
                last_appid: number | null; status: string; done: number;
              } | undefined;
              if (!session || session.status === "done") {
                send({ type: "status", message: `${SOURCE_LABEL[src]}: no interrupted session to resume (status: ${session?.status || "none"})` });
                continue;
              }
              if (session.last_appid) {
                const lastIdx = allGames.findIndex((g) => g.steam_appid === session.last_appid);
                needsFetch = lastIdx >= 0 ? allGames.slice(lastIdx + 1) : allGames;
                send({ type: "status", message: `${SOURCE_LABEL[src]}: resuming from game ${lastIdx + 1}/${allGames.length} (${session.done} already done)` });
              } else { needsFetch = allGames; }
            } else {
              needsFetch = allGames;
              db.prepare(`INSERT INTO sync_sessions (source, started_at, total, done, failed, last_appid, status)
                VALUES (?, datetime('now'), ?, 0, 0, NULL, 'running')
                ON CONFLICT(source) DO UPDATE SET
                  started_at = datetime('now'), total = ?, done = 0, failed = 0,
                  last_appid = NULL, status = 'running'
              `).run(src, allGames.length, allGames.length);
            }

            send({ type: "status", message: `--- ${SOURCE_LABEL[src]}: ${needsFetch.length} games to fetch (mode: ${mode}) ---` });
            if (needsFetch.length === 0) continue;

            if (mode === "fresh" || mode === "resume") {
              db.prepare("UPDATE sync_sessions SET status = 'running' WHERE source = ?").run(src);
            }

            const updateSession = db.prepare("UPDATE sync_sessions SET done = done + 1, last_appid = ? WHERE source = ?");
            const updateSessionFail = db.prepare("UPDATE sync_sessions SET failed = failed + 1, last_appid = ? WHERE source = ?");

            let ok = 0, fail = 0, rateLimitHits = 0;
            const delayMs = src === "community" ? 500 : 350;

            for (let i = 0; i < needsFetch.length; i += concurrency) {
              const batch = needsFetch.slice(i, i + concurrency);
              const results = await Promise.allSettled(batch.map(async (g) => {
                const appid = g.steam_appid;
                if (src === "appdetails") {
                  const result = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
                  if (!result) throw new Error("rate_limit");
                  upsertCacheCol(db, cacheMap, appid, "appdetails", JSON.stringify(result));
                } else if (src === "reviews") {
                  const result = await fetchJson(
                    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`
                  );
                  upsertCacheCol(db, cacheMap, appid, "reviews", JSON.stringify(result));
                } else {
                  const html = await fetchStorePage(appid);
                  const ctags = html ? parseCommunityTags(html) : [];
                  upsertCacheCol(db, cacheMap, appid, "store_page_tags", JSON.stringify(ctags));
                }
                return g;
              }));

              for (let j = 0; j < results.length; j++) {
                const r = results[j]; const g = batch[j];
                if (r.status === "fulfilled") {
                  ok++;
                  if (mode !== "missing") updateSession.run(g.steam_appid, src);
                } else {
                  if (r.reason?.message === "rate_limit") {
                    rateLimitHits++;
                    if (rateLimitHits >= 3) {
                      send({ type: "status", message: `Rate limited on ${src}, pausing 60s...` });
                      await sleep(60000); rateLimitHits = 0;
                      i -= concurrency; break;
                    }
                  } else {
                    fail++;
                    if (mode !== "missing") updateSessionFail.run(g.steam_appid, src);
                  }
                }
              }

              send({ type: "progress", current: Math.min(i + concurrency, needsFetch.length), total: needsFetch.length, ok, fail, name: batch[batch.length - 1].name, source: src });
              await sleep(delayMs);
            }

            if (mode !== "missing") {
              db.prepare("UPDATE sync_sessions SET status = 'done' WHERE source = ?").run(src);
            }

            totalOk += ok; totalFail += fail;
            send({ type: "status", message: `${SOURCE_LABEL[src]} done: ${ok} fetched, ${fail} errors` });
          }
        }

        // Rebuild game rows from cache
        send({ type: "status", message: "Applying cached data to game records..." });
        const applied = rebuildFromCache(db, allGames, cacheMap, maxSS, maxMov);

        send({ type: "done", ok: totalOk, fail: totalFail, applied,
          message: `Metadata sync: ${totalOk} fetched, ${totalFail} errors, ${applied} records updated` });
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

function upsertCacheCol(
  db: ReturnType<typeof getDb>,
  cacheMap: Map<number, CacheRow>,
  appid: number, col: string, value: string,
) {
  const existing = cacheMap.get(appid);
  if (existing) {
    db.prepare(`UPDATE steam_cache SET ${col} = ?, fetched_at = datetime('now') WHERE appid = ?`).run(value, appid);
    (existing as Record<string, unknown>)[col] = value;
  } else {
    db.prepare(`INSERT INTO steam_cache (appid, ${col}) VALUES (?, ?)`).run(appid, value);
    const row: CacheRow = { appid, appdetails: null, reviews: null, store_page_tags: null };
    (row as Record<string, unknown>)[col] = value;
    cacheMap.set(appid, row);
  }
}

function rebuildFromCache(
  db: ReturnType<typeof getDb>,
  allGames: { id: number; name: string; steam_appid: number }[],
  cacheMap: Map<number, CacheRow>,
  maxSS: number, maxMov: number,
): number {
  const updateGame = db.prepare(`
    UPDATE games SET
      name = COALESCE(?, name),
      description = ?, steam_genres = ?, steam_features = ?, community_tags = ?,
      developers = ?, publishers = ?, release_date = ?, review_sentiment = ?,
      positive_percent = ?, total_reviews = ?, metacritic_score = ?,
      screenshots = ?, movies = ?, total_screenshots = ?, total_movies = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  let applied = 0;
  for (const g of allGames) {
    const cached = cacheMap.get(g.steam_appid);
    if (!cached) continue;

    let steamName: string | null = null;
    let desc = "", genres: string[] = [], feats: string[] = [], devs = "", pubs = "";
    let relDate = "", mc = 0, ss: string[] = [], ctags: string[] = [];
    let movies: { name: string; thumbnail_url: string; video_url: string }[] = [];
    let totalSS = 0, totalMov = 0;

    if (cached.appdetails) {
      try {
        const dd = JSON.parse(cached.appdetails) as Record<string, { success: boolean; data?: Record<string, unknown> }>;
        if (dd?.[String(g.steam_appid)]?.success) {
          const d = dd[String(g.steam_appid)].data!;
          steamName = (d.name as string) || null;
          desc = (d.short_description as string) || "";
          genres = ((d.genres as { description: string }[]) || []).map((x) => x.description);
          feats = ((d.categories as { description: string }[]) || []).map((x) => x.description);
          devs = ((d.developers as string[]) || []).join(", ");
          pubs = ((d.publishers as string[]) || []).join(", ");
          relDate = (d.release_date as { date?: string })?.date || "";
          mc = (d.metacritic as { score?: number })?.score || 0;
          const allSS = (d.screenshots as { path_full: string }[]) || [];
          ss = allSS.slice(0, maxSS).map((x) => x.path_full);
          totalSS = ss.length;
          const allMov = (d.movies as { name: string; thumbnail: string; hls_h264?: string; mp4?: { max?: string }; webm?: { max?: string } }[]) || [];
          movies = allMov.slice(0, maxMov).map((m) => ({
            name: m.name || "Trailer", thumbnail_url: m.thumbnail || "",
            video_url: m.hls_h264 || m.mp4?.max || m.webm?.max || "",
          }));
          totalMov = movies.length;
        }
      } catch { /* ignore */ }
    }

    let sent = "", pct = 0, total = 0;
    if (cached.reviews) {
      try {
        const rv = JSON.parse(cached.reviews) as { query_summary?: { review_score_desc: string; total_positive: number; total_negative: number } };
        if (rv?.query_summary) {
          sent = rv.query_summary.review_score_desc || "";
          total = rv.query_summary.total_positive + rv.query_summary.total_negative;
          pct = total > 0 ? Math.round((rv.query_summary.total_positive / total) * 100) : 0;
        }
      } catch { /* ignore */ }
    }

    if (cached.store_page_tags) {
      try { ctags = JSON.parse(cached.store_page_tags); } catch { /* ignore */ }
    }

    updateGame.run(steamName, desc, JSON.stringify(genres), JSON.stringify(feats), JSON.stringify(ctags),
      devs, pubs, relDate, sent, pct, total, mc, JSON.stringify(ss), JSON.stringify(movies), totalSS, totalMov, g.id);
    applied++;
  }
  return applied;
}
