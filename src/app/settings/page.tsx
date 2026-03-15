"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { COLOR_PRESETS, TintColors, hexToRgba } from "@/lib/types";

type SessionInfo = { source: string; started_at: string; total: number; done: number; failed: number; last_appid: number | null; status: string };
type MetaStatus = { totalGames: number; cached: { appdetails: number; reviews: number; community: number }; sessions: Record<string, SessionInfo> };
type SubtagRow = { id: number; tag_id: number; name: string; type: string; tag_name: string };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncRunning, setSyncRunning] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [showIgnoredInput, setShowIgnoredInput] = useState(false);
  const [lanIps, setLanIps] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const appendLog = useCallback((msg: string) => { setSyncLog((prev) => [...prev, msg]); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [syncLog]);
  const fetchMetaStatus = useCallback(async () => {
    try { const r = await fetch("/api/sync/metadata"); if (r.ok) setMetaStatus(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchMetaStatus(); }, [fetchMetaStatus]);
  useEffect(() => { fetch("/api/network").then(r => r.json()).then(d => setLanIps(d.ips || [])).catch(() => {}); }, []);
  const runSync = useCallback(async (endpoint: string, label: string) => {
    if (syncRunning) return;
    setSyncRunning(label); setSyncLog([`Starting ${label}...`]); setSyncProgress(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok || !res.body) { appendLog(`Error: ${res.status} ${res.statusText}`); setSyncRunning(null); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim(); if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine);
            if (data.type === "status") appendLog(data.message);
            else if (data.type === "progress") { setSyncProgress({ current: data.current, total: data.total }); if (data.name) appendLog(`[${data.current}/${data.total}] ${data.name}${data.error ? ` ✗ ${data.error}` : " ✓"}`); }
            else if (data.type === "done") { appendLog(data.message || "Done."); if (data.removedNames?.length > 0) appendLog(`Removed: ${data.removedNames.join(", ")}`); }
            else if (data.type === "error") appendLog(`Error: ${data.message}`);
          } catch { /* ignore */ }
        }
      }
    } catch (err) { appendLog(`Error: ${err}`); }
    setSyncRunning(null); setSyncProgress(null); fetchMetaStatus();
  }, [syncRunning, appendLog, fetchMetaStatus]);
  useEffect(() => { fetch("/api/settings").then((r) => r.json()).then(setSettings); }, []);
  const update = async (key: string, value: string) => {
    setSaving(true); setSettings((s) => ({ ...s, [key]: value }));
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
    setSaving(false);
  };
  const srcLabel: Record<string, string> = { appdetails: "App Details", reviews: "Reviews", community: "Community Tags" };
  const cachedKey: Record<string, keyof MetaStatus["cached"]> = { appdetails: "appdetails", reviews: "reviews", community: "community" };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-2xl mx-auto pb-16">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">Settings</h1>
          {saving && <span className="text-xs text-muted animate-pulse">Saving...</span>}
          <div className="ml-auto text-[11px] text-muted">
            {lanIps.length > 0 && <>LAN: {lanIps.map((ip) => <a key={ip} href={`http://${ip}:3000`} target="_blank" rel="noopener noreferrer" className="text-accent ml-1 hover:underline">{ip}:3000</a>)}</>}
          </div>
        </div>
        <div className="space-y-6">
          {/* Steam Credentials */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Steam Account</h2>
            <p className="text-xs text-muted mb-3">Required for syncing your wishlist and owned games. Get your API key from <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">steamcommunity.com/dev/apikey</a>.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Steam ID</span>
                <input type="text" value={settings.steam_id || ""} onChange={(e) => update("steam_id", e.target.value)}
                  placeholder="76561198000000000"
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent font-mono" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">API Key</span>
                <input type="password" value={settings.steam_api_key || ""} onChange={(e) => update("steam_api_key", e.target.value)}
                  placeholder="Your Steam Web API key"
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent font-mono" />
              </label>
            </div>
            {(!settings.steam_id || !settings.steam_api_key) && (
              <p className="text-[10px] text-amber-400 mt-2">⚠ Configure both fields to enable wishlist and owned games sync.</p>
            )}
          </div>
          {/* Screenshot Quality */}
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
          {/* Media Limits */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Media Limits</h2>
            <p className="text-xs text-muted mb-3">Max screenshots and movies to download per game.</p>
            <div className="flex gap-4 mb-3">
              <label className="flex-1"><span className="text-xs text-muted">Max Screenshots</span>
                <input type="number" min={1} max={50} value={settings.max_screenshots || "5"} onChange={(e) => update("max_screenshots", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Max Movies</span>
                <input type="number" min={0} max={20} value={settings.max_movies || "2"} onChange={(e) => update("max_movies", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Image Concurrency</span>
                <input type="number" min={1} max={20} value={settings.image_concurrency || "5"} onChange={(e) => update("image_concurrency", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Meta Concurrency</span>
                <input type="number" min={1} max={10} value={settings.meta_concurrency || "1"} onChange={(e) => update("meta_concurrency", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
            <div className="flex gap-4">
              {([
                { key: "dl_headers", label: "Headers" },
                { key: "dl_ss_low", label: "SS Thumbnails" },
                { key: "dl_ss_hd", label: "SS HD" },
                { key: "dl_movies", label: "Movie Thumbs" },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                  <input type="checkbox" checked={settings[key] !== "0"}
                    onChange={(e) => update(key, e.target.checked ? "1" : "0")}
                    className="accent-accent" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {/* Slideshow */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Log Level</h2>
            <p className="text-xs text-muted mb-3">Server console log verbosity for sync operations.</p>
            <div className="flex gap-2">
              {(["off", "error", "info", "debug"] as const).map((v) => (
                <button key={v} onClick={() => update("log_level", v)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${(settings.log_level || "error") === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}</button>
              ))}
            </div>
          </div>
          {/* Slideshow */}
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
          {/* Video Delay */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Video Delay</h2>
            <p className="text-xs text-muted mb-3">Seconds to wait before auto-loading video in lightbox.</p>
            <div className="flex gap-2">
              {["0", "1", "2", "3", "5"].map((v) => (
                <button key={v} onClick={() => { localStorage.setItem("gm_video_delay", v); update("video_delay", v); }}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${(settings.video_delay || "2") === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}s</button>
              ))}
            </div>
          </div>
          {/* Score & Color Coding */}
          <ColorCodingSettings settings={settings} onUpdate={update} />
          {/* Card View */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Card View</h2>
            <p className="text-xs text-muted mb-3">Controls what's shown on game cards in grid view.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Default Image</span>
                <select value={settings.card_default_image || "header"} onChange={(e) => update("card_default_image", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                  <option value="header">Header (460×215)</option>
                  <option value="ss_0">Screenshot 1</option>
                  <option value="ss_1">Screenshot 2</option>
                  <option value="ss_2">Screenshot 3</option>
                  <option value="ss_3">Screenshot 4</option>
                  <option value="ss_4">Screenshot 5</option>
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
          {/* Clipboard Matching */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Clipboard Matching</h2>
            <p className="text-xs text-muted mb-3">Controls how the clipboard search matches game names.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Partial Limit</span>
                <input type="number" min={1} max={20} value={settings.clip_partial_limit || "8"} onChange={(e) => update("clip_partial_limit", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Fuzzy Limit</span>
                <input type="number" min={1} max={20} value={settings.clip_fuzzy_limit || "6"} onChange={(e) => update("clip_fuzzy_limit", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Fuzzy Threshold</span>
                <input type="number" min={0.1} max={1} step={0.05} value={settings.clip_fuzzy_threshold || "0.5"} onChange={(e) => update("clip_fuzzy_threshold", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
          </div>
          {/* Export / Import */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Export / Import</h2>
            <div className="flex gap-3 items-center">
              <a href="/api/export/csv" className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors">📤 Export CSV</a>
              <a href="/api/export/txt" className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors">📤 Export TXT</a>
              <label className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors cursor-pointer">
                📥 Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const res = await fetch("/api/import/csv", { method: "POST", body: text });
                  const data = await res.json();
                  alert(`Import: ${data.added} new, ${data.updated || 0} updated, ${data.existing} existing, ${data.tagLinks} tag links`);
                  window.location.reload();
                }} />
              </label>
            </div>
          </div>
          {/* CSV Export Columns */}
          <CsvColumnsConfig settings={settings} onUpdate={update} />
          {/* Bookmarklet */}
          {/* Steam Sync */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Steam Sync</h2>
            {/* Cache stats */}
            {metaStatus && (
              <div className="mb-4 p-3 bg-background rounded border border-border">
                <div className="text-[11px] text-muted mb-2">Cache status ({metaStatus.totalGames} games total):</div>
                <div className="flex gap-4">
                  {(["appdetails", "reviews", "community"] as const).map((src) => {
                    const cached = metaStatus.cached[cachedKey[src]];
                    const pct = metaStatus.totalGames > 0 ? Math.round((cached / metaStatus.totalGames) * 100) : 0;
                    return (
                      <div key={src} className="flex-1">
                        <div className="text-[10px] text-muted">{srcLabel[src]}</div>
                        <div className="text-sm font-medium">{cached}/{metaStatus.totalGames} <span className="text-[10px] text-muted">({pct}%)</span></div>
                        <div className="h-1 bg-surface2 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-green-500/60 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Wishlist + Owned + Images */}
            <div className="flex gap-2 mb-3">
              <SyncBtn label="🔄 Sync Wishlist" color="blue" running={syncRunning} id="wishlist" onClick={() => runSync("/api/sync/wishlist", "wishlist")} />
              <SyncBtn label="🎮 Sync Owned" color="green" running={syncRunning} id="owned" onClick={() => runSync("/api/sync/owned", "owned")} />
              <SyncBtn label="🖼 Download Images" color="purple" running={syncRunning} id="images" onClick={() => runSync("/api/sync/images", "images")} />
              <SyncBtn label="🚫 Import Ignored" color="red" running={syncRunning} id="ignored" onClick={() => setShowIgnoredInput(true)} />
            </div>
            {showIgnoredInput && (
              <div className="mb-3 p-3 rounded border border-red-500/30 bg-red-500/5 space-y-2">
                <div className="text-xs text-muted">
                  Paste the full JSON from{" "}
                  <a href="https://store.steampowered.com/dynamicstore/userdata/" target="_blank" rel="noopener noreferrer"
                    className="text-accent underline hover:text-accent/80">store.steampowered.com/dynamicstore/userdata/</a>
                  {" "}(auto-extracts <code className="text-foreground">rgIgnoredApps</code>) or just the ignored section. Type 0 = not interested, non-zero = played elsewhere.
                </div>
                <textarea id="ignored-input" rows={3} placeholder='{"appid":1, ...} or [appid, appid, ...]'
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono" />
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const input = (document.getElementById("ignored-input") as HTMLTextAreaElement)?.value?.trim();
                    if (!input) return;
                    let body: unknown;
                    try { body = JSON.parse(input); } catch (e) { alert("Invalid JSON: " + e); return; }
                    setShowIgnoredInput(false);
                    setSyncRunning("ignored"); setSyncLog(["Sending to server..."]); setSyncProgress(null);
                    try {
                      const res = await fetch("/api/sync/ignored", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                      if (!res.ok || !res.body) { appendLog(`Error: ${res.status}`); setSyncRunning(null); return; }
                      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
                      while (true) {
                        const { done, value } = await reader.read(); if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n\n"); buffer = lines.pop() || "";
                        for (const line of lines) {
                          const d = line.replace(/^data: /, "").trim(); if (!d) continue;
                          try {
                            const data = JSON.parse(d);
                            if (data.type === "progress") { setSyncProgress({ current: data.current, total: data.total }); if (data.name) appendLog(`[${data.current}/${data.total}] ${data.name}`); }
                            else if (data.type === "done") { appendLog(data.message || "Done."); }
                            else appendLog(data.message || JSON.stringify(data));
                          } catch {}
                        }
                      }
                      setSyncRunning(null); setSyncProgress(null);
                    } catch (e) { appendLog(`Error: ${e}`); setSyncRunning(null); }
                  }} className="px-3 py-1 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30">Import</button>
                  <button onClick={() => setShowIgnoredInput(false)} className="px-3 py-1 text-xs rounded text-muted hover:text-foreground border border-border">Cancel</button>
                </div>
              </div>
            )}
            {/* Fetch missing */}
            <div className="text-[10px] text-muted mb-1">Fetch missing (auto-resumable):</div>
            <div className="flex gap-2 mb-3">
              <SyncBtn label="📦 All 3" color="green" running={syncRunning} id="meta-miss-all" onClick={() => runSync("/api/sync/metadata?source=all&mode=missing", "meta-miss-all")} />
              <SyncBtn label="App Details" color="green" running={syncRunning} id="meta-miss-det" onClick={() => runSync("/api/sync/metadata?source=appdetails&mode=missing", "meta-miss-det")} />
              <SyncBtn label="Reviews" color="green" running={syncRunning} id="meta-miss-rev" onClick={() => runSync("/api/sync/metadata?source=reviews&mode=missing", "meta-miss-rev")} />
              <SyncBtn label="Community" color="green" running={syncRunning} id="meta-miss-ct" onClick={() => runSync("/api/sync/metadata?source=community&mode=missing", "meta-miss-ct")} />
            </div>
            {/* Re-fetch all per source with session info */}
            <div className="text-[10px] text-muted mb-1">Re-fetch all (overwrites cache):</div>
            {(["appdetails", "reviews", "community"] as const).map((src) => {
              const session = metaStatus?.sessions[src];
              const hasInterrupted = session && session.status !== "done";
              return (
                <div key={src} className="flex items-center gap-2 mb-2">
                  <div className="w-28 text-xs text-muted">{srcLabel[src]}</div>
                  {hasInterrupted ? (
                    <>
                      <span className="text-[10px] text-yellow-400">⏸ {session.done}/{session.total}{session.failed > 0 && `, ${session.failed} err`}{session.started_at && ` · ${new Date(session.started_at + "Z").toLocaleDateString()}`}</span>
                      <SyncBtn label="▶ Resume" color="yellow" running={syncRunning} id={`meta-resume-${src}`} onClick={() => runSync(`/api/sync/metadata?source=${src}&mode=resume`, `meta-resume-${src}`)} />
                      <SyncBtn label="⟳ Fresh" color="red" running={syncRunning} id={`meta-fresh-${src}`} onClick={() => runSync(`/api/sync/metadata?source=${src}&mode=fresh`, `meta-fresh-${src}`)} />
                    </>
                  ) : (
                    <>
                      {session?.status === "done" && <span className="text-[10px] text-green-400">✓ {session.done}/{session.total}{session.started_at && ` · ${new Date(session.started_at + "Z").toLocaleDateString()}`}</span>}
                      <SyncBtn label="⟳ Start" color="yellow" running={syncRunning} id={`meta-fresh-${src}`} onClick={() => runSync(`/api/sync/metadata?source=${src}&mode=fresh`, `meta-fresh-${src}`)} />
                    </>
                  )}
                </div>
              );
            })}
            {/* Progress bar */}
            {syncProgress && (
              <div className="mt-3 mb-2">
                <div className="flex justify-between text-[10px] text-muted mb-1"><span>{syncRunning}</span><span>{syncProgress.current}/{syncProgress.total}</span></div>
                <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }} />
                </div>
              </div>
            )}
            {/* Log */}
            {syncLog.length > 0 && (
              <div ref={logRef} className="mt-3 bg-background rounded border border-border p-2 max-h-[200px] overflow-y-auto font-mono text-[11px] text-muted space-y-0.5">
                {syncLog.map((line, i) => (
                  <div key={i} className={line.includes("✗") || line.includes("Error") ? "text-red-400" : line.includes("✓") || line.includes("done") ? "text-green-400" : line.startsWith("---") ? "text-accent" : ""}>{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* Database */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold mb-3">🗄️ Database</h2>
            <p className="text-xs text-muted mb-3">Re-run DB init: column migrations + asset count sync. Nothing is deleted.</p>
            <button
              onClick={async () => {
                const res = await fetch("/api/db/reset", { method: "POST" });
                const data = await res.json();
                if (data.ok) alert("DB re-initialized.");
                else alert("Error: " + data.message);
              }}
              className="px-3 py-1.5 rounded text-xs border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
            >⟳ Re-init Database</button>
            <button
              onClick={async () => {
                setSyncRunning("similarities"); setSyncLog(["Recalculating similarities..."]);
                try {
                  const res = await fetch("/api/sync/similarities", { method: "POST" });
                  const data = await res.json();
                  if (data.ok) appendLog(`Done: ${data.games} games, ${data.pairs} similarity pairs computed.`);
                  else appendLog("Error: " + JSON.stringify(data));
                } catch (err) { appendLog(`Error: ${err}`); }
                setSyncRunning(null);
              }}
              disabled={!!syncRunning}
              className="ml-2 px-3 py-1.5 rounded text-xs border border-purple-500/50 text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
            >🔗 Recalculate Similarities</button>
          </div>

          {/* Tag & Subtag Management */}
          <TagManager />
        </div>
      </div>
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

      {/* Score Source */}
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

      {/* Color Coding Toggle */}
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

      {/* Preset + Custom (only when color-coded) */}
      {colorCoded && (
        <>
          <div>
            <div className="text-xs text-muted mb-2">Color Preset</div>
            <div className="flex gap-2">
              {(["subtle", "vivid", "neon", "custom"] as const).map((p) => (
                <button key={p} onClick={() => onUpdate("color_preset", p)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${preset === p ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Custom color pickers */}
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
                    onChange={(e) => onUpdate("color_opacity", e.target.value)}
                    className="accent-accent" />
                </label>
              </div>
            );
          })()}

          {/* Preview */}
          <div>
            <div className="text-xs text-muted mb-2">Preview</div>
            <div className="flex gap-2">
              {samples.map((s) => {
                const tintColor = s.score >= 70 ? activeTint.high : s.score >= 40 ? activeTint.mid : activeTint.low;
                const textColor = s.score >= 70 ? activeTint.high : s.score >= 40 ? activeTint.mid : activeTint.low;
                return (
                  <div key={s.score} className="flex-1 rounded-lg border border-border/50 p-3 text-center"
                    style={{ backgroundColor: hexToRgba(tintColor, activeTint.opacity) }}>
                    <div className="text-sm font-bold" style={{ color: textColor }}>{s.score}</div>
                    <div className="text-[10px] text-muted">{s.label.split(" · ")[1]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SyncBtn({ label, color, running, id, onClick }: { label: string; color: string; running: string | null; id: string; onClick: () => void }) {
  const isThis = running === id;
  const colorMap: Record<string, string> = {
    blue: "border-blue-500/50 text-blue-400 hover:bg-blue-500/10",
    green: "border-green-500/50 text-green-400 hover:bg-green-500/10",
    yellow: "border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10",
    purple: "border-purple-500/50 text-purple-400 hover:bg-purple-500/10",
    red: "border-red-500/50 text-red-400 hover:bg-red-500/10",
  };
  const activeMap: Record<string, string> = {
    blue: "bg-blue-500/20 border-blue-500 text-blue-400",
    green: "bg-green-500/20 border-green-500 text-green-400",
    yellow: "bg-yellow-500/20 border-yellow-500 text-yellow-400",
    purple: "bg-purple-500/20 border-purple-500 text-purple-400",
    red: "bg-red-500/20 border-red-500 text-red-400",
  };
  return (
    <button onClick={onClick} disabled={!!running}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isThis ? `${activeMap[color]} animate-pulse` : running ? "opacity-40 cursor-not-allowed border-border text-muted" : colorMap[color]}`}>
      {label}
    </button>
  );
}

const ALL_CSV_COLS = [
  { key: "id", label: "ID", locked: true },
  { key: "name", label: "Name", locked: true },
  { key: "steam_appid", label: "Steam AppID" },
  { key: "notes", label: "Notes" },
  { key: "added_at", label: "Added At" },
  { key: "l0", label: "Tag (L0)", locked: true },
  { key: "genres", label: "Genres", locked: true },
  { key: "meta", label: "Meta", locked: true },
  { key: "description", label: "Description" },
  { key: "developers", label: "Developers" },
  { key: "publishers", label: "Publishers" },
  { key: "release_date", label: "Release Date" },
  { key: "review_sentiment", label: "Review Sentiment" },
  { key: "positive_percent", label: "Positive %" },
  { key: "total_reviews", label: "Total Reviews" },
  { key: "metacritic_score", label: "Metacritic" },
  { key: "steam_genres", label: "Steam Genres" },
  { key: "steam_features", label: "Steam Features" },
  { key: "community_tags", label: "Community Tags" },
  { key: "wishlist_date", label: "Wishlist Date" },
  { key: "steam_image_url", label: "Image URL" },
];

const DEFAULT_CSV_COLS = ["id", "name", "steam_appid", "notes", "added_at", "l0", "genres", "meta"];

function CsvColumnsConfig({ settings, onUpdate }: { settings: Record<string, string>; onUpdate: (key: string, value: string) => void }) {
  const current: string[] = (() => {
    try { return JSON.parse(settings.csv_export_columns || "[]"); } catch { return DEFAULT_CSV_COLS; }
  })();
  const isDefault = JSON.stringify(current) === JSON.stringify(DEFAULT_CSV_COLS);

  const toggle = (key: string) => {
    const locked = ALL_CSV_COLS.find((c) => c.key === key)?.locked;
    if (locked) return;
    const next = current.includes(key) ? current.filter((c) => c !== key) : [...current, key];
    onUpdate("csv_export_columns", JSON.stringify(next));
  };

  const reset = () => onUpdate("csv_export_columns", JSON.stringify(DEFAULT_CSV_COLS));

  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-medium">CSV Export Columns</h2>
          <p className="text-xs text-muted mt-1">Columns included in the main CSV section. Not-on-steam section always exports all columns.</p>
        </div>
        {!isDefault && (
          <button onClick={reset} className="text-xs text-accent hover:underline">Reset to default</button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_CSV_COLS.map((col) => {
          const active = current.includes(col.key);
          const locked = col.locked;
          return (
            <button key={col.key} onClick={() => toggle(col.key)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                active
                  ? locked ? "border-accent/40 bg-accent/10 text-accent/70 cursor-default" : "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground hover:border-border/80"
              }`}>
              {col.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagManager() {
  const [tags, setTags] = useState<{ id: number; name: string; color: string }[]>([]);
  const [subtags, setSubtags] = useState<SubtagRow[]>([]);
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("");
  const [editingSub, setEditingSub] = useState<number | null>(null);
  const [editSubName, setEditSubName] = useState("");
  const [editSubType, setEditSubType] = useState<string>("genre");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [showNewTag, setShowNewTag] = useState(false);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then(setTags);
    fetch("/api/subtags").then((r) => r.json()).then(setSubtags);
  }, []);

  const startEditTag = (tag: { id: number; name: string; color: string }) => {
    setEditingTag(tag.id); setEditTagName(tag.name); setEditTagColor(tag.color);
  };
  const saveTag = async () => {
    if (!editingTag) return;
    await fetch(`/api/tags/${editingTag}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editTagName, color: editTagColor }) });
    setTags((prev) => prev.map((t) => t.id === editingTag ? { ...t, name: editTagName, color: editTagColor } : t));
    setEditingTag(null);
  };
  const startEditSub = (sub: SubtagRow) => {
    setEditingSub(sub.id); setEditSubName(sub.name); setEditSubType(sub.type);
  };
  const saveSub = async () => {
    if (!editingSub) return;
    await fetch(`/api/subtags/${editingSub}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editSubName, type: editSubType }) });
    setSubtags((prev) => prev.map((s) => s.id === editingSub ? { ...s, name: editSubName, type: editSubType } : s));
    setEditingSub(null);
  };
  const toggleExpand = (id: number) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const createTag = async () => {
    if (!newTagName.trim()) return;
    const res = await fetch("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }) });
    if (res.ok) { const tag = await res.json(); setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name))); setNewTagName(""); setShowNewTag(false); }
    else { const err = await res.json(); alert(err.error || "Failed to create tag"); }
  };

  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <h2 className="text-sm font-medium mb-3">Tags & Subtags</h2>
      <p className="text-xs text-muted mb-3">Click a tag to edit name/color. Expand to see and edit subtags (rename, change genre/meta type).</p>
      {showNewTag ? (
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded bg-surface2/30 border border-accent/30">
          <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
          <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name"
            onKeyDown={(e) => { if (e.key === "Enter") createTag(); if (e.key === "Escape") setShowNewTag(false); }}
            className="flex-1 bg-background border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:border-accent" autoFocus />
          <button onClick={createTag} className="text-xs text-green-400 hover:underline">Create</button>
          <button onClick={() => setShowNewTag(false)} className="text-xs text-muted hover:underline">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowNewTag(true)} className="mb-3 px-3 py-1 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors">+ New Tag</button>
      )}
      <div className="space-y-1">
        {tags.map((tag) => {
          const tagSubs = subtags.filter((s) => s.tag_id === tag.id);
          const isExpanded = expanded.has(tag.id);
          return (
            <div key={tag.id}>
              <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface2/30">
                {editingTag === tag.id ? (
                  <>
                    <input type="color" value={editTagColor} onChange={(e) => setEditTagColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
                    <input type="text" value={editTagName} onChange={(e) => setEditTagName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTag(); if (e.key === "Escape") setEditingTag(null); }}
                      className="flex-1 bg-background border border-accent rounded px-2 py-0.5 text-sm focus:outline-none" autoFocus />
                    <button onClick={saveTag} className="text-xs text-green-400 hover:underline">Save</button>
                    <button onClick={() => setEditingTag(null)} className="text-xs text-muted hover:underline">Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => toggleExpand(tag.id)} className="text-[10px] text-muted w-4">{tagSubs.length > 0 ? (isExpanded ? "▼" : "▶") : "·"}</button>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1 text-sm cursor-pointer hover:text-accent" onClick={() => startEditTag(tag)}>{tag.name}</span>
                    <span className="text-[10px] text-muted">{tagSubs.length} subtags</span>
                    <button onClick={() => startEditTag(tag)} className="text-[10px] text-muted hover:text-foreground">✏️</button>
                  </>
                )}
              </div>
              {/* Subtags */}
              {isExpanded && tagSubs.length > 0 && (
                <div className="ml-8 space-y-0.5 mb-1">
                  {tagSubs.map((sub) => (
                    <div key={sub.id} className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-surface2/20 text-xs">
                      {editingSub === sub.id ? (
                        <>
                          <input type="text" value={editSubName} onChange={(e) => setEditSubName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveSub(); if (e.key === "Escape") setEditingSub(null); }}
                            className="flex-1 bg-background border border-accent rounded px-2 py-0.5 text-xs focus:outline-none" autoFocus />
                          <select value={editSubType} onChange={(e) => setEditSubType(e.target.value)}
                            className="bg-background border border-border rounded px-1 py-0.5 text-[10px]">
                            <option value="genre">genre</option>
                            <option value="meta">meta</option>
                          </select>
                          <button onClick={saveSub} className="text-green-400 hover:underline">Save</button>
                          <button onClick={() => setEditingSub(null)} className="text-muted hover:underline">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${sub.type === "genre" ? "bg-blue-500/20 text-blue-300" : "bg-orange-500/20 text-orange-300"}`}>{sub.type}</span>
                          <span className="flex-1 cursor-pointer hover:text-accent" onClick={() => startEditSub(sub)}>{sub.name}</span>
                          <button onClick={() => startEditSub(sub)} className="text-muted hover:text-foreground">✏️</button>
                        </>
                      )}
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
