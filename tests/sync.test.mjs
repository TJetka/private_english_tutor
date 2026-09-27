import test from "node:test";
import assert from "node:assert/strict";
import {
  syncProfile,
  validateBackup,
  validateSyncUrl,
} from "../src/persistence.mjs";
import { COURSE_ID, progress } from "../src/engine.mjs";
import { MemoryStore, attempt } from "./helpers.mjs";
const key = "aaaaaaaaaaaaaaaa",
  base = "https://sync.invalid";
const response = (data) => ({ ok: true, json: async () => data });
const empty = () => response({ schemaVersion: 2, events: [], cursor: "" });
test("S1/S5: pending answers upload before pull and get acknowledged", async () => {
  const store = new MemoryStore(),
    e = attempt();
  await store.add(key, [e]);
  const methods = [];
  await syncProfile(store, key, base, async (_url, opts) => {
    methods.push(opts.method || "GET");
    return opts.method === "POST"
      ? response({ schemaVersion: 2, accepted: [e.id] })
      : empty();
  });
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal((await store.load(key)).pending.length, 0);
  assert.ok((await store.load(key)).events[e.id]);
});
test("S2: different profile keys have isolated progress", async () => {
  const store = new MemoryStore();
  await store.add(key, [attempt()]);
  assert.deepEqual(await store.load("bbbbbbbbbbbbbbbb"), {
    events: {},
    pending: [],
  });
});
test("S3: answer during POST remains present and pending", async () => {
  const store = new MemoryStore(),
    first = attempt(),
    later = attempt();
  await store.add(key, [first]);
  await syncProfile(store, key, base, async (_url, opts) => {
    if (opts.method === "POST") {
      await store.add(key, [later]);
      return response({ schemaVersion: 2, accepted: [first.id] });
    }
    return empty();
  });
  const state = await store.load(key);
  assert.equal(Object.keys(state.events).length, 2);
  assert.deepEqual(state.pending, [later.id]);
});
test("S6: malformed JSON acknowledgement preserves pending data", async () => {
  const store = new MemoryStore(),
    e = attempt();
  await store.add(key, [e]);
  await assert.rejects(
    syncProfile(store, key, base, async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad JSON");
      },
    })),
  );
  assert.deepEqual((await store.load(key)).pending, [e.id]);
});
test("partial, duplicate or fabricated acknowledgements are rejected", async () => {
  for (const accepted of [[], ["fabricated"], ["duplicate", "duplicate"]]) {
    const store = new MemoryStore(),
      e = attempt();
    await store.add(key, [e]);
    await assert.rejects(
      syncProfile(store, key, base, async () =>
        response({ schemaVersion: 2, accepted }),
      ),
    );
    assert.deepEqual((await store.load(key)).pending, [e.id]);
  }
});
test("offline failure preserves queue for a later retry", async () => {
  const store = new MemoryStore(),
    e = attempt();
  await store.add(key, [e]);
  await assert.rejects(
    syncProfile(store, key, base, async () => {
      throw new Error("offline");
    }),
  );
  assert.ok((await store.load(key)).pending.includes(e.id));
  await syncProfile(store, key, base, async (_url, opts) =>
    opts.method === "POST"
      ? response({ schemaVersion: 2, accepted: [e.id] })
      : empty(),
  );
  assert.equal((await store.load(key)).pending.length, 0);
});
test("paged history merges without overwriting or double counting", async () => {
  const store = new MemoryStore(),
    a = attempt(),
    b = attempt();
  await store.add(key, [a], false);
  let page = 0;
  await syncProfile(store, key, base, async () =>
    response({
      schemaVersion: 2,
      events: page++ ? [b] : [a],
      cursor: page === 1 ? "next" : "",
    }),
  );
  const state = await store.load(key);
  assert.equal(progress(state.events).xp, 20);
  assert.equal(state.pending.length, 0);
});
test("large queues batch below the Worker free subrequest limit", async () => {
  const store = new MemoryStore();
  await store.add(
    key,
    Array.from({ length: 81 }, () => attempt()),
  );
  const sizes = [];
  await syncProfile(store, key, base, async (_url, opts) => {
    if (opts.method !== "POST") return empty();
    const { events } = JSON.parse(opts.body);
    sizes.push(events.length);
    return response({ schemaVersion: 2, accepted: events.map((e) => e.id) });
  });
  assert.deepEqual(sizes, [40, 40, 1]);
});
test("backup round-trip validates events and rejects duplicate records", () => {
  const e = attempt(),
    backup = {
      schemaVersion: 2,
      courseId: COURSE_ID,
      profileKey: key,
      events: [e],
    };
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(backup))), {
    [e.id]: e,
  });
  assert.throws(() => validateBackup({ ...backup, events: [e, e] }));
  assert.throws(() => validateBackup({ ...backup, profileKey: "wrong" }));
});
test("URL configuration supports disabling and rejects credentials or paths", () => {
  assert.equal(validateSyncUrl(""), "");
  assert.equal(validateSyncUrl(base + "/"), base);
  for (const url of [
    "http://sync.invalid",
    "https://user:pass@sync.invalid",
    "https://sync.invalid/p/key",
  ])
    assert.throws(() => validateSyncUrl(url));
});
