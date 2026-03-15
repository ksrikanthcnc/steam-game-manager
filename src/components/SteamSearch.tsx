"use client";

import { useState } from "react";

interface SteamResult {
  appid: number;
  name: string;
  image: string;
  source: string;
}

interface Props {
  initialQuery: string;
  onSelect: (appid: number, name: string) => void;
  onClose: () => void;
}

export default function SteamSearch({ initialQuery, onSelect, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SteamResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/steam/search?name=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-lg p-5 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-medium">Search Steam</h3>

        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Game name..."
            className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            autoFocus
          />
          <button
            onClick={search}
            disabled={loading}
            className="bg-accent text-white px-4 py-1.5 rounded text-sm hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? "..." : "Search"}
          </button>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.appid}
              onClick={() => onSelect(r.appid, r.name)}
              className="w-full flex items-center gap-3 p-2 rounded hover:bg-surface2 transition-colors text-left"
            >
              <img
                src={r.image}
                alt={r.name}
                className="w-28 h-[52px] object-cover rounded"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div>
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted">AppID: {r.appid} · {r.source === "cache" ? "cached" : "from Steam"}</p>
              </div>
            </button>
          ))}
          {searched && !loading && results.length === 0 && (
            <p className="text-muted text-sm text-center py-4">No results found.</p>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="text-muted text-sm hover:text-foreground">Close</button>
        </div>
      </div>
    </div>
  );
}
