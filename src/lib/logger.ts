import { getDb } from "./db";

export type LogLevel = "off" | "error" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = { off: 0, error: 1, info: 2, debug: 3 };

let cached: { level: LogLevel; ts: number } | null = null;

export function getLogLevel(): LogLevel {
  // Cache for 10s to avoid hitting DB on every log call
  if (cached && Date.now() - cached.ts < 10000) return cached.level;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'log_level'").get() as { value: string } | undefined;
    const level = (row?.value || "error") as LogLevel;
    cached = { level, ts: Date.now() };
    return level;
  } catch {
    return "error";
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] <= LEVELS[getLogLevel()];
}

export const log = {
  error: (...args: unknown[]) => { if (shouldLog("error")) console.error("[ERROR]", ...args); },
  info: (...args: unknown[]) => { if (shouldLog("info")) console.log("[INFO]", ...args); },
  debug: (...args: unknown[]) => { if (shouldLog("debug")) console.log("[DEBUG]", ...args); },
};
