import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";

// Cache clipboard reads to avoid shelling out on every poll
let cachedText = "";
let cachedAt = 0;
const CACHE_MS = 800;

function readClipboard(): string {
  const now = Date.now();
  if (now - cachedAt < CACHE_MS) return cachedText;
  try {
    const platform = os.platform();
    let text = "";
    if (platform === "win32") {
      text = execSync("powershell -command Get-Clipboard", { encoding: "utf-8", timeout: 2000 }).trim();
    } else if (platform === "darwin") {
      text = execSync("pbpaste", { encoding: "utf-8", timeout: 1000 }).trim();
    } else {
      text = execSync("xclip -selection clipboard -o", { encoding: "utf-8", timeout: 1000 }).trim();
    }
    cachedText = text;
    cachedAt = now;
    return text;
  } catch {
    return cachedText;
  }
}

// GET /api/clipboard — read system clipboard server-side (works when browser unfocused)
export async function GET() {
  return NextResponse.json({ text: readClipboard() });
}
