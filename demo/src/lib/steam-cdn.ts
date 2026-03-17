/** Steam CDN URL helpers */

const STEAM_CDN = "https://cdn.akamai.steamstatic.com/steam/apps";

export function headerUrl(appid: number | null): string {
  if (!appid) return "";
  return `${STEAM_CDN}/${appid}/header.jpg`;
}

/**
 * Derive a thumbnail (600x338) URL from a full screenshot URL stored in the DB.
 * DB stores: ...ss_HASH.1920x1080.jpg?t=...
 * Thumbnail: ...ss_HASH.600x338.jpg?t=...
 */
export function screenshotThumbFromUrl(fullUrl: string): string {
  return fullUrl.replace(".1920x1080", ".600x338");
}

/**
 * The full HD URL is the original URL from the DB (already 1920x1080).
 */
export function screenshotHdFromUrl(fullUrl: string): string {
  return fullUrl;
}

/**
 * Parse the screenshots JSON field and return [thumb, hd] URL pairs.
 */
export function parseScreenshots(json: string | null | undefined): { thumb: string; hd: string }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((url: string) => ({
      thumb: screenshotThumbFromUrl(url),
      hd: url,
    }));
  } catch {
    return [];
  }
}

/**
 * Parse the movies JSON field and return structured movie data.
 */
export function parseMovies(json: string | null | undefined): { name: string; thumbnail: string; videoUrl: string }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: { name?: string; thumbnail_url?: string; video_url?: string }, i: number) => ({
      name: m.name || `Trailer ${i + 1}`,
      thumbnail: m.thumbnail_url || "",
      videoUrl: m.video_url || "",
    }));
  } catch {
    return [];
  }
}
