"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { COLOR_PRESETS, TintColors, hexToRgba } from "@/lib/types";

function loadPref(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    // Load all display settings from localStorage
    setSettings({
      screenshot_quality: loadPref("gm_ss_quality", "thumbnail"),
      slideshow_speed: loadPref("gm_slideshow_speed", "1"),
      video_delay: loadPref("gm_video_delay", "2"),
      score_source: loadPref("gm_score_source", "steamdb"),
      color_coded: loadPref("gm_color_coded", "0"),
      color_preset: loadPref("gm_color_preset", "subtle"),
      color_custom_high: loadPref("gm_color_custom_high", "#22c55e"),
      color_custom_mid: loadPref("gm_color_custom_mid", "#f59e0b"),
      color_custom_low: loadPref("gm_color_custom_low", "#ef4444"),
      color_opacity: loadPref("gm_color_opacity", "0.08"),
      card_default_image: loadPref("gm_card_image", "header"),
      card_genres_count: loadPref("gm_card_genres", "3"),
      card_community_tags_count: loadPref("gm_card_ctags", "4"),
      log_level: "error",
    });
  }, []);

  const update = (key: string, value: string) => {
    setSettings((s) => ({ ...s, [key]: value }));
    savePref(`gm_${key}`, value);
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-2xl mx-auto pb-16">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">Settings</h1>
          <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30">Read-only demo</span>
        </div>
        <div className="space-y-6">

          {/* Steam Credentials — disabled */}
          <DisabledSection title="Steam Account" reason="Requires local server">
            <p className="text-xs text-muted mb-3">Required for syncing your wishlist and owned games. Get your API key from <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">steamcommunity.com/dev/apikey</a>.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Steam ID</span>
                <input type="text" disabled placeholder="76561198000000000"
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-muted opacity-50 cursor-not-allowed" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">API Key</span>
                <input type="password" disabled placeholder="Your Steam Web API key"
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-muted opacity-50 cursor-not-allowed" />
              </label>
            </div>
          </DisabledSection>

          {/* Screenshot Quality — functional */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Screenshot Quality</h2>
            <p className="text-xs text-muted mb-3">Controls the resolution of screenshots shown in the Inspector and Lightbox.</p>
            <div className="flex gap-3">
              {[{ value: "thumbnail", label: "Thumbnail", desc: "600 × 338" }, { value: "full", label: "Full", desc: "1920 × 1080" }].map((opt) => (
                <button key={opt.value} onClick={() => update("screenshot_quality", opt.value)}
                  className={`flex-1 p-3 rounded-lg border text-left transition-colors ${settings.screenshot_quality === opt.value ? "border-accent bg-accent/10" : "border-border hover:border-border/80"}`}>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-[10px] text-muted">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Media Limits — disabled */}
          <DisabledSection title="Media Limits" reason="Requires local server">
            <p className="text-xs text-muted mb-3">Max screenshots and movies to download per game.</p>
            <div className="flex gap-4 mb-3">
              {[{ label: "Max Screenshots", val: "5" }, { label: "Max Movies", val: "2" }, { label: "Image Concurrency", val: "5" }, { label: "Meta Concurrency", val: "1" }].map((f) => (
                <label key={f.label} className="flex-1"><span className="text-xs text-muted">{f.label}</span>
                  <input type="number" disabled value={f.val}
                    className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-muted opacity-50 cursor-not-allowed" />
                </label>
              ))}
            </div>
            <div className="flex gap-4">
              {["Headers", "SS Thumbnails", "SS HD", "Movie Thumbs"].map((label) => (
                <label key={label} className="flex items-center gap-2 text-xs text-muted opacity-50">
                  <input type="checkbox" checked disabled className="accent-accent" />{label}
                </label>
              ))}
            </div>
          </DisabledSection>

          {/* Slideshow — functional */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Slideshow</h2>
            <p className="text-xs text-muted mb-3">Speed for card hover slideshow and global slideshow toggle.</p>
            <div className="flex gap-2">
              {["0.5", "1", "1.5", "2", "3", "5"].map((v) => (
                <button key={v} onClick={() => update("slideshow_speed", v)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${settings.slideshow_speed === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}s</button>
              ))}
            </div>
          </div>

          {/* Video Delay — functional */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Video Delay</h2>
            <p className="text-xs text-muted mb-3">Seconds to wait before auto-loading video in lightbox.</p>
            <div className="flex gap-2">
              {["0", "1", "2", "3", "5"].map((v) => (
                <button key={v} onClick={() => update("video_delay", v)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${(settings.video_delay || "2") === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}s</button>
              ))}
            </div>
          </div>

          {/* Score & Color Coding — functional */}
          <ColorCodingSettings settings={settings} onUpdate={update} />

          {/* Card View — functional */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Card View</h2>
            <p className="text-xs text-muted mb-3">Controls what's shown on game cards in grid view.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Default Image</span>
                <select value={settings.card_default_image || "header"} onChange={(e) => update("card_default_image", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                  <option value="header">Header (460×215)</option>
                  <option value="ss_0">Screenshot 1</option><option value="ss_1">Screenshot 2</option>
                  <option value="ss_2">Screenshot 3</option><option value="ss_3">Screenshot 4</option>
                </select>
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Genres Shown</span>
                <input type="number" min={0} max={10} value={settings.card_genres_count || "3"} onChange={(e) => update("card_genres_count", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Community Tags Shown</span>
                <input type="number" min={0} max={20} value={settings.card_community_tags_count || "4"} onChange={(e) => update("card_community_tags_count", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
          </div>

          {/* Log Level — disabled */}
          <DisabledSection title="Log Level" reason="Requires local server">
            <p className="text-xs text-muted mb-3">Server console log verbosity for sync operations.</p>
            <div className="flex gap-2">
              {["off", "error", "info", "debug"].map((v) => (
                <button key={v} disabled
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize opacity-50 cursor-not-allowed ${v === "error" ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>{v}</button>
              ))}
            </div>
          </DisabledSection>

          {/* Clipboard Matching — disabled */}
          <DisabledSection title="Clipboard Matching" reason="Requires local server">
            <p className="text-xs text-muted mb-3">Controls how the clipboard search matches game names.</p>
            <div className="flex gap-4">
              {[{ label: "Partial Limit", val: "8" }, { label: "Fuzzy Limit", val: "6" }, { label: "Fuzzy Threshold", val: "0.5" }].map((f) => (
                <label key={f.label} className="flex-1"><span className="text-xs text-muted">{f.label}</span>
                  <input type="number" disabled value={f.val}
                    className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-muted opacity-50 cursor-not-allowed" />
                </label>
              ))}
            </div>
          </DisabledSection>

          {/* Export / Import — disabled */}
          <DisabledSection title="Export / Import" reason="Requires local server">
            <div className="flex gap-3 items-center">
              {["📤 Export CSV", "📤 Export TXT", "📥 Import CSV"].map((label) => (
                <button key={label} disabled className="px-3 py-1.5 rounded text-xs border border-border text-muted opacity-50 cursor-not-allowed">{label}</button>
              ))}
            </div>
          </DisabledSection>

          {/* CSV Export Columns — disabled */}
          <DisabledSection title="CSV Export Columns" reason="Requires local server">
            <p className="text-xs text-muted mb-3">Columns included in the main CSV section.</p>
            <div className="flex flex-wrap gap-2">
              {["ID", "Name", "Steam AppID", "Notes", "Added At", "Tag (L0)", "Genres", "Meta", "Description", "Developers", "Publishers", "Release Date"].map((col) => (
                <span key={col} className="px-2.5 py-1 rounded text-xs border border-border text-muted opacity-50">{col}</span>
              ))}
            </div>
          </DisabledSection>

          {/* Steam Sync — disabled */}
          <DisabledSection title="Steam Sync" reason="Requires local server">
            <div className="mb-4 p-3 bg-background rounded border border-border">
              <div className="text-[11px] text-muted mb-2">Cache status:</div>
              <div className="flex gap-4">
                {[{ label: "App Details", pct: 100 }, { label: "Reviews", pct: 100 }, { label: "Community Tags", pct: 100 }].map((s) => (
                  <div key={s.label} className="flex-1 opacity-50">
                    <div className="text-[10px] text-muted">{s.label}</div>
                    <div className="text-sm font-medium">—/— <span className="text-[10px] text-muted">({s.pct}%)</span></div>
                    <div className="h-1 bg-surface2 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-green-500/60 rounded-full" style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              {["🔄 Sync Wishlist", "🎮 Sync Owned", "🖼 Download Images", "🚫 Import Ignored"].map((label) => (
                <button key={label} disabled className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted opacity-50 cursor-not-allowed">{label}</button>
              ))}
            </div>
            <div className="text-[10px] text-muted mb-1">Fetch missing (auto-resumable):</div>
            <div className="flex gap-2 mb-3">
              {["📦 All 3", "App Details", "Reviews", "Community"].map((label) => (
                <button key={label} disabled className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted opacity-50 cursor-not-allowed">{label}</button>
              ))}
            </div>
          </DisabledSection>

          {/* Database — disabled */}
          <DisabledSection title="🗄️ Database" reason="Requires local server">
            <p className="text-xs text-muted mb-3">Re-run DB init: column migrations + asset count sync. Nothing is deleted.</p>
            <div className="flex gap-2">
              {["⟳ Re-init Database", "🔗 Recalculate Similarities", "💾 Flush WAL"].map((label) => (
                <button key={label} disabled className="px-3 py-1.5 rounded text-xs border border-border text-muted opacity-50 cursor-not-allowed">{label}</button>
              ))}
            </div>
          </DisabledSection>

          {/* Tags — read-only view */}
          <TagViewer />
        </div>
      </div>
    </div>
  );
}


function DisabledSection({ title, reason, children }: { title: string; reason: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg p-4 border border-border relative">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-[9px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">{reason}</span>
      </div>
      {children}
    </div>
  );
}

function ColorCodingSettings({ settings, onUpdate }: { settings: Record<string, string>; onUpdate: (key: string, value: string) => void }) {
  const scoreSource = settings.score_source || "steamdb";
  const colorCoded = settings.color_coded === "1";
  const preset = settings.color_preset || "subtle";

  const getCustom = (): TintColors => ({
    high: settings.color_custom_high || "#22c55e",
    mid: settings.color_custom_mid || "#f59e0b",
    low: settings.color_custom_low || "#ef4444",
    opacity: parseFloat(settings.color_opacity || "0.08"),
  });

  const activeTint: TintColors = preset === "custom" ? getCustom() : (COLOR_PRESETS[preset] || COLOR_PRESETS.subtle);

  const samples = [
    { label: "92 · Very Positive", score: 92 },
    { label: "58 · Mixed", score: 58 },
    { label: "24 · Mostly Negative", score: 24 },
  ];

  return (
    <div className="bg-surface rounded-lg p-4 border border-border space-y-4">
      <div>
        <h2 className="text-sm font-medium mb-1">Score & Color Coding</h2>
        <p className="text-xs text-muted">Choose primary score source and tint style for cards and rows.</p>
      </div>
      <div>
        <div className="text-xs text-muted mb-2">Primary Score</div>
        <div className="flex gap-3">
          {[{ value: "steamdb", label: "SteamDB", desc: "Wilson score (adjusts for sample size)" }, { value: "steam", label: "Steam", desc: "Raw positive % from reviews" }].map((opt) => (
            <button key={opt.value} onClick={() => onUpdate("score_source", opt.value)}
              className={`flex-1 p-2.5 rounded-lg border text-left transition-colors ${scoreSource === opt.value ? "border-accent bg-accent/10" : "border-border hover:border-border/80"}`}>
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-[10px] text-muted">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted mb-2">Tinting</div>
        <div className="flex gap-3">
          {[{ value: "0", label: "Default", desc: "No tint" }, { value: "1", label: "Color-coded", desc: "Tint by score" }].map((opt) => (
            <button key={opt.value} onClick={() => onUpdate("color_coded", opt.value)}
              className={`flex-1 p-2.5 rounded-lg border text-left transition-colors ${(settings.color_coded || "0") === opt.value ? "border-accent bg-accent/10" : "border-border hover:border-border/80"}`}>
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-[10px] text-muted">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>
      {colorCoded && (<>
        <div>
          <div className="text-xs text-muted mb-2">Color Preset</div>
          <div className="flex gap-2">
            {(["subtle", "vivid", "neon", "custom"] as const).map((p) => (
              <button key={p} onClick={() => onUpdate("color_preset", p)}
                className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${preset === p ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{p}</button>
            ))}
          </div>
        </div>
        {preset === "custom" && (() => {
          const c = getCustom();
          return (
            <div className="flex gap-4 items-end">
              {([
                { key: "color_custom_high", label: "High (≥70)", val: c.high },
                { key: "color_custom_mid", label: "Mid (≥40)", val: c.mid },
                { key: "color_custom_low", label: "Low (<40)", val: c.low },
              ] as const).map(({ key, label, val }) => (
                <label key={key} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-muted">{label}</span>
                  <input type="color" value={val} onChange={(e) => onUpdate(key, e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                </label>
              ))}
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] text-muted">Opacity ({Math.round(c.opacity * 100)}%)</span>
                <input type="range" min={0.02} max={0.25} step={0.01} value={c.opacity}
                  onChange={(e) => onUpdate("color_opacity", e.target.value)} className="accent-accent" />
              </label>
            </div>
          );
        })()}
        <div>
          <div className="text-xs text-muted mb-2">Preview</div>
          <div className="flex gap-2">
            {samples.map((s) => {
              const tintColor = s.score >= 70 ? activeTint.high : s.score >= 40 ? activeTint.mid : activeTint.low;
              return (
                <div key={s.score} className="flex-1 rounded-lg border border-border/50 p-3 text-center"
                  style={{ backgroundColor: hexToRgba(tintColor, activeTint.opacity) }}>
                  <div className="text-sm font-bold" style={{ color: tintColor }}>{s.score}</div>
                  <div className="text-[10px] text-muted">{s.label.split(" · ")[1]}</div>
                </div>
              );
            })}
          </div>
        </div>
      </>)}
    </div>
  );
}

function TagViewer() {
  const [tags, setTags] = useState<{ id: number; name: string; color: string }[]>([]);
  const [subtags, setSubtags] = useState<{ id: number; tag_id: number; name: string; type: string }[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
  useEffect(() => {
    fetch(`${BASE}/data/tags.json`).then(r => r.json()).then(setTags).catch(() => {});
    fetch(`${BASE}/data/subtags.json`).then(r => r.json()).then(setSubtags).catch(() => {});
  }, [BASE]);

  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-medium">Tags & Subtags</h2>
        <span className="text-[9px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">View only</span>
      </div>
      <p className="text-xs text-muted mb-3">Click a tag to expand and see its subtags.</p>
      <div className="space-y-1">
        {tags.map((tag) => {
          const tagSubs = subtags.filter((s) => s.tag_id === tag.id);
          const isExpanded = expanded.has(tag.id);
          return (
            <div key={tag.id}>
              <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface2/30 cursor-pointer"
                onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(tag.id)) n.delete(tag.id); else n.add(tag.id); return n; })}>
                <span className="text-[10px] text-muted w-4">{tagSubs.length > 0 ? (isExpanded ? "▼" : "▶") : "·"}</span>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="flex-1 text-sm">{tag.name}</span>
                <span className="text-[10px] text-muted">{tagSubs.length} subtags</span>
              </div>
              {isExpanded && tagSubs.length > 0 && (
                <div className="ml-8 space-y-0.5 mb-1">
                  {tagSubs.map((sub) => (
                    <div key={sub.id} className="flex items-center gap-2 px-2 py-0.5 rounded text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${sub.type === "genre" ? "bg-blue-500/20 text-blue-300" : "bg-orange-500/20 text-orange-300"}`}>{sub.type}</span>
                      <span>{sub.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
