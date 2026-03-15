"use client";

import { useState, useEffect } from "react";
import { GameWithTags, Tag, Subtag } from "@/lib/types";
import SteamSearch from "./SteamSearch";
import TagTextInput from "./TagTextInput";

interface TagEntry {
  tag_id: number | "";
  subtag_id: number | "" | null;
}

interface NewSubtagState {
  index: number;
  name: string;
  type: "genre" | "meta";
}

interface Props {
  game: GameWithTags;
  tags: Tag[];
  onSave: (id: number, data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export default function EditModal({ game, tags, onSave, onClose }: Props) {
  const [name, setName] = useState(game.name);
  const [notes, setNotes] = useState(game.notes || "");
  const [steamAppid, setSteamAppid] = useState(game.steam_appid?.toString() || "");
  const [description, setDescription] = useState(game.description || "");
  const [developers, setDevelopers] = useState(game.developers || "");
  const [publishers, setPublishers] = useState(game.publishers || "");
  const [releaseDate, setReleaseDate] = useState(game.release_date || "");
  const [addedAt, setAddedAt] = useState(game.added_at || "");
  const [genres, setGenres] = useState(() => { try { return JSON.parse(game.steam_genres || "[]").join(", "); } catch { return ""; } });
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [tagEntries, setTagEntries] = useState<TagEntry[]>(() => {
    if (game.tags && game.tags.length > 0) {
      return game.tags.map((t) => ({ tag_id: t.tag_id, subtag_id: t.subtag_id }));
    }
    return [{ tag_id: "", subtag_id: "" }];
  });
  const [subtagsMap, setSubtagsMap] = useState<Record<number, Subtag[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showSteamSearch, setShowSteamSearch] = useState(false);
  const [newSubtag, setNewSubtag] = useState<NewSubtagState | null>(null);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch existing genres for autocomplete
  useEffect(() => {
    fetch("/api/genres").then((r) => r.json()).then((data) => {
      setAllGenres((data.genres || []).map((g: { name: string }) => g.name));
    });
  }, []);

  // Fetch subtags for all selected tags
  useEffect(() => {
    const tagIds = tagEntries
      .map((e) => e.tag_id)
      .filter((id): id is number => typeof id === "number" && id > 0);
    const uniqueIds = [...new Set(tagIds)];

    for (const tid of uniqueIds) {
      if (!subtagsMap[tid]) {
        fetch(`/api/subtags?tag_id=${tid}`)
          .then((r) => r.json())
          .then((data) => setSubtagsMap((prev) => ({ ...prev, [tid]: data })));
      }
    }
  }, [tagEntries, subtagsMap]);

  const updateTagEntry = (index: number, field: "tag_id" | "subtag_id", value: number | "" | null) => {
    const updated = [...tagEntries];
    if (field === "tag_id") {
      updated[index] = { tag_id: value as number | "", subtag_id: "" };
    } else {
      updated[index] = { ...updated[index], subtag_id: value };
    }
    setTagEntries(updated);
  };

  const addTagEntry = () => {
    setTagEntries([...tagEntries, { tag_id: "", subtag_id: "" }]);
  };

  const addTagFromText = (tagId: number, subtagId: number | null) => {
    // Check if this exact combo already exists
    const exists = tagEntries.some((e) => e.tag_id === tagId && (e.subtag_id || null) === subtagId);
    if (exists) return;
    // Replace empty first row, or append
    if (tagEntries.length === 1 && tagEntries[0].tag_id === "") {
      setTagEntries([{ tag_id: tagId, subtag_id: subtagId ?? "" }]);
    } else {
      setTagEntries([...tagEntries, { tag_id: tagId, subtag_id: subtagId ?? "" }]);
    }
  };

  const createSubtag = async (index: number, tagId: number, name: string, type: "genre" | "meta") => {
    const res = await fetch("/api/subtags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tagId, name, type }),
    });
    if (!res.ok) return;
    const created = await res.json();
    // Refresh subtags for this tag
    const data = await fetch(`/api/subtags?tag_id=${tagId}`).then((r) => r.json());
    setSubtagsMap((prev) => ({ ...prev, [tagId]: data }));
    // Auto-select the new subtag
    updateTagEntry(index, "subtag_id", created.id);
    setNewSubtag(null);
  };

  const removeTagEntry = (index: number) => {
    if (tagEntries.length <= 1) {
      setTagEntries([{ tag_id: "", subtag_id: "" }]);
    } else {
      setTagEntries(tagEntries.filter((_, i) => i !== index));
    }
  };

  const handleSteamSelect = async (appid: number) => {
    setSteamAppid(String(appid));
    setShowSteamSearch(false);
    // Fetch metadata via our server proxy and fill empty form fields
    try {
      const res = await fetch(`/api/steam/details?appid=${appid}`);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          if (data.name && !name) setName(data.name);
          if (data.short_description && !description) setDescription(data.short_description);
          if (data.developers?.length && !developers) setDevelopers(data.developers.join(", "));
          if (data.publishers?.length && !publishers) setPublishers(data.publishers.join(", "));
          if (data.release_date?.date && !releaseDate) setReleaseDate(data.release_date.date);
          if (data.genres?.length && !genres) setGenres(data.genres.map((g: { description: string }) => g.description).join(", "));
        }
      }
    } catch { /* ignore — user can fill manually */ }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    const tagData = tagEntries
      .filter((e) => e.tag_id)
      .map((e) => ({ tag_id: e.tag_id, subtag_id: e.subtag_id || null }));
    try {
      await onSave(game.id, {
        name,
        notes,
        steam_appid: steamAppid ? Number(steamAppid) : null,
        description,
        developers,
        publishers,
        release_date: releaseDate,
        added_at: addedAt || undefined,
        steam_genres: JSON.stringify(genres.split(",").map((s: string) => s.trim()).filter(Boolean)),
        tags: tagData,
      });
      setSaving(false);
      onClose();
    } catch (err) {
      setSaving(false);
      setSaveError(String(err) || "Save failed");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-lg p-5 space-y-3 overflow-y-auto" style={{ width: "28rem", maxWidth: "90vw", maxHeight: "85vh", resize: "both", minWidth: "20rem", minHeight: "300px" }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-medium">Edit Game</h3>

        <label className="block text-xs text-muted">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
          />
        </label>

        {/* Multiple tags — each row: tag | genre | meta */}
        <div className="text-xs text-muted">
          Tags
          <div className="mt-1 mb-2">
            <TagTextInput
              tags={tags}
              onAdd={addTagFromText}
            />
          </div>
          <div className="mt-1 space-y-2">
            {tagEntries.map((entry, i) => {
              const entrySubtags = typeof entry.tag_id === "number" ? (subtagsMap[entry.tag_id] || []) : [];
              const genreSubs = entrySubtags.filter((s) => s.type === "genre");
              const metaSubs = entrySubtags.filter((s) => s.type === "meta");
              // Determine if current subtag is genre or meta
              const currentSub = entrySubtags.find((s) => s.id === entry.subtag_id);
              const isGenre = currentSub?.type === "genre";
              const isMeta = currentSub?.type === "meta";
              return (
                <div key={i}>
                  <div className="flex gap-1.5 items-center">
                    <select
                      value={entry.tag_id}
                      onChange={(e) => updateTagEntry(i, "tag_id", e.target.value ? Number(e.target.value) : "")}
                      className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-sm text-foreground"
                    >
                      <option value="">Tag</option>
                      {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {typeof entry.tag_id === "number" && (
                      <>
                        <select
                          value={isGenre ? (entry.subtag_id ?? "") : ""}
                          onChange={(e) => updateTagEntry(i, "subtag_id", e.target.value ? Number(e.target.value) : "")}
                          className="flex-1 bg-background border rounded px-2 py-1.5 text-sm text-foreground"
                          style={{ borderColor: "#818cf840" }}
                        >
                          <option value="">Genre</option>
                          {genreSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <select
                          value={isMeta ? (entry.subtag_id ?? "") : ""}
                          onChange={(e) => updateTagEntry(i, "subtag_id", e.target.value ? Number(e.target.value) : "")}
                          className="flex-1 bg-background border rounded px-2 py-1.5 text-sm text-foreground"
                          style={{ borderColor: "#f59e0b40" }}
                        >
                          <option value="">Meta</option>
                          {metaSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button
                          onClick={() => setNewSubtag(newSubtag?.index === i ? null : { index: i, name: "", type: "genre" })}
                          className="text-accent hover:text-accent-hover text-sm px-1 shrink-0"
                          title="Add new subtag"
                        >+</button>
                      </>
                    )}
                    <button
                      onClick={() => removeTagEntry(i)}
                      className="text-muted hover:text-danger text-sm px-1 shrink-0"
                      title="Remove tag"
                    >
                      ×
                    </button>
                  </div>
                  {newSubtag && newSubtag.index === i && typeof entry.tag_id === "number" && (
                    <div className="flex gap-1.5 items-center ml-2 mt-1">
                      <input
                        type="text"
                        value={newSubtag.name}
                        onChange={(e) => setNewSubtag({ ...newSubtag, name: e.target.value })}
                        placeholder="Subtag name"
                        className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newSubtag.name.trim()) {
                            createSubtag(i, entry.tag_id as number, newSubtag.name.trim(), newSubtag.type);
                          } else if (e.key === "Escape") {
                            setNewSubtag(null);
                          }
                        }}
                      />
                      <select
                        value={newSubtag.type}
                        onChange={(e) => setNewSubtag({ ...newSubtag, type: e.target.value as "genre" | "meta" })}
                        className="bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground"
                      >
                        <option value="genre">genre</option>
                        <option value="meta">meta</option>
                      </select>
                      <button
                        onClick={() => { if (newSubtag.name.trim()) createSubtag(i, entry.tag_id as number, newSubtag.name.trim(), newSubtag.type); }}
                        className="text-accent text-xs hover:underline"
                      >Add</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={addTagEntry}
            className="mt-1.5 text-[11px] text-accent hover:underline"
          >
            + Add another tag
          </button>
        </div>

        <div className="text-xs text-muted">
          Steam AppID
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={steamAppid}
              onChange={(e) => setSteamAppid(e.target.value)}
              placeholder="e.g. 620"
              className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowSteamSearch(true)}
              className="bg-surface2 text-foreground px-3 py-1.5 rounded text-xs hover:bg-accent/20"
            >
              🔍 Steam
            </button>
          </div>
          {steamAppid && (
            <img
              src={`/api/assets/${steamAppid}/header.jpg`}
              alt="Steam header"
              className="mt-2 w-full rounded"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          {!steamAppid && game.id && (
            <img
              src={`/api/assets/manual_${game.id}/header.jpg`}
              alt="Manual header"
              className="mt-2 w-full rounded"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </div>

        {showSteamSearch && (
          <SteamSearch
            initialQuery={name}
            onSelect={handleSteamSelect}
            onClose={() => setShowSteamSearch(false)}
          />
        )}

        <label className="block text-xs text-muted">
          Notes
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
          />
        </label>

        <label className="block text-xs text-muted">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent resize-y"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted">
            Developers
            <input type="text" value={developers} onChange={(e) => setDevelopers(e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
          </label>
          <label className="block text-xs text-muted">
            Publishers
            <input type="text" value={publishers} onChange={(e) => setPublishers(e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted">
            Genres
            <GenrePicker value={genres} onChange={setGenres} allGenres={allGenres} />
          </label>
          <label className="block text-xs text-muted">
            Release Date
            <input type="text" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} placeholder="Mar 15, 2024"
              className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
          </label>
          <label className="block text-xs text-muted">
            Added Date
            <input type="text" value={addedAt} onChange={(e) => setAddedAt(e.target.value)} placeholder="2024-03-15 12:00:00"
              className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
          </label>
        </div>

        {!steamAppid && game.id && (
          <div className="text-[10px] text-muted bg-background rounded border border-border p-2">
            📁 Manual images: place files in <code className="bg-surface px-1 rounded">data/assets/games/manual_{game.id}/</code>
            <br />Use <code className="bg-surface px-1 rounded">header.jpg</code>, <code className="bg-surface px-1 rounded">ss_0.jpg</code>, <code className="bg-surface px-1 rounded">ss_1.jpg</code>, etc.
            <button
              type="button"
              onClick={async () => {
                const res = await fetch(`/api/games/${game.id}/scan-images`, { method: "POST" });
                const data = await res.json();
                alert(data.message);
              }}
              className="ml-2 text-accent hover:underline"
            >🔍 Scan folder</button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {saveError && <span className="text-xs text-danger flex-1">{saveError}</span>}
          <button onClick={onClose} className="text-muted text-sm hover:text-foreground">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-white px-4 py-1.5 rounded text-sm hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}


function GenrePicker({ value, onChange, allGenres }: { value: string; onChange: (v: string) => void; allGenres: string[] }) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const selected = value.split(",").map((s) => s.trim()).filter(Boolean);
  const q = input.toLowerCase();
  const suggestions = q.length > 0
    ? allGenres.filter((g) => g.toLowerCase().includes(q) && !selected.includes(g)).slice(0, 8)
    : [];

  const add = (genre: string) => {
    if (!selected.includes(genre)) {
      onChange([...selected, genre].join(", "));
    }
    setInput("");
  };
  const remove = (genre: string) => {
    onChange(selected.filter((g) => g !== genre).join(", "));
  };

  return (
    <div className="mt-1 relative">
      <div className="flex flex-wrap gap-1 bg-background border border-border rounded px-2 py-1 min-h-[30px] items-center">
        {selected.map((g) => (
          <span key={g} className="flex items-center gap-0.5 bg-accent/15 text-accent text-[10px] px-1.5 py-0.5 rounded">
            {g}
            <button onClick={() => remove(g)} className="text-accent/60 hover:text-accent ml-0.5">×</button>
          </span>
        ))}
        <input
          type="text" value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) { e.preventDefault(); add(input.trim()); }
            if (e.key === "Backspace" && !input && selected.length > 0) remove(selected[selected.length - 1]);
          }}
          placeholder={selected.length === 0 ? "Type to search genres..." : ""}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-foreground focus:outline-none"
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-surface border border-border rounded shadow-lg max-h-[150px] overflow-y-auto">
          {suggestions.map((g) => (
            <button key={g} onMouseDown={() => add(g)}
              className="w-full text-left px-3 py-1 text-xs hover:bg-surface2/50 text-foreground">{g}</button>
          ))}
        </div>
      )}
    </div>
  );
}
