import { validateEvent } from "../src/engine.mjs";
import legacyWorker from "../scripts/worker.js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });

// Extend the existing service; v2 events never share legacy shard/backup keys.
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return json({
        schemaVersion: 2,
        service: "english-trainer-pilot",
        storageConfigured: Boolean(env.PROGRESS),
      });
    const match = url.pathname.match(/^\/v2\/p\/([a-z2-9]{12,32})$/);
    if (!match) return legacyWorker.fetch(request, env);
    if (!env.PROGRESS)
      return json({ error: "PROGRESS binding is missing" }, 503);
    const prefix = `v2:${match[1]}:`;
    try {
      if (request.method === "POST") {
        if (Number(request.headers.get("Content-Length")) > 300000)
          return json({ error: "Payload too large" }, 413);
        const body = await request.text();
        if (body.length > 300000)
          return json({ error: "Payload too large" }, 413);
        let data;
        try {
          data = JSON.parse(body);
          if (
            !Array.isArray(data.events) ||
            data.events.length < 1 ||
            data.events.length > 40
          )
            throw new Error();
          data.events.forEach(validateEvent);
        } catch {
          return json({ error: "Invalid events" }, 400);
        }
        if (new Set(data.events.map((e) => e.id)).size !== data.events.length)
          return json({ error: "Duplicate event IDs" }, 400);
        const keys = data.events.map((e) => prefix + e.id);
        const existing = await env.PROGRESS.get(keys, "json");
        for (const event of data.events) {
          const saved = existing.get(prefix + event.id);
          if (saved && JSON.stringify(saved) !== JSON.stringify(event))
            return json({ error: "Event ID conflict" }, 409);
        }
        // Immutable per-event keys: devices do not race over an aggregate profile.
        // A partial write failure is safe to retry with the same IDs.
        await Promise.all(
          data.events
            .filter((e) => !existing.get(prefix + e.id))
            .map((e) => env.PROGRESS.put(prefix + e.id, JSON.stringify(e))),
        );
        return json({
          schemaVersion: 2,
          accepted: data.events.map((e) => e.id),
        });
      }
      if (request.method === "GET") {
        const cursor = url.searchParams.get("cursor") || undefined;
        if (cursor && cursor.length > 4096)
          return json({ error: "Invalid cursor" }, 400);
        const listing = await env.PROGRESS.list({
          prefix,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        const values = listing.keys.length
          ? await env.PROGRESS.get(
              listing.keys.map((k) => k.name),
              "json",
            )
          : new Map();
        return json({
          schemaVersion: 2,
          events: [...values.values()].filter(Boolean),
          cursor: listing.list_complete ? "" : listing.cursor,
        });
      }
      return json({ error: "Method not allowed" }, 405);
    } catch {
      // Do not put learner keys or practice data into logs/error bodies.
      return json(
        { error: "Storage request failed; retry with the same event IDs" },
        503,
      );
    }
  },
};
