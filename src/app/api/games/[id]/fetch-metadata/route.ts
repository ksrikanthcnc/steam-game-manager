import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");

// POST /api/games/:id/fetch-metadata
// Fetches Steam metadata for a game and updates the DB + cache
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const game = db.prepare("SELECT id, name, steam_appid FROM games WHERE id = ?").get(id) as
    { id: number; name: string; steam_appid: number | null } | undefined;

  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!game.steam_appid) return NextResponse.json({ error: "No steam_appid" }, { status: 400 });

  const appid = game.steam_appid;

  // Read settings for limits
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const getSetting = (key: string, fallback: number) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) || fallback : fallback;
  };
  const maxScreenshots = getSetting("max_screenshots", 5);
  const maxMovies = getSetting("max_movies", 2);

  // Ensure steam_cache table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS steam_cache (
      appid INTEGER PRIMARY KEY,
      appdetails TEXT,
      reviews TEXT,
      store_page_tags TEXT,
      fetched_at TEXT DEFAULT (datetime('now'))
    )
  `);

  try {
    // 1. Fetch appdetails
    const detailsRes = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
    );
    const detailsRaw = detailsRes.ok ? await detailsRes.json() : null;

    // 2. Fetch reviews
    const reviewsRes = await fetch(
      `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`
    );
    const reviewsRaw = reviewsRes.ok ? await reviewsRes.json() : null;

    // 3. Fetch store page for community tags
    let communityTags: string[] = [];
    try {
      const storeRes = await fetch(`https://store.steampowered.com/app/${appid}/`, {
        headers: {
          "Cookie": "birthtime=0; wants_mature_content=1; lastagecheckage=1-0-1990",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });
      if (storeRes.ok) {
        const html = await storeRes.text();
        const match = html.match(/InitAppTagModal\(\s*\d+,\s*(\[[\s\S]*?\]),/);
        if (match) {
          const parsed: { name: string }[] = JSON.parse(match[1]);
          communityTags = parsed.slice(0, 20).map((t) => t.name);
        }
      }
    } catch { /* ignore store page errors */ }

    // Cache raw responses
    db.prepare(`
      INSERT INTO steam_cache (appid, appdetails, reviews, store_page_tags, fetched_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(appid) DO UPDATE SET
        appdetails = excluded.appdetails,
        reviews = excluded.reviews,
        store_page_tags = excluded.store_page_tags,
        fetched_at = excluded.fetched_at
    `).run(appid, JSON.stringify(detailsRaw), JSON.stringify(reviewsRaw), JSON.stringify(communityTags));

    // Extract structured data
    let description = "";
    let genres: string[] = [];
    let features: string[] = [];
    let developers = "";
    let publishers = "";
    let releaseDate = "";
    let metacritic = 0;
    let screenshots: string[] = [];
    let movies: { name: string; thumbnail_url: string; video_url: string }[] = [];
    let totalSS = 0;
    let totalMov = 0;

    const detailData = detailsRaw as Record<string, { success: boolean; data?: Record<string, unknown> }> | null;
    let ssData: { path_thumbnail: string; path_full: string }[] = [];

    if (detailData?.[String(appid)]?.success) {
      const d = detailData[String(appid)].data!;
      description = (d.short_description as string) || "";
      genres = ((d.genres as { description: string }[]) || []).map((g) => g.description);
      features = ((d.categories as { description: string }[]) || []).map((c) => c.description);
      developers = ((d.developers as string[]) || []).join(", ");
      publishers = ((d.publishers as string[]) || []).join(", ");
      const rd = d.release_date as { date?: string } | undefined;
      releaseDate = rd?.date || "";
      const mc = d.metacritic as { score?: number } | undefined;
      metacritic = mc?.score || 0;

      const allSS = (d.screenshots as { path_thumbnail: string; path_full: string }[]) || [];
      ssData = allSS.slice(0, maxScreenshots);
      totalSS = ssData.length;
      screenshots = ssData.map((s) => s.path_full);

      const allMovies = (d.movies as { name: string; thumbnail: string; hls_h264?: string; mp4?: { max?: string }; webm?: { max?: string } }[]) || [];
      totalMov = allMovies.length;
      movies = allMovies.slice(0, maxMovies).map((m) => ({
        name: m.name || "Trailer",
        thumbnail_url: m.thumbnail || "",
        video_url: m.hls_h264 || m.mp4?.max || m.webm?.max || "",
      }));
    }

    // Extract review data
    let sentiment = "";
    let positivePercent = 0;
    let totalReviews = 0;

    const reviewData = reviewsRaw as { query_summary?: { review_score_desc: string; total_positive: number; total_negative: number } } | null;
    if (reviewData?.query_summary) {
      const qs = reviewData.query_summary;
      sentiment = qs.review_score_desc || "";
      totalReviews = qs.total_positive + qs.total_negative;
      positivePercent = totalReviews > 0 ? Math.round((qs.total_positive / totalReviews) * 100) : 0;
    }

    // Update game record
    db.prepare(`
      UPDATE games SET
        description = ?, steam_genres = ?, steam_features = ?, community_tags = ?,
        developers = ?, publishers = ?, release_date = ?,
        review_sentiment = ?, positive_percent = ?, total_reviews = ?,
        metacritic_score = ?, screenshots = ?, movies = ?,
        total_screenshots = ?, total_movies = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      description, JSON.stringify(genres), JSON.stringify(features), JSON.stringify(communityTags),
      developers, publishers, releaseDate,
      sentiment, positivePercent, totalReviews,
      metacritic, JSON.stringify(screenshots), JSON.stringify(movies),
      totalSS, totalMov, id
    );

    // Download images
    const headerImageUrl = detailData?.[String(appid)]?.success
      ? (detailData[String(appid)].data?.header_image as string)?.split("?")[0] || ""
      : "";
    await downloadGameImages(appid, headerImageUrl, ssData, movies);

    return NextResponse.json({
      ok: true,
      genres: genres.length,
      features: features.length,
      communityTags: communityTags.length,
      reviews: totalReviews,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function downloadGameImages(
  appid: number,
  headerImageUrl: string,
  screenshots: { path_thumbnail: string; path_full: string }[],
  movies: { name: string; thumbnail_url: string; video_url: string }[],
) {
  const dir = path.join(ASSETS_DIR, String(appid));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const downloadFile = async (url: string, dest: string) => {
    if (fs.existsSync(dest)) return;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);
      }
    } catch { /* ignore */ }
  };

  // Header
  if (headerImageUrl) {
    await downloadFile(headerImageUrl, path.join(dir, "header.jpg"));
  }

  // Screenshots (low-res + HD)
  for (let i = 0; i < screenshots.length; i++) {
    const ss = screenshots[i];
    if (ss.path_thumbnail) await downloadFile(ss.path_thumbnail, path.join(dir, `ss_${i}.jpg`));
    if (ss.path_full) await downloadFile(ss.path_full, path.join(dir, `ss_${i}_hd.jpg`));
  }

  // Movie thumbnails
  for (let i = 0; i < movies.length; i++) {
    if (movies[i].thumbnail_url) {
      await downloadFile(movies[i].thumbnail_url, path.join(dir, `movie_${i}.jpg`));
    }
  }
}
