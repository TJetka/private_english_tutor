/* =====================================================================
   english-trainer sync worker
   Cloudflare Worker + KV. No auth: the unguessable key IS the credential.

   Routes
     GET    /p/:key           -> the saved progress JSON
     GET    /p/:key/report    -> plain-text summary (this is the URL you paste to me)
     PUT    /p/:key           -> save progress (validated)
     GET    /b/:key           -> list available backup slots
     GET    /b/:key/:slot     -> read one backup
     PUT    /b/:key/:slot     -> promote a backup back to live (recovery)

   Binding required: KV namespace bound as  PROGRESS
   ===================================================================== */

const MAX_BYTES   = 65536;                 // a full year of progress is ~15 KB
const KEY_RE      = /^[a-z2-9]{12,32}$/;   // matches the key the app generates
const DEV_RE      = /^[a-z2-9]{4,12}$/;    // per-device shard id
const BACKUP_SLOTS = 5;
const BACKUP_TTL  = 60 * 60 * 24 * 120;    // 120 days

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });

const text = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });

/* ---------- validation ----------
   The realistic threat is not a stranger, it is a bug or a half-loaded page
   overwriting months of work with an almost-empty object. So: never accept a
   lower revision, and never accept a save that lost most of its items. */
function validate(inc) {
  if (!inc || typeof inc !== "object" || Array.isArray(inc)) return "not an object";
  if (!inc.items || typeof inc.items !== "object" || Array.isArray(inc.items)) return "missing items";
  if (Object.keys(inc.items).length > 5000) return "too many items";
  if (inc.dates && !Array.isArray(inc.dates)) return "dates not an array";
  if (inc.rev !== undefined && typeof inc.rev !== "number") return "rev not a number";
  if (inc.dev !== undefined && inc.dev !== null && typeof inc.dev !== "string") return "dev not a string";
  for (const [id, r] of Object.entries(inc.items)) {
    if (id.length > 64) return "item id too long";
    if (!r || typeof r !== "object") return "bad item " + id;
    if (typeof r.box !== "number" || r.box < 0 || r.box > 50) return "bad box on " + id;
  }
  return null;
}

/* ---------- merge ----------
   This must live on the server, not only on the client. A client that pulled,
   then worked offline while another device pushed, arrives with a HIGHER revision
   but STALE content. Rejecting only lower revisions lets it clobber the other
   device's sessions. Merging every write makes ordering irrelevant. */
function mergeStates(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = {
    name: a.name || b.name || "",
    key: a.key || b.key || null,
    started: (a.started && b.started) ? (a.started < b.started ? a.started : b.started) : (a.started || b.started),
    xp: Math.max(a.xp || 0, b.xp || 0),
    best: Math.max(a.best || 0, b.best || 0),
    streak: Math.max(a.streak || 0, b.streak || 0),
    week: Math.max(a.week || 1, b.week || 1),
    badges: Array.from(new Set([...(a.badges || []), ...(b.badges || [])])),
    dates: Array.from(new Set([...(a.dates || []), ...(b.dates || [])])).sort(),
    rev: Math.max(a.rev || 0, b.rev || 0) + 1,
    items: {}
  };
  out.last = out.dates.length ? out.dates[out.dates.length - 1] : null;
  const ids = new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})]);
  for (const id of ids) {
    const x = (a.items || {})[id], y = (b.items || {})[id];
    if (!x || !y) { out.items[id] = x || y; continue; }
    const ax = (x.ok || 0) + (x.bad || 0), ay = (y.ok || 0) + (y.bad || 0);
    const w = ax >= ay ? x : y;                    // more attempts = more recently practised
    out.items[id] = { ...w, seen: !!(x.seen || y.seen) };
  }
  return out;
}

