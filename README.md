# Steam Game Manager

A local-first game library manager built with Next.js. Sync your Steam wishlist and owned games, organize with a flexible tag system, browse with rich media, and filter your collection with powerful sidebar controls.

Everything runs on your machine — SQLite database, locally cached images, no cloud dependency.

**[Live Demo](https://ksrikanthcnc.github.io/steam-game-manager/)** — read-only static version with sample data

![Card View](docs/screenshots/card-view.png)
![List View](docs/screenshots/list-view.png)
![Inspector](docs/screenshots/inspector.png)

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and head to **Settings** to configure your Steam credentials:

1. **Steam ID** — Your 64-bit Steam ID (find yours at [steamid.io](https://steamid.io))
2. **API Key** — Register at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

Then use the sync buttons to pull your library.

---

## Features

### Steam Integration

- **Wishlist sync** — Imports all wishlist items with their wishlisted dates. Detects games removed from your wishlist and tags them accordingly.
- **Owned games sync** — Pulls your full owned library including free-to-play titles.
- **Metadata fetch** — Downloads app details, review data, and community tags from Steam for every game. Resumable sessions — if interrupted, pick up where you left off.
- **Image sync** — Downloads header images, screenshots (thumbnail and/or full HD), and movie thumbnails. Configurable concurrency and per-type toggles.
- **Ignored games import** — Paste your `dynamicstore/userdata` JSON to import "not interested" and "played elsewhere" flags.

### Browsing

- **Card view** — Grid of game cards with header images, tags, genres, community tags, and score badges. Adjustable column count via slider (2–8 columns). Hover slideshow cycles through screenshots.
- **List view** — Spreadsheet-style table with 20+ columns. Fully customizable: show/hide columns, drag to reorder, resize widths, multi-column sort (shift-click). Sticky header row. Adjustable row height with image scaling.
- **Inspector** — Click any game to open a detailed two-panel inspector. Left side shows header image and a media grid of all screenshots and videos. Right side shows description, metadata grid (score, reviews, Metacritic, SteamDB score, sentiment, dates, developer, publisher), and a 2×2 tag panel (your tags, genres, community tags, features). Fully resizable panels with drag handles. Layout persists across sessions. Clicking any screenshot or video in the media grid opens a full-screen lightbox with arrow-key navigation, auto-playing videos with configurable delay, and HLS streaming support.
- **Keyboard navigation** — Arrow keys to move through games, Enter/Space to open inspector, Escape to close. Works in both card and list views.

### Tags & Organization

- **Hierarchical tags** — Create top-level tags (e.g. "co-op", "indie", "backlog") with custom colors. Each tag can have subtags of two types: genre subtags and meta subtags (displayed differently).
- **Tag management** — Full CRUD in Settings. Create, rename, recolor, delete tags and subtags. Subtags can be genre-type or meta-type.
- **Quick tagging** — Click any tag/genre/feature pill in any view to filter by it. Right-click to exclude. Works everywhere: cards, list rows, inspector, sidebar.
- **Steam auto-tags** — Synced games automatically get a "steam" tag with subtags: wishlist, owned, removed_from_wishlist, ignored, played_elsewhere.

### Filtering & Search

- **Sidebar filters** — Collapsible sidebar with sections for:
  - Custom tags (include/exclude, AND/OR mode, with subtag expansion)
  - Genres, features, community tags (include/exclude, sorted by count or name)
  - Developers and publishers (include/exclude)
  - Quick filters: untagged games, games with notes, curated-only mode
  - Active filter count badge and one-click clear
- **Fuzzy search** — Search bar matches against game names, genres, tags, community tags, developers, and publishers. Results ranked by relevance.
- **Steam search** — When searching, also queries Steam's store API to find and add new games directly from search results.
- **Multi-sort** — Sort by any column. Shift-click column headers to add secondary/tertiary sort levels.

### Scores & Color Coding

- **Score sources** — Toggle between raw Steam positive percentage and SteamDB Wilson score (a confidence-adjusted rating that accounts for review count).
- **Color-coded backgrounds** — Optional tinting of cards, list rows, and inspector based on score. Three built-in presets (Subtle, Vivid, Neon) plus a fully custom mode with color pickers for high/mid/low and an opacity slider.
- **Score display** — Every view shows the score with color coding: green (≥70%), amber (40–69%), red (<40%). Metacritic score, review count, and review sentiment string also displayed.

### Data Management

- **CSV export** — Export your library with configurable columns (game info, tags, genres, metadata). Column selection saved in settings.
- **TXT export** — Simple name list export.
- **CSV import** — Import games from CSV. Matches existing games by Steam AppID, creates new entries, and links tags.
- **Manual game entry** — Add games without a Steam AppID. Manually upload screenshots via folder scan.
- **Edit modal** — Edit any game's name, notes, AppID, and tag assignments.
- **Per-game metadata refresh** — Re-fetch metadata for individual games from the inspector.

### Clipboard Matching

- **Clipboard tool** (`/clipboard`) — Paste a list of game names and instantly match them against your library. Shows exact, partial, and fuzzy matches with similarity scores. Configurable match thresholds and result limits.
- **Picture-in-Picture mode** — Floating mini-window for clipboard matching while browsing other sites.

### Settings & Customization

- **Screenshot quality** — Choose between thumbnail (600×338) or full HD (1920×1080) screenshots.
- **Media limits** — Configure max screenshots and movies per game, download concurrency.
- **Download toggles** — Enable/disable header images, screenshot thumbnails, HD screenshots, and movie thumbnails independently.
- **Slideshow speed** — Configurable interval for card hover slideshows (0.5s–5s).
- **Video delay** — Seconds to wait before auto-loading video in lightbox (0–5s).
- **Card view options** — Default card image source, number of genres and community tags shown per card.
- **Log level** — Server-side logging verbosity for sync operations (off/error/info/debug).
- **LAN access** — Shows your local network IP for accessing the app from other devices on the same network.
- **Database re-init** — Re-run migrations and asset count sync without losing data.

---

## Tech Stack

- **Next.js 16** with App Router and Turbopack
- **SQLite** via better-sqlite3 (WAL mode)
- **Tailwind CSS v4** for styling
- **TypeScript** throughout

## Data Storage

All data lives locally:

- `data/games.db` — SQLite database (auto-created on first run)
- `data/assets/games/<appid>/` — Cached images per game (header, screenshots, movie thumbnails)

The `data/` directory is gitignored. Your database and images stay on your machine.

## License

MIT

---

Built with the help of [Kiro](https://kiro.dev), an AI-powered IDE.
