import { getDb } from "@/lib/db";
import { log } from "@/lib/logger";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function downloadFile(url: string, dest: string, retries = 3): Promise<boolean> {
  if (fs.existsSync(dest)) return false;
  const tmp = dest + ".tmp";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        log.debug(`download retry ${attempt + 1}/${retries} (${res.status}): ${url}`);
        if (attempt < retries) { await sleep(1000 * Math.pow(2, attempt)); continue; }
        log.error(`download failed after ${retries} retries (${res.status}): ${url}`);
        return false;
      }
      if (!res.ok) {
        log.debug(`download ${res.status}: ${url}`);
        return false;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      log.debug(`downloaded: ${path.basename(dest)}`);
      return true;
    } catch (err) {
      log.error(`download error: ${url} — ${err}`);
      if (attempt < retries) { await sleep(1000 * Math.pow(2, attempt)); continue; }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return false;
    }
  }
  return false;
}

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const db = getDb();

        db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        const getSetting = (key: string, fb: number) => {
          const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
          return r ? parseInt(r.value, 10) || fb : fb;
        };
        const maxSS = getSetting("max_screenshots", 5);
        const maxMov = getSetting("max_movies", 2);
        const concurrency = getSetting("image_concurrency", 5);
        const dlSsLow = getSetting("dl_ss_low", 1) !== 0;
        const dlSsHd = getSetting("dl_ss_hd", 1) !== 0;
        const dlMovies = getSetting("dl_movies", 1) !== 0;
        const dlHeaders = getSetting("dl_headers", 1) !== 0;

        const games = db.prepare(`
          SELECT id, name, steam_appid, screenshots, movies FROM games
          WHERE steam_appid IS NOT NULL
          ORDER BY name
        `).all() as { id: number; name: string; steam_appid: number; screenshots: string; movies: string }[];

        // Pre-scan: figure out which games actually need downloads
        const needsImages: typeof games[0][] = [];
        let alreadyComplete = 0;

        for (const g of games) {
          const dir = path.join(ASSETS_DIR, String(g.steam_appid));
          const existing = fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set<string>();

          // Header
          if (dlHeaders && !existing.has("header.jpg")) { needsImages.push(g); continue; }

          // Check screenshots
          let ssData: { path_thumbnail: string; path_full: string }[] = [];
          try { ssData = JSON.parse(g.screenshots || "[]"); } catch { /* ignore */ }
          const ssCount = Math.min(ssData.length, maxSS);
          let missing = false;
          for (let j = 0; j < ssCount && !missing; j++) {
            if (dlSsLow && !existing.has(`ss_${j}.jpg`)) missing = true;
            if (dlSsHd && ssData[j]?.path_full && !existing.has(`ss_${j}_hd.jpg`)) missing = true;
          }

          // Check movies
          if (!missing && dlMovies) {
            let movData: { thumbnail_url: string }[] = [];
            try { movData = JSON.parse(g.movies || "[]"); } catch { /* ignore */ }
            const movCount = Math.min(movData.length, maxMov);
            for (let j = 0; j < movCount && !missing; j++) {
              if (movData[j]?.thumbnail_url && !existing.has(`movie_${j}.jpg`)) missing = true;
            }
          }

          if (missing) needsImages.push(g);
          else alreadyComplete++;
        }

        send({ type: "status", message: `${alreadyComplete} games complete, ${needsImages.length} need downloads — concurrency: ${concurrency}` });

        if (needsImages.length === 0) { send({ type: "done", downloaded: 0 }); controller.close(); return; }

        let downloaded = 0, skipped = 0, processed = 0;

        // Process a single game: only download assets that are actually missing
        async function processGame(g: typeof needsImages[0]): Promise<number> {
          const appid = g.steam_appid;
          const dir = path.join(ASSETS_DIR, String(appid));
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const existing = new Set(fs.readdirSync(dir));

          // Read appdetails cache once
          let cachedData: { header_image?: string; screenshots?: { path_thumbnail: string; path_full: string }[] } | null = null;
          const cached = db.prepare("SELECT appdetails FROM steam_cache WHERE appid = ?").get(appid) as { appdetails: string } | undefined;
          if (cached) {
            try {
              const det = JSON.parse(cached.appdetails) as Record<string, { success: boolean; data?: { header_image?: string; screenshots?: { path_thumbnail: string; path_full: string }[] } }>;
              if (det?.[String(appid)]?.success) cachedData = det[String(appid)].data || null;
            } catch { /* ignore */ }
          }

          const tasks: Promise<boolean>[] = [];

          // Header — use actual URL from appdetails (Steam CDN paths include hashes)
          if (dlHeaders && !existing.has("header.jpg") && cachedData?.header_image) {
            tasks.push(downloadFile(cachedData.header_image.split("?")[0], path.join(dir, "header.jpg")));
          }

          // Screenshots — use URLs from games table, fall back to cache
          let ssData: { path_thumbnail: string; path_full: string }[] = [];
          try { ssData = JSON.parse(g.screenshots || "[]"); } catch { /* ignore */ }
          if (ssData.length === 0 || typeof ssData[0] === "string") {
            ssData = (cachedData?.screenshots || []).slice(0, maxSS);
          }

          for (let j = 0; j < Math.min(ssData.length, maxSS); j++) {
            const ss = ssData[j];
            if (typeof ss === "object" && ss.path_thumbnail) {
              if (dlSsLow && !existing.has(`ss_${j}.jpg`)) tasks.push(downloadFile(ss.path_thumbnail, path.join(dir, `ss_${j}.jpg`)));
              if (dlSsHd && ss.path_full && !existing.has(`ss_${j}_hd.jpg`)) {
                tasks.push(downloadFile(ss.path_full, path.join(dir, `ss_${j}_hd.jpg`)));
              }
            }
          }

          // Movie thumbnails
          if (dlMovies) {
            let movData: { thumbnail_url: string }[] = [];
            try { movData = JSON.parse(g.movies || "[]"); } catch { /* ignore */ }
            for (let j = 0; j < Math.min(movData.length, maxMov); j++) {
              if (movData[j].thumbnail_url && !existing.has(`movie_${j}.jpg`)) {
                tasks.push(downloadFile(movData[j].thumbnail_url, path.join(dir, `movie_${j}.jpg`)));
              }
            }
          }

          const results = await Promise.all(tasks);
          return results.filter(Boolean).length;
        }

        // Process games in batches of `concurrency`
        for (let i = 0; i < needsImages.length; i += concurrency) {
          const batch = needsImages.slice(i, i + concurrency);
          const results = await Promise.all(batch.map(processGame));

          for (let j = 0; j < results.length; j++) {
            processed++;
            if (results[j] > 0) downloaded++;
            else skipped++;
          }

          send({
            type: "progress",
            current: processed,
            total: needsImages.length,
            downloaded,
            skipped,
            name: batch[batch.length - 1].name,
          });
        }

        send({ type: "done", downloaded, skipped, message: `Images: ${downloaded} games downloaded, ${skipped} skipped` });
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
