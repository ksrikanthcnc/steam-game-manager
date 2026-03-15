"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Tag, Subtag } from "@/lib/types";

interface TagMatch {
  tag_id: number;
  tag_name: string;
  subtag_id: number | null;
  subtag_name: string | null;
  subtag_type: "genre" | "meta" | null;
  score: number; // lower = better
}

interface Props {
  tags: Tag[];
  onAdd: (tagId: number, subtagId: number | null) => void;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 0; // exact
  if (t.startsWith(q)) return 1; // prefix
  if (t.includes(q)) return 2; // contains
  // subsequence match
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 3; // fuzzy
  return -1; // no match
}

export default function TagTextInput({ tags, onAdd }: Props) {
  const [input, setInput] = useState("");
  const [allSubtags, setAllSubtags] = useState<(Subtag & { tag_id: number; tag_name: string })[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all subtags once
  useEffect(() => {
    const fetchAll = async () => {
      const results: (Subtag & { tag_id: number; tag_name: string })[] = [];
      for (const tag of tags) {
        const subs: Subtag[] = await fetch(`/api/subtags?tag_id=${tag.id}`).then((r) => r.json());
        for (const s of subs) results.push({ ...s, tag_id: tag.id, tag_name: tag.name });
      }
      setAllSubtags(results);
    };
    if (tags.length > 0) fetchAll();
  }, [tags]);

  // Get current token (last segment after delimiter)
  const currentToken = useMemo(() => {
    const parts = input.split(/[|,]/);
    return (parts[parts.length - 1] || "").trim();
  }, [input]);

  // Compute matches for current token
  const matches = useMemo((): TagMatch[] => {
    if (currentToken.length < 1) return [];
    const results: TagMatch[] = [];
    const seen = new Set<string>();

    const addResult = (m: TagMatch) => {
      const key = `${m.tag_id}-${m.subtag_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(m);
    };

    const hasSpace = currentToken.includes(" ");

    // Multi-word: try "tag subtag" compound matching
    // e.g. "indie metroid" → match "indie" as tag, "metroid" fuzzy against subtags under indie
    if (hasSpace) {
      const words = currentToken.split(/\s+/);
      // Try progressively longer tag prefixes: "indie", "co op", etc.
      for (let split = 1; split < words.length; split++) {
        const tagPart = words.slice(0, split).join(" ");
        const subPart = words.slice(split).join(" ");
        // Find tags matching the tag part (exact or prefix)
        for (const t of tags) {
          const tScore = fuzzyScore(tagPart, t.name);
          if (tScore > 1) continue; // only exact or prefix match for tag part
          // Now fuzzy-match subPart against subtags under this tag
          for (const s of allSubtags) {
            if (s.tag_id !== t.id) continue;
            const sScore = fuzzyScore(subPart, s.name);
            if (sScore >= 0) {
              // Boost: compound matches get score -1 (best) to 2
              addResult({
                tag_id: t.id, tag_name: t.name,
                subtag_id: s.id, subtag_name: s.name, subtag_type: s.type,
                score: sScore === 0 ? -1 : sScore - 1,
              });
            }
          }
        }
      }

      // Also match full token against "tag subtag" combined strings
      for (const s of allSubtags) {
        const combined = `${s.tag_name} ${s.name}`;
        const cScore = fuzzyScore(currentToken, combined);
        if (cScore >= 0) {
          addResult({
            tag_id: s.tag_id, tag_name: s.tag_name,
            subtag_id: s.id, subtag_name: s.name, subtag_type: s.type,
            score: cScore,
          });
        }
      }
    }

    // Standard single-token matching (always runs as fallback)
    for (const s of allSubtags) {
      const score = fuzzyScore(currentToken, s.name);
      if (score >= 0) {
        addResult({
          tag_id: s.tag_id, tag_name: s.tag_name,
          subtag_id: s.id, subtag_name: s.name, subtag_type: s.type,
          score,
        });
      }
    }

    for (const t of tags) {
      const score = fuzzyScore(currentToken, t.name);
      if (score >= 0) {
        addResult({
          tag_id: t.id, tag_name: t.name,
          subtag_id: null, subtag_name: null, subtag_type: null,
          score,
        });
        // When a tag matches, also show all its subtags (so "kids" shows kids › platformer, etc.)
        if (score <= 1) { // exact or prefix match on tag name
          for (const s of allSubtags) {
            if (s.tag_id !== t.id) continue;
            addResult({
              tag_id: t.id, tag_name: t.name,
              subtag_id: s.id, subtag_name: s.name, subtag_type: s.type,
              score: score + 1, // slightly lower priority than the tag itself
            });
          }
        }
      }
    }

    // Sort: compound matches (negative scores) first, then exact > prefix > contains > fuzzy
    results.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const aName = a.subtag_name || a.tag_name;
      const bName = b.subtag_name || b.tag_name;
      return aName.localeCompare(bName);
    });

    return results.slice(0, 20);
  }, [currentToken, allSubtags, tags]);

  const acceptMatch = useCallback((match: TagMatch) => {
    onAdd(match.tag_id, match.subtag_id);
    // Remove the accepted token from input
    const parts = input.split(/[|,]/);
    parts.pop();
    setInput(parts.length > 0 ? parts.join("|") + "|" : "");
    setSelectedIdx(0);
    inputRef.current?.focus();
  }, [input, onAdd]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (matches.length > 0) {
        e.preventDefault();
        acceptMatch(matches[selectedIdx] || matches[0]);
      }
    }
  };

  const typeColor = (type: "genre" | "meta" | null) => {
    if (type === "genre") return "#818cf8";
    if (type === "meta") return "#f59e0b";
    return "#6b7280";
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => { setInput(e.target.value); setSelectedIdx(0); }}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        placeholder="Type tags... (e.g. indie metroidvania, coop horror)"
        className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
      />
      {focused && currentToken.length >= 1 && matches.length > 0 && (
        <div className="absolute z-10 top-full left-0 right-0 mt-0.5 bg-surface border border-border rounded shadow-lg max-h-48 overflow-y-auto">
          {matches.map((m, i) => (
            <div
              key={`${m.tag_id}-${m.subtag_id}`}
              className={`px-2 py-1 cursor-pointer text-xs flex items-center gap-1.5 ${i === selectedIdx ? "bg-accent/20" : "hover:bg-surface2"}`}
              onMouseDown={(e) => { e.preventDefault(); acceptMatch(m); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="text-muted">{m.tag_name}</span>
              {m.subtag_name && (
                <>
                  <span className="text-muted/50">›</span>
                  <span style={{ color: typeColor(m.subtag_type) }}>{m.subtag_name}</span>
                  <span className="text-[9px] text-muted/40">{m.subtag_type}</span>
                </>
              )}
            </div>
          ))}
          {currentToken.length >= 2 && matches.length === 0 && (
            <div className="px-2 py-1 text-[10px] text-muted">
              No matches — use + button on a tag row to create new subtags
            </div>
          )}
        </div>
      )}
    </div>
  );
}
