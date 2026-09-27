import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSession,
  progress,
  unionEvents,
  validateEvent,
  validateCourse,
  weeklyReport,
  normalize,
  dayNumber,
  eligibleItems,
} from "../src/engine.mjs";
import {
  loadCourse,
  event,
  attempt,
  mapEvents,
  seededRandom,
} from "./helpers.mjs";
const course = loadCourse(),
  today = "2026-09-28";
test("book mapping, identifiers and answer schemas are valid", () => {
  assert.equal(validateCourse(course), course);
  assert.deepEqual(
    course.units.map((u) => u.pages),
    [
      [10, 15],
      [16, 21],
      [22, 27],
    ],
  );
  assert.deepEqual(
    course.units.map((u) => u.items.filter((i) => i.type === "word").length),
    [15, 24, 17],
  );
  assert.equal(course.units.flatMap((u) => u.items).length, 80);
});
test("fresh session teaches before grading and retains later word recall", () => {
  const list = buildSession(course, {}, today, seededRandom());
  assert.ok(list.length <= 20 && list.length >= 12);
  const introduced = new Set();
  for (const ex of list) {
    if (ex.kind === "learn") introduced.add(ex.item.id);
    else assert.ok(introduced.has(ex.item.id));
  }
  for (const id of introduced) {
    if (course.units[0].items.find((i) => i.id === id).type === "word")
      assert.equal(list.filter((e) => e.item.id === id).length, 3);
  }
  assert.ok(list.filter((e) => e.item.type === "sentence").length >= 4);
});
test("L1: crowded review retains grammar and previous-unit sentences", () => {
  const plan = event("plan", {
    week: 3,
    newPerDay: 4,
    maxExercises: 20,
    focus: [],
  });
  const intros = course.units
    .flatMap((u) => u.items)
    .map((i) =>
      event("intro", { itemId: i.id, itemRevision: 1, day: "2026-09-20" }),
    );
  const list = buildSession(
    course,
    mapEvents([plan, ...intros]),
    today,
    seededRandom(),
  );
  assert.equal(list.length, 20);
  assert.equal(list.filter((e) => e.item.type === "sentence").length, 4);
  assert.ok(
    list.some(
      (e) => e.item.type === "sentence" && e.item.id.startsWith("dk-u01"),
    ),
  );
});
test("L2: same-day success never promotes or advances the plan", () => {
  const events = mapEvents([
    event("intro", { itemId: "dk-u01-hello", itemRevision: 1 }),
    ...Array.from({ length: 30 }, () => attempt()),
  ]);
  const p = progress(events, today);
  assert.equal(p.items["dk-u01-hello"].box, 0);
  assert.equal(p.plan.week, 1);
});
test("only unaided due recall on another date advances once per day", () => {
  const events = mapEvents([
    event("intro", {
      itemId: "dk-u01-hello",
      itemRevision: 1,
      at: "2026-09-25T10:00:00Z",
      day: "2026-09-25",
    }),
    attempt({ at: "2026-09-26T10:00:00Z", day: "2026-09-26", assisted: true }),
    attempt({ at: "2026-09-27T10:00:00Z", day: "2026-09-27" }),
    attempt({ at: "2026-09-27T11:00:00Z", day: "2026-09-27" }),
  ]);
  const r = progress(events, today).items["dk-u01-hello"];
  assert.equal(r.box, 1);
  assert.deepEqual(r.delayedDays, ["2026-09-27"]);
  assert.equal(r.assisted, 1);
});
test("an error schedules tomorrow; same-day correction cannot mask it", () => {
  const events = mapEvents([
    attempt({ correct: false, at: "2026-09-28T10:00:00Z" }),
    attempt({ at: "2026-09-28T11:00:00Z" }),
  ]);
  const r = progress(events, today).items["dk-u01-hello"];
  assert.equal(r.box, 0);
  assert.equal(r.due, dayNumber(today) + 1);
});
test("daily new word cap applies across repeated rounds", () => {
  const intros = course.units[0].items
    .filter((i) => i.type === "word")
    .slice(0, 4)
    .map((i) => event("intro", { itemId: i.id, itemRevision: 1 }));
  assert.equal(
    buildSession(course, mapEvents(intros), today, seededRandom()).filter(
      (e) => e.kind === "learn" && e.item.type === "word",
    ).length,
    0,
  );
});
test("review week keeps all three units eligible without new words", () => {
  const events = mapEvents([
    event("plan", { week: 4, newPerDay: 4, maxExercises: 20, focus: [] }),
    ...course.units
      .flatMap((u) => u.items)
      .map((i) =>
        event("intro", { itemId: i.id, itemRevision: 1, day: "2026-09-20" }),
      ),
  ]);
  assert.equal(
    buildSession(course, events, today, seededRandom()).filter(
      (e) => e.kind === "learn",
    ).length,
    0,
  );
  assert.equal(eligibleItems(course, 4).length, 80);
});
test("review week with sparse history does not introduce unseen sentences", () => {
  const events = mapEvents([
    event("plan", { week: 4, newPerDay: 4, maxExercises: 20, focus: [] }),
    event("intro", {
      itemId: "dk-u01-hello",
      itemRevision: 1,
      day: "2026-09-20",
    }),
  ]);
  assert.ok(
    buildSession(course, events, today, seededRandom()).every(
      (e) => e.kind !== "learn" && e.item.id === "dk-u01-hello",
    ),
  );
});
test("S4: event union is lossless, idempotent and order independent", () => {
  const a = mapEvents([attempt()]),
    b = mapEvents([attempt({ correct: false })]),
    ab = unionEvents(a, b),
    ba = unionEvents(b, a);
  assert.deepEqual(progress(ab, today), progress(ba, today));
  assert.deepEqual(unionEvents(ab, a), ab);
  assert.equal(progress(ab, today).xp, 12);
  assert.equal(progress(ab, today).items["dk-u01-hello"].bad, 1);
});
test("conflicting event IDs are rejected", () => {
  const e = attempt();
  assert.throws(() =>
    unionEvents(mapEvents([e]), mapEvents([{ ...e, correct: false }])),
  );
});
test("sessions differ from practice days and partial work is reportable", () => {
  const events = mapEvents([
    attempt(),
    event("session", {
      sessionId: "session-00000001",
      completed: true,
      durationMs: 600000,
    }),
    attempt({ sessionId: "session-00000002" }),
    event("session", {
      sessionId: "session-00000002",
      completed: true,
      durationMs: 300000,
    }),
    attempt({ sessionId: "session-00000003" }),
  ]);
  const report = weeklyReport(course, events, today);
  assert.equal(report.completedSessions, 2);
  assert.equal(report.practiceDays, 1);
  assert.equal(report.incompleteSessions, 1);
  assert.deepEqual(report.sessionMinutes, [10, 5]);
  assert.equal(report.recommendation.decision, "collect-more-evidence");
  assert.ok(!JSON.stringify(report).includes("profileKey"));
});
test("weekly heuristic flags sampled weak skills without advancing", () => {
  const report = weeklyReport(
    course,
    mapEvents(Array.from({ length: 16 }, () => attempt({ correct: false }))),
    today,
  );
  assert.deepEqual(report.recommendation.focus, ["greetings"]);
  assert.equal(report.plan.week, 1);
});
test("review report preserves exercise types and assistance within its date window", () => {
  const report = weeklyReport(
    course,
    mapEvents([
      attempt({ day: "2026-09-20", at: "2026-09-20T10:00:00Z" }),
      attempt({
        kind: "spell",
        assisted: true,
        day: "2026-09-27",
        at: "2026-09-27T10:00:00Z",
      }),
      attempt({ kind: "listen", correct: false }),
      attempt({ day: "2026-09-29", at: "2026-09-29T10:00:00Z" }),
    ]),
    today,
  );
  assert.deepEqual(
    report.recentAttempts.map(({ kind, correct, assisted }) => ({
      kind,
      correct,
      assisted,
    })),
    [
      { kind: "spell", correct: true, assisted: true },
      { kind: "listen", correct: false, assisted: false },
    ],
  );
  assert.ok(
    report.recentAttempts.every(
      (e) => e.itemRevision === 1 && e.itemId === "dk-u01-hello",
    ),
  );
  assert.ok(report.recentAttempts.every((e) => !("sessionId" in e)));
});
test("no speech support means visual recall instead of listening", () => {
  const events = mapEvents(
    course.units[0].items.map((i) =>
      event("intro", { itemId: i.id, itemRevision: 1, day: "2026-09-20" }),
    ),
  );
  assert.ok(
    buildSession(course, events, today, seededRandom(), false).every(
      (e) => e.kind !== "listen",
    ),
  );
});
test("normalization accepts curly apostrophes and harmless punctuation", () =>
  assert.equal(normalize(" Let’s  play! "), normalize("Let's play.")));
test("malformed events and invalid calendar dates fail validation", () => {
  assert.throws(() => validateEvent({ ...attempt(), correct: "yes" }));
  assert.throws(() => validateEvent({ ...attempt(), day: "2026-02-31" }));
  assert.throws(() => validateEvent({ ...attempt(), id: "__proto__" }));
});
test("smoke: tiny round produces reloadable progress and parent report", () => {
  const list = buildSession(course, {}, today, seededRandom()),
    events = {};
  for (const ex of list) {
    const e =
      ex.kind === "learn"
        ? event("intro", { itemId: ex.item.id, itemRevision: 1 })
        : attempt({ itemId: ex.item.id });
    events[e.id] = e;
  }
  const end = event("session", {
    sessionId: "session-00000001",
    completed: true,
    durationMs: 480000,
  });
  events[end.id] = end;
  const report = weeklyReport(
    course,
    JSON.parse(JSON.stringify(events)),
    today,
  );
  assert.equal(report.completedSessions, 1);
  assert.equal(report.practiceDays, 1);
  assert.ok(report.items.some((i) => i.seen));
  assert.equal(
    progress(events, today).xp,
    list.filter((e) => e.kind !== "learn").length * 10,
  );
});
