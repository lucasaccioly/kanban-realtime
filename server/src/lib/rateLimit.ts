import type { RequestHandler } from "express";
import { HttpError } from "../errors.js";

type Entry = { count: number; resetAt: number };
// shortcut: in-memory counters, fine for one server process; move to Redis if it ever runs on several instances.
const limiters: Map<string, Entry>[] = [];

export function rateLimit({ windowMs, max }: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, Entry>();
  limiters.push(hits);
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    next(entry.count > max ? new HttpError(429, "Muitas tentativas, tente mais tarde") : undefined);
  };
}

export function resetRateLimits() {
  for (const hits of limiters) hits.clear();
}
