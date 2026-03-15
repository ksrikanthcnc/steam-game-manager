import { NextRequest, NextResponse } from "next/server";

// GET /api/steam/search?name=X — search Steam for a game (also accepts appid as pure number)
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const trimmed = name.trim();

  try {
    // If input is a pure number, treat as appid — fetch details directly
    if (/^\d+$/.test(trimmed)) {
      const appid = trimmed;
      const detRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
      if (detRes.ok) {
        const detData = await detRes.json();
        const entry = detData?.[appid];
        if (entry?.success && entry.data) {
          return NextResponse.json([{
            appid: Number(appid),
            name: entry.data.name || `App ${appid}`,
            image: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
          }]);
        }
      }
      // If appid lookup fails, fall through to name search
    }

    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(trimmed)}&l=en&cc=us`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "GameCollectionManager/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Steam API error" }, { status: 502 });
    }

    const data = await res.json();
    const items = (data.items || []).slice(0, 10);

    return NextResponse.json(
      items.map((item: { id: number; name: string }) => ({
        appid: item.id,
        name: item.name,
        image: `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
      }))
    );
  } catch {
    return NextResponse.json({ error: "Failed to search Steam" }, { status: 500 });
  }
}
