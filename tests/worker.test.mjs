import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.mjs";
import { attempt } from "./helpers.mjs";
const endpoint = "https://worker.invalid/v2/p/aaaaaaaaaaaaaaaa";
class KV {
  constructor() {
    this.values = new Map();
    this.writes = 0;
  }
  async get(keys) {
    if (typeof keys === "string") return this.values.get(keys) ?? null;
    return new Map(
      keys.map((k) => [
        k,
        this.values.has(k) ? JSON.parse(this.values.get(k)) : null,
      ]),
    );
  }
  async put(key, value) {
    this.writes++;
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list({ prefix, limit = 1000, cursor }) {
    const keys = [...this.values.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
    const offset = Number(cursor || 0);
    return {
      keys: keys.slice(offset, offset + limit).map((name) => ({ name })),
      list_complete: keys.length <= offset + limit,
      cursor: String(offset + limit),
    };
  }
}
const post = (events) =>
  new Request(endpoint, {
    method: "POST",
    body: JSON.stringify({ events }),
    headers: { "Content-Type": "application/json" },
  });
test("POST/GET smoke with isolated KV preserves events and CORS", async () => {
  const kv = new KV(),
    e = attempt(),
    write = await worker.fetch(post([e]), { PROGRESS: kv });
  assert.equal(write.status, 200);
  assert.deepEqual((await write.json()).accepted, [e.id]);
  const read = await worker.fetch(new Request(endpoint), {
    PROGRESS: kv,
  });
  assert.deepEqual((await read.json()).events, [e]);
  assert.equal(read.headers.get("Access-Control-Allow-Origin"), "*");
});
test("idempotent retry does not write the event again", async () => {
  const kv = new KV(),
    e = attempt();
  await worker.fetch(post([e]), { PROGRESS: kv });
  await worker.fetch(post([e]), { PROGRESS: kv });
  assert.equal(kv.writes, 1);
});
test("concurrent device events preserve both records", async () => {
  const kv = new KV(),
    a = attempt(),
    b = attempt({ correct: false });
  await Promise.all([
    worker.fetch(post([a]), { PROGRESS: kv }),
    worker.fetch(post([b]), { PROGRESS: kv }),
  ]);
  assert.equal(
    (await (await worker.fetch(new Request(endpoint), { PROGRESS: kv })).json())
      .events.length,
    2,
  );
});
test("conflicts or malformed events cannot overwrite prior attempts", async () => {
  const kv = new KV(),
    e = attempt();
  await worker.fetch(post([e]), { PROGRESS: kv });
  assert.equal(
    (
      await worker.fetch(post([{ ...e, correct: false }]), {
        PROGRESS: kv,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await worker.fetch(post([{ ...e, correct: "yes" }]), {
        PROGRESS: kv,
      })
    ).status,
    400,
  );
  assert.equal(kv.writes, 1);
});
test("missing binding fails explicitly and OPTIONS is supported", async () => {
  assert.equal((await worker.fetch(new Request(endpoint), {})).status, 503);
  const r = await worker.fetch(
    new Request(endpoint, { method: "OPTIONS" }),
    {},
  );
  assert.equal(r.status, 204);
  assert.ok(r.headers.get("Access-Control-Allow-Methods").includes("POST"));
});
test("storage failure never acknowledges a partial batch as complete", async () => {
  const kv = new KV();
  kv.put = async () => {
    throw new Error("quota");
  };
  assert.equal(
    (await worker.fetch(post([attempt()]), { PROGRESS: kv })).status,
    503,
  );
});
test("reads do not include another learner profile", async () => {
  const kv = new KV();
  await worker.fetch(post([attempt()]), { PROGRESS: kv });
  const r = await worker.fetch(
    new Request(endpoint.replace("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb")),
    { PROGRESS: kv },
  );
  assert.deepEqual((await r.json()).events, []);
});
test("legacy progress, reports and backups continue through the same service", async () => {
  const kv = new KV(),
    env = { PROGRESS: kv };
  const legacyUrl = endpoint.replace("/v2", "");
  const snapshot = {
    name: "Demo",
    items: { hello: { box: 1, ok: 2, bad: 0 } },
    dev: "deviceaa",
    dates: ["2026-09-27"],
    rev: 1,
    xp: 20,
  };
  const put = () =>
    worker.fetch(
      new Request(legacyUrl, { method: "PUT", body: JSON.stringify(snapshot) }),
      env,
    );
  assert.equal((await put()).status, 200);
  assert.equal((await put()).status, 200);
  const saved = await (await worker.fetch(new Request(legacyUrl), env)).json();
  assert.equal(saved.items.hello.ok, 2);
  const report = await worker.fetch(new Request(legacyUrl + "/report"), env);
  assert.equal(report.status, 200);
  assert.match(await report.text(), /PROGRESS REPORT/);
  const backups = await (
    await worker.fetch(new Request(legacyUrl.replace("/p/", "/b/")), env)
  ).json();
  assert.ok(backups.slots.some((s) => !s.empty));
  const cors = await worker.fetch(
    new Request(legacyUrl, { method: "OPTIONS" }),
    env,
  );
  assert.ok(cors.headers.get("Access-Control-Allow-Methods").includes("PUT"));
});
test("v2 reads and writes leave every legacy shard and backup unchanged", async () => {
  const kv = new KV(),
    env = { PROGRESS: kv };
  const oldKeys = ["d:aaaaaaaaaaaaaaaa:deviceaa", "b:aaaaaaaaaaaaaaaa:0"];
  for (const key of oldKeys)
    kv.values.set(
      key,
      JSON.stringify({ items: { hello: { box: 1 } }, rev: 1 }),
    );
  const before = oldKeys.map((key) => kv.values.get(key));
  const e = attempt();
  await worker.fetch(post([e]), env);
  assert.deepEqual(
    (await (await worker.fetch(new Request(endpoint), env)).json()).events,
    [e],
  );
  assert.deepEqual(
    oldKeys.map((key) => kv.values.get(key)),
    before,
  );
});
test("legacy backup restore never deletes pilot events in the shared namespace", async () => {
  const kv = new KV(),
    env = { PROGRESS: kv },
    e = attempt();
  await worker.fetch(post([e]), env);
  const snapshot = JSON.stringify({ items: { hello: { box: 1 } }, rev: 1 });
  kv.values.set("d:aaaaaaaaaaaaaaaa:deviceaa", snapshot);
  kv.values.set("b:aaaaaaaaaaaaaaaa:0", snapshot);
  const restoreUrl = endpoint.replace("/v2/p/", "/b/") + "/0";
  assert.equal(
    (await worker.fetch(new Request(restoreUrl, { method: "PUT" }), env))
      .status,
    200,
  );
  assert.deepEqual(
    (await (await worker.fetch(new Request(endpoint), env)).json()).events,
    [e],
  );
});
