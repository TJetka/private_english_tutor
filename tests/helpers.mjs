import fs from "node:fs";
import { COURSE_ID, validateEvent, unionEvents } from "../src/engine.mjs";
export function loadCourse() {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../content/pilot.json", import.meta.url)),
  );
  return {
    ...manifest,
    units: manifest.unitFiles.map((file) =>
      JSON.parse(
        fs.readFileSync(new URL("../content/" + file, import.meta.url)),
      ),
    ),
  };
}
let counter = 0;
export function event(type, fields = {}) {
  counter++;
  return {
    id: `event-${String(counter).padStart(8, "0")}`,
    type,
    courseId: COURSE_ID,
    courseVersion: "test",
    appVersion: "test",
    at: `2026-09-28T12:00:${String(counter % 60).padStart(2, "0")}.000Z`,
    day: "2026-09-28",
    ...fields,
  };
}
export function attempt(fields = {}) {
  return event("attempt", {
    itemId: "dk-u01-hello",
    itemRevision: 1,
    correct: true,
    assisted: false,
    kind: "pl2en",
    sessionId: "session-00000001",
    durationMs: 1500,
    ...fields,
  });
}
export const mapEvents = (list) =>
  Object.fromEntries(list.map((e) => [e.id, e]));
export function seededRandom(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
export class MemoryStore {
  constructor() {
    this.profiles = new Map();
  }
  async load(key) {
    return structuredClone(
      this.profiles.get(key) || { events: {}, pending: [] },
    );
  }
  async add(key, list, pending = true) {
    list.forEach(validateEvent);
    const row = await this.load(key);
    row.events = unionEvents(row.events, mapEvents(list));
    if (pending)
      row.pending = [...new Set([...row.pending, ...list.map((e) => e.id)])];
    this.profiles.set(key, row);
  }
  async acknowledge(key, ids) {
    const row = await this.load(key);
    row.pending = row.pending.filter((id) => !ids.includes(id));
    this.profiles.set(key, row);
  }
}