function report(s) {
  const items = s.items || {};
  const ids = Object.keys(items);
  const boxes = {};
  ids.forEach(id => { const b = items[id].box || 0; boxes[b] = (boxes[b] || 0) + 1; });

  const attempts = ids.reduce((n, id) => n + (items[id].ok || 0) + (items[id].bad || 0), 0);
  const hits     = ids.reduce((n, id) => n + (items[id].ok || 0), 0);

  const weak = ids
    .filter(id => (items[id].bad || 0) >= 2 && (items[id].box || 0) < 2)
    .sort((a, b) => (items[b].bad || 0) - (items[a].bad || 0));

  const solid = ids.filter(id => (items[id].box || 0) >= 3);
  const dates = (s.dates || []).slice().sort();

  const L = [];
  L.push("ENGLISH TRAINER / PROGRESS REPORT");
  L.push("=================================");
  L.push(`learner        ${s.name || "(no name)"}`);
  L.push(`started        ${s.started || "?"}`);
  L.push(`current week   ${s.week ?? "?"}`);
  L.push(`sessions       ${dates.length}`);
  L.push(`streak         ${s.streak ?? 0}   (best ${s.best ?? 0})`);
  L.push(`points         ${s.xp ?? 0}`);
  L.push(`revision       ${s.rev ?? 0}`);
  L.push(`badges         ${(s.badges || []).join(", ") || "none"}`);
  L.push("");
  L.push(`accuracy       ${attempts ? Math.round(hits / attempts * 100) : 0}%  (${hits}/${attempts} attempts)`);
  L.push(`items tracked  ${ids.length}`);
  L.push(`solid (box3+)  ${solid.length}`);
  L.push("");
  L.push("LEITNER DISTRIBUTION");
  Object.keys(boxes).sort((a, b) => a - b).forEach(b =>
    L.push(`  box ${b}  ${String(boxes[b]).padStart(3)}  ${"#".repeat(Math.min(boxes[b], 50))}`));
  L.push("");
  L.push("STRUGGLING (bad>=2, still below box 2)");
  if (!weak.length) L.push("  none");
  weak.forEach(id => L.push(`  ${id.padEnd(20)} ${items[id].ok || 0} right / ${items[id].bad || 0} wrong`));
  L.push("");
  L.push("LAST 14 SESSIONS");
  L.push("  " + (dates.slice(-14).join("  ") || "none"));
  L.push("");
  L.push("ALL ITEMS  (id : box : right/wrong)");
  ids.sort((a, b) => (items[a].box || 0) - (items[b].box || 0))
     .forEach(id => L.push(`  ${id.padEnd(20)} b${items[id].box || 0}  ${items[id].ok || 0}/${items[id].bad || 0}`));
  return L.join("\n");
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.PROGRESS) return json({ error: "KV namespace PROGRESS is not bound to this worker" }, 500);

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    /* ---- progress ----
       Sharded per device. KV has no transactions, so if two devices pushed to one
       shared key they would both read the old state, merge separately, and the
       second write would erase the first. Each device owns its own key instead, so
       writers never collide, and a read merges the shards. */
    const p = path.match(/^\/p\/([^/]+)(\/report)?$/);
    if (p) {
      const key = p[1];
      if (!KEY_RE.test(key)) return json({ error: "bad key format" }, 400);

      const shards = async () => {
        const ls = await env.PROGRESS.list({ prefix: `d:${key}:` });
        const out = [];
        for (const k of ls.keys) {
          const raw = await env.PROGRESS.get(k.name);
          if (!raw) continue;
          try { out.push(JSON.parse(raw)); } catch {}
        }
        return out;
      };
      const merged = async () => (await shards()).reduce((a, b) => mergeStates(a, b), null);

      if (req.method === "GET") {
        const m = await merged();
        if (!m) return p[2] ? text("no progress saved under this key yet\n", 404)
                            : json({ error: "empty" }, 404);
        if (p[2]) return text(report(m));
        return json(m);
      }

      if (req.method === "PUT") {
        const body = await req.text();
        if (body.length > MAX_BYTES) return json({ error: "payload too large", bytes: body.length }, 413);

        let inc;
        try { inc = JSON.parse(body); } catch { return json({ error: "invalid json" }, 400); }

        const bad = validate(inc);
        if (bad) return json({ error: "rejected: " + bad }, 400);

        const dev = DEV_RE.test(inc.dev || "") ? inc.dev : "default";
        // mode=replace is the deliberate destructive path: parent-initiated reset or
        // restore from backup. It clears every shard first. Merge is skipped, not the backup.
        const replace = url.searchParams.get("mode") === "replace";

        const before = await merged();
        if (before) {
          if (!replace) {
            const nNew = Object.keys(inc.items).length;
            const nOld = Object.keys(before.items || {}).length;
            if (nOld >= 8 && nNew < nOld * 0.5)
              return json({ error: "refused: would discard most items", serverItems: nOld, yourItems: nNew }, 409);
          }
          const slot = (before.rev || 0) % BACKUP_SLOTS;
          await env.PROGRESS.put(`b:${key}:${slot}`, JSON.stringify(before), { expirationTtl: BACKUP_TTL });
        }

        if (replace) {
          const ls = await env.PROGRESS.list({ prefix: `d:${key}:` });
          for (const k of ls.keys) await env.PROGRESS.delete(k.name);
        }

        inc.syncedAt = new Date().toISOString();
        await env.PROGRESS.put(`d:${key}:${dev}`, JSON.stringify(inc));

        const after = await merged();
        return json({ ok: true, rev: after ? after.rev : 0, shards: (await shards()).length,
                      merged: !replace && !!before, state: after });
      }

      return json({ error: "method not allowed" }, 405);
    }

    /* ---- backups ---- */
    const b = path.match(/^\/b\/([^/]+)(?:\/(\d))?$/);
    if (b) {
      const key = b[1];
      if (!KEY_RE.test(key)) return json({ error: "bad key format" }, 400);

      if (b[2] === undefined) {
        const out = [];
        for (let i = 0; i < BACKUP_SLOTS; i++) {
          const raw = await env.PROGRESS.get(`b:${key}:${i}`);
          if (!raw) { out.push({ slot: i, empty: true }); continue; }
          let o = {}; try { o = JSON.parse(raw); } catch {}
          out.push({ slot: i, rev: o.rev ?? null, sessions: (o.dates || []).length,
                     items: Object.keys(o.items || {}).length, syncedAt: o.syncedAt ?? null });
        }
        return json({ key, slots: out });
      }

      const slotKey = `b:${key}:${b[2]}`;
      if (req.method === "GET") {
        const raw = await env.PROGRESS.get(slotKey);
        if (!raw) return json({ error: "empty slot" }, 404);
        return new Response(raw, { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
      }
      if (req.method === "PUT") {           // promote a backup back to live
        const raw = await env.PROGRESS.get(slotKey);
        if (!raw) return json({ error: "empty slot" }, 404);
        const o = JSON.parse(raw);
        // Clear every shard, then write the backup as the single surviving one.
        const ls = await env.PROGRESS.list({ prefix: `d:${key}:` });
        let maxRev = 0;
        for (const k of ls.keys) {
          const r = await env.PROGRESS.get(k.name);
          if (r) { try { maxRev = Math.max(maxRev, JSON.parse(r).rev || 0); } catch {} }
          await env.PROGRESS.delete(k.name);
        }
        o.rev = maxRev + 1;                 // outrank everything it replaced
        o.restoredAt = new Date().toISOString();
        await env.PROGRESS.put(`d:${key}:restored`, JSON.stringify(o));
        return json({ ok: true, restored: true, rev: o.rev });
      }
      return json({ error: "method not allowed" }, 405);
    }

    return text(
      "english-trainer sync worker\n\n" +
      "GET  /p/:key         progress json\n" +
      "GET  /p/:key/report  readable summary\n" +
      "PUT  /p/:key         save progress\n" +
      "GET  /b/:key         list backups\n" +
      "GET  /b/:key/:slot   read a backup\n" +
      "PUT  /b/:key/:slot   restore a backup\n", 404);
  }
};
