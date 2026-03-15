"use client";

import { useState, useEffect, useRef } from "react";
import { GameWithTags } from "@/lib/types";
import { MatchResult, MatchConfig, DEFAULT_MATCH_CONFIG, findMatches } from "@/lib/clipboard-match";

const STATUS = {
  exact: { color: "#4ade80", bg: "#16a34a50", border: "#16a34a80", label: "EXACT MATCH" },
  partial: { color: "#fb923c", bg: "#ea580c50", border: "#ea580c80", label: "PARTIAL" },
  fuzzy: { color: "#60a5fa", bg: "#2563eb50", border: "#2563eb80", label: "FUZZY" },
  none: { color: "#f87171", bg: "#dc262650", border: "#dc262680", label: "NOT FOUND" },
};

function MatchColumn({ title, match }: { title: string; match: MatchResult }) {
  const st = STATUS[match.type];
  return (
    <div className="flex-1 min-w-0" style={{ backgroundColor: st.bg }}>
      <div className="px-2 py-1 text-[10px] font-bold tracking-wider" style={{ background: st.bg, color: st.color, borderBottom: `1px solid ${st.border}` }}>
        {title}: {st.label}{match.games.length > 0 ? ` (${match.games.length})` : ""}
      </div>
      <div className="px-2 py-1 space-y-1">
        {match.games.slice(0, 8).map((g) => (
          <div key={g.id}>
            <div className="text-[11px] text-foreground truncate">{g.name}</div>
            {g.tags && g.tags.length > 0 && (
              <div className="text-[9px] text-muted truncate pl-2">
                {g.tags.map((t) => `${t.tag_name}${t.subtag_name ? ">" + t.subtag_name : ""}`).join(", ")}
              </div>
            )}
          </div>
        ))}
        {match.type === "none" && (
          <div className="text-[10px] text-muted italic">—</div>
        )}
      </div>
    </div>
  );
}

export default function ClipboardPage() {
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const [clipText, setClipText] = useState("");
  const [libMatch, setLibMatch] = useState<MatchResult>({ type: "none", games: [] });
  const [wishMatch, setWishMatch] = useState<MatchResult>({ type: "none", games: [] });
  const lastClipRef = useRef("");
  const configRef = useRef<MatchConfig>(DEFAULT_MATCH_CONFIG);

  // Load all games + settings
  useEffect(() => {
    fetch("/api/games/all").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setAllGames(data);
    });
    fetch("/api/settings").then((r) => r.json()).then((s: Record<string, string>) => {
      configRef.current = {
        partialLimit: parseInt(s.clip_partial_limit, 10) || DEFAULT_MATCH_CONFIG.partialLimit,
        fuzzyLimit: parseInt(s.clip_fuzzy_limit, 10) || DEFAULT_MATCH_CONFIG.fuzzyLimit,
        fuzzyThreshold: parseFloat(s.clip_fuzzy_threshold) || DEFAULT_MATCH_CONFIG.fuzzyThreshold,
      };
    });
  }, []);

  const libraryGames = allGames.filter((g) => g.tags && g.tags.some((t) => t.tag_name !== "owned"));

  const processClip = (text: string) => {
    const t = text.trim();
    if (t && t !== lastClipRef.current && t.length >= 2 && t.length < 200) {
      lastClipRef.current = t;
      setClipText(t);
      setLibMatch(findMatches(t, libraryGames, configRef.current));
      setWishMatch(findMatches(t, allGames, configRef.current));
    }
  };

  // Browser API on focus
  useEffect(() => {
    if (allGames.length === 0) return;
    const onFocus = async () => {
      try { processClip(await navigator.clipboard.readText()); } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames, libraryGames]);

  // Server poll when unfocused
  useEffect(() => {
    if (allGames.length === 0) return;
    const interval = setInterval(async () => {
      if (document.hasFocus()) return;
      try {
        const res = await fetch("/api/clipboard");
        const data = await res.json();
        processClip(data.text || "");
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames, libraryGames]);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden select-none" style={{ minWidth: 300 }}>
      <div className="px-3 py-1.5 bg-surface border-b border-border flex items-center gap-2 shrink-0">
        <span className="text-xs">📋</span>
        <span className="text-[11px] text-foreground font-medium truncate flex-1">
          {clipText || "(waiting for clipboard...)"}
        </span>
        <span className="text-[9px] text-muted">{allGames.length} games</span>
      </div>
      <div className="flex flex-1 overflow-hidden divide-x divide-border">
        <MatchColumn title="LIBRARY" match={libMatch} />
        <MatchColumn title="WISHLIST" match={wishMatch} />
      </div>
    </div>
  );
}
