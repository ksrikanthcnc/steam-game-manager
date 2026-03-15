import { NextRequest, NextResponse } from "next/server";

// GET /api/steam/community-tags?appid=X — scrape community tags from Steam store page
export async function GET(req: NextRequest) {
  const appid = req.nextUrl.searchParams.get("appid");
  if (!appid) return NextResponse.json({ error: "appid required" }, { status: 400 });

  try {
    const res = await fetch(`https://store.steampowered.com/app/${appid}/`, {
      headers: {
        Cookie: "birthtime=0; wants_mature_content=1; lastagecheckage=1-0-1990",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return NextResponse.json([]);
    const html = await res.text();
    const match = html.match(/InitAppTagModal\(\s*\d+,\s*(\[[\s\S]*?\]),/);
    if (match) {
      const parsed: { name: string }[] = JSON.parse(match[1]);
      return NextResponse.json(parsed.slice(0, 20).map((t) => t.name));
    }
    return NextResponse.json([]);
  } catch {
    return NextResponse.json([]);
  }
}
