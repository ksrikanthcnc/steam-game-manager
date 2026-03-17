#!/bin/bash
# Dump data from the main app's DB into static JSON for the demo site
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
DB="$DEMO_DIR/../data/games.db"
OUT="$DEMO_DIR/public/data"

mkdir -p "$OUT"

sqlite3 "$DB" -json "SELECT id, name, color FROM tags ORDER BY name" > "$OUT/tags.json"
sqlite3 "$DB" -json "SELECT id, tag_id, name, type FROM subtags ORDER BY tag_id, name" > "$OUT/subtags.json"
sqlite3 "$DB" -json "
SELECT g.id, g.name, g.steam_appid, g.description, g.notes, g.steam_genres, g.steam_features,
       g.community_tags, g.developers, g.publishers, g.release_date,
       g.review_sentiment, g.positive_percent, g.total_reviews, g.metacritic_score,
       g.screenshots, g.movies, g.total_screenshots, g.total_movies,
       g.created_at, g.updated_at, g.wishlist_date, g.added_at
FROM games g ORDER BY g.name
" > "$OUT/games.json"
sqlite3 "$DB" -json "
SELECT gt.game_id, gt.tag_id, gt.subtag_id, t.name as tag_name, t.color as tag_color,
       s.name as subtag_name, s.type as subtag_type
FROM game_tags gt
JOIN tags t ON t.id = gt.tag_id
LEFT JOIN subtags s ON s.id = gt.subtag_id
ORDER BY gt.game_id, t.name
" > "$OUT/game_tags.json"

echo "Dumped $(sqlite3 "$DB" "SELECT COUNT(*) FROM games") games to $OUT"
