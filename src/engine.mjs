// Pure course and progress logic. Shared by the browser, validator and Worker tests.
export const APP_VERSION = "2.0.0-pilot.1";
export const COURSE_ID = "dk-junior-pilot";
export const INTERVALS = [1, 1, 3, 7, 14];
export const dayNumber = (day) =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const normalize = (text) =>
  String(text)
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.!?,]/g, "")
    .replace(/\s+/g, " ");
export const clone = (value) => JSON.parse(JSON.stringify(value));

export function validateEvent(e) {
  if (
    !e ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(e.id || "") ||
    e.courseId !== COURSE_ID ||
    !Number.isFinite(Date.parse(e.at)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.day || "") ||
    !Number.isFinite(dayNumber(e.day)) ||
    new Date(dayNumber(e.day) * 86400000).toISOString().slice(0, 10) !==
      e.day ||
    ["__proto__", "constructor", "prototype"].includes(e.id)
  )
    throw new Error("Invalid event identity/date");
  const types = ["intro", "attempt", "session", "plan", "review", "profile"];
  if (!types.includes(e.type)) throw new Error("Unknown event type");
  if (
    ["intro", "attempt"].includes(e.type) &&
    (!/^[a-z0-9-]{1,100}$/.test(e.itemId || "") ||
      !Number.isInteger(e.itemRevision) ||
      e.itemRevision < 1)
  )
    throw new Error("Invalid item");
  if (
    e.type === "attempt" &&
    (typeof e.correct !== "boolean" ||
      typeof e.assisted !== "boolean" ||
      !["en2pl", "pl2en", "listen", "spell", "gap", "order"].includes(e.kind))
  )
    throw new Error("Invalid attempt");
  if (
    ["attempt", "session"].includes(e.type) &&
    (!/^[a-zA-Z0-9_-]{8,100}$/.test(e.sessionId || "") ||
      !Number.isFinite(e.durationMs) ||
      e.durationMs < 0 ||
      e.durationMs > 86400000)
  )
    throw new Error("Invalid session");
  if (e.type === "session" && typeof e.completed !== "boolean")
    throw new Error("Invalid completion");
  if (
    e.type === "plan" &&
    (!Number.isInteger(e.week) ||
      e.week < 1 ||
      e.week > 52 ||
      !Number.isInteger(e.newPerDay) ||
      e.newPerDay < 0 ||
      e.newPerDay > 5 ||
      !Number.isInteger(e.maxExercises) ||
      e.maxExercises < 12 ||
      e.maxExercises > 20 ||
      !Array.isArray(e.focus) ||
      e.focus.length > 10 ||
      !e.focus.every((s) => /^[a-z0-9-]{1,100}$/.test(s)))
  )
    throw new Error("Invalid plan");
  if (
    e.type === "review" &&
    (typeof e.note !== "string" ||
      e.note.length > 1500 ||
      !["easy", "okay", "hard"].includes(e.rating))
  )
    throw new Error("Invalid review");
  if (
    e.type === "profile" &&
    (typeof e.name !== "string" || e.name.length > 30)
  )
    throw new Error("Invalid name");
  if (JSON.stringify(e).length > 5000) throw new Error("Event too large");
  return e;
}

export function unionEvents(a, b) {
  const out = { ...a };
  for (const e of Object.values(b)) {
    validateEvent(e);
    if (out[e.id] && JSON.stringify(out[e.id]) !== JSON.stringify(e))
      throw new Error("Conflicting event ID");
    out[e.id] = e;
  }
  return out;
}

export function progress(events, today = localDay()) {
  const result = {
    items: {},
    sessions: {},
    dates: [],
    xp: 0,
    name: "",
    plan: { week: 1, newPerDay: 4, maxExercises: 20, focus: [] },
    reviews: [],
  };
  const ordered = Object.values(events).sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
  for (const e of ordered) {
    if (e.type === "profile") result.name = e.name;
    if (e.type === "plan")
      result.plan = {
        week: e.week,
        newPerDay: e.newPerDay,
        maxExercises: e.maxExercises,
        focus: e.focus,
      };
    if (e.type === "review") result.reviews.push(e);
    if (e.type === "intro" || e.type === "attempt") {
      const r = (result.items[e.itemId] ||= {
        seen: false,
        firstDay: e.day,
        box: 0,
        due: 0,
        ok: 0,
        bad: 0,
        assisted: 0,
        delayedDays: [],
        lastCredit: null,
      });
      r.seen = true;
      if (e.type === "intro") r.due ||= dayNumber(e.day) + 1;
      if (e.type === "attempt") {
        if (e.assisted) r.assisted++;
        if (e.correct) {
          r.ok++;
          if (
            !e.assisted &&
            e.day > r.firstDay &&
            e.day !== r.lastCredit &&
            dayNumber(e.day) >= r.due
          ) {
            r.box = Math.min(4, r.box + 1);
            r.lastCredit = e.day;
            r.delayedDays.push(e.day);
            r.due = dayNumber(e.day) + INTERVALS[r.box];
          }
        } else {
          r.bad++;
          r.box = 0;
          r.lastCredit = e.day;
          r.due = dayNumber(e.day) + 1;
        }
        result.xp += e.correct ? 10 : 2;
        const session = (result.sessions[e.sessionId] ||= {
          id: e.sessionId,
          day: e.day,
          attempts: 0,
          right: 0,
          assisted: 0,
          durationMs: 0,
          completed: false,
        });
        session.attempts++;
        session.right += Number(e.correct);
        session.assisted += Number(e.assisted);
      }
    }
    if (e.type === "session") {
      const session = (result.sessions[e.sessionId] ||= {
        id: e.sessionId,
        day: e.day,
        attempts: 0,
        right: 0,
        assisted: 0,
        durationMs: 0,
      });
      session.completed = Boolean(session.completed || e.completed);
      session.durationMs = Math.max(session.durationMs, e.durationMs);
    }
  }
  result.dates = [
    ...new Set(
      Object.values(result.sessions)
        .filter((s) => s.completed)
        .map((s) => s.day),
    ),
  ].sort();
  result.due = Object.entries(result.items)
    .filter(([, r]) => r.due <= dayNumber(today))
    .map(([id]) => id);
  return result;
}

export function validateCourse(course) {
  if (
    course.courseId !== COURSE_ID ||
    !course.version ||
    !Array.isArray(course.weeks) ||
    !course.weeks.length ||
    course.weeks.length > 52 ||
    !Array.isArray(course.units)
  )
    throw new Error("Invalid course manifest");
  const ids = new Set();
  for (const unit of course.units) {
    if (!unit.id || !Array.isArray(unit.items) || !unit.items.length)
      throw new Error("Empty unit");
    for (const item of unit.items) {
      if (
        ids.has(item.id) ||
        !/^[a-z0-9-]+$/.test(item.id) ||
        !item.en ||
        !item.pl ||
        !course.skillNames?.[item.skill] ||
        !Number.isInteger(item.revision) ||
        !["word", "sentence"].includes(item.type)
      )
        throw new Error(`Invalid item: ${item.id}`);
      if (
        item.type === "sentence" &&
        (!item.gap ||
          item.gap.options.filter((v) => v === item.gap.a).length !== 1 ||
          new Set(item.gap.options).size !== item.gap.options.length ||
          !item.gap.q.includes("___"))
      )
        throw new Error(`Invalid gap: ${item.id}`);
      ids.add(item.id);
    }
  }
  for (const [index, week] of course.weeks.entries()) {
    if (
      week.id !== index + 1 ||
      !week.units.every((id) => course.units.some((u) => u.id === id)) ||
      week.daily.length !== 5 ||
      !week.parentBrief ||
      !week.speaking.length
    )
      throw new Error("Invalid weekly plan");
  }
  return course;
}

export function eligibleItems(course, week) {
  const unitIds = new Set(
    course.weeks.filter((w) => w.id <= week).flatMap((w) => w.units),
  );
  return course.units.filter((u) => unitIds.has(u.id)).flatMap((u) => u.items);
}

export function shuffled(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildSession(
  course,
  events,
  today = localDay(),
  random = Math.random,
  speech = true,
) {
  const p = progress(events, today),
    plan = p.plan;
  const week = course.weeks.find((w) => w.id === plan.week) || course.weeks[0];
  const pool = eligibleItems(course, week.id);
  const words = pool.filter((i) => i.type === "word"),
    sentences = pool.filter((i) => i.type === "sentence");
  const seen = (i) => Boolean(p.items[i.id]?.seen);
  const due = (i) => seen(i) && p.items[i.id].due <= dayNumber(today);
  const rank = (a, b) =>
    Number(plan.focus.includes(b.skill)) -
      Number(plan.focus.includes(a.skill)) ||
    (p.items[a.id]?.due || 0) - (p.items[b.id]?.due || 0) ||
    a.id.localeCompare(b.id);
  const task = (item, kind) => {
    if (item.type === "sentence")
      return {
        item,
        kind: "gap",
        prompt: item.gap.q,
        correct: item.gap.a,
        options: shuffled(item.gap.options, random),
      };
    const correct = kind === "en2pl" ? item.pl : item.en;
    const distractors = [
      ...new Set(
        words
          .filter((i) => i.id !== item.id)
          .map((i) => (kind === "en2pl" ? i.pl : i.en)),
      ),
    ].filter((v) => v !== correct);
    return {
      item,
      kind,
      prompt: kind === "en2pl" ? item.en : kind === "listen" ? "🔊" : item.pl,
      correct,
      options: shuffled(
        [correct, ...shuffled(distractors, random).slice(0, 3)],
        random,
      ),
    };
  };
  // Reserve four grammar slots before budgeting new vocabulary and overdue words.
  const grammar = [],
    selected = new Set();
  const current = course.units
    .filter((u) => week.units.includes(u.id))
    .flatMap((u) => u.items)
    .filter((i) => i.type === "sentence" && (!week.reviewOnly || seen(i)));
  const currentIds = new Set(current.map((i) => i.id));
  const olderDue = sentences
    .filter((i) => due(i) && !currentIds.has(i.id))
    .sort(rank)
    .slice(0, 2);
  const candidates = [
    ...olderDue,
    ...current.filter((i) => !seen(i)),
    ...current.filter(due).sort(rank),
    ...sentences.filter(due).sort(rank),
    ...shuffled(current.filter(seen), random),
  ];
  for (const item of candidates) {
    if (selected.has(item.id)) continue;
    const cost = seen(item) ? 1 : 2;
    if (grammar.length + cost > 4) continue;
    selected.add(item.id);
    if (!seen(item)) grammar.push({ kind: "learn", item });
    const ex = task(item, "gap");
    if (seen(item) && grammar.length % 2) {
      ex.kind = "order";
      ex.prompt = item.pl;
      ex.correct = item.en;
      ex.tokens = shuffled(item.en.replace(/[.!?]$/, "").split(" "), random);
    }
    grammar.push(ex);
    if (grammar.length === 4) break;
  }
  const introducedToday = new Set(
    Object.values(events)
      .filter(
        (e) =>
          e.type === "intro" &&
          e.day === today &&
          words.some((w) => w.id === e.itemId),
      )
      .map((e) => e.itemId),
  ).size;
  const overdue = words.filter(due).sort(rank);
  const limit =
    week.reviewOnly || overdue.length > 12
      ? 0
      : Math.max(0, plan.newPerDay - introducedToday);
  const newWords = words
    .filter((i) => !seen(i))
    .slice(
      0,
      Math.min(limit, Math.floor((plan.maxExercises - grammar.length) / 3)),
    );
  const intro = newWords.flatMap((item) => [
    { kind: "learn", item },
    task(item, "en2pl"),
  ]);
  const recall = newWords.map((item) => task(item, "pl2en"));
  const slots =
    plan.maxExercises - grammar.length - intro.length - recall.length;
  let typed = 0;
  const reviews = overdue
    .slice(0, slots)
    .map((item) =>
      task(
        item,
        p.items[item.id].box >= 2 && typed++ < 4
          ? "spell"
          : speech
            ? "listen"
            : "pl2en",
      ),
    );
  const used = new Set(
    [...newWords, ...overdue.slice(0, slots)].map((i) => i.id),
  );
  const target = Math.min(12, plan.maxExercises);
  for (const item of shuffled(
    words.filter((i) => seen(i) && !used.has(i.id)),
    random,
  )) {
    if (
      intro.length + recall.length + reviews.length + grammar.length >=
      target
    )
      break;
    reviews.push(task(item, "pl2en"));
  }
  // Review week practises introduced material; unseen backlog stays visible to the parent.
  if (week.reviewOnly && !intro.length && !reviews.length && !words.some(seen))
    return [];
  return [...intro, ...reviews, ...grammar, ...recall];
}

export function weeklyReport(course, events, today = localDay()) {
  const p = progress(events, today),
    items = eligibleItems(course, p.plan.week);
  const since = dayNumber(today) - 6;
  const recent = Object.values(events).filter(
    (e) => e.type === "attempt" && dayNumber(e.day) >= since && e.day <= today,
  );
  const sessions = Object.values(p.sessions).filter(
    (s) => dayNumber(s.day) >= since && s.day <= today,
  );
  const skills = [...new Set(items.map((i) => i.skill))].map((skill) => {
    const ids = new Set(
      items.filter((i) => i.skill === skill).map((i) => i.id),
    );
    const attempts = recent.filter((e) => ids.has(e.itemId));
    const unaided = attempts.filter((e) => !e.assisted);
    return {
      skill,
      attempts: attempts.length,
      unaided: unaided.length,
      correct: unaided.filter((e) => e.correct).length,
      helped: attempts.filter((e) => e.assisted).length,
      delayedItems: items.filter(
        (i) => ids.has(i.id) && (p.items[i.id]?.delayedDays.length || 0) >= 2,
      ).length,
    };
  });
  const focus = skills
    .filter((s) => s.unaided >= 5 && s.correct / s.unaided < 0.7)
    .map((s) => s.skill);
  const completed = sessions.filter((s) => s.completed);
  return {
    schemaVersion: 1,
    courseId: course.courseId,
    courseVersion: course.version,
    appVersion: APP_VERSION,
    generatedOn: today,
    plan: p.plan,
    periodDays: 7,
    completedSessions: completed.length,
    practiceDays: new Set(completed.map((s) => s.day)).size,
    incompleteSessions: sessions.filter((s) => !s.completed).length,
    sessionMinutes: completed.map((s) => Math.round(s.durationMs / 6000) / 10),
    recentAttempts: recent
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
      .map((e) => ({
        day: e.day,
        itemId: e.itemId,
        itemRevision: e.itemRevision,
        kind: e.kind,
        correct: e.correct,
        assisted: e.assisted,
      })),
    skills,
    items: items.map((i) => ({
      id: i.id,
      revision: i.revision,
      en: i.en,
      skill: i.skill,
      ...(p.items[i.id] || { seen: false, ok: 0, bad: 0, delayedDays: [] }),
    })),
    parentNotes: p.reviews
      .slice(-4)
      .map((e) => ({ day: e.day, rating: e.rating, note: e.note })),
    recommendation: {
      decision:
        recent.length < 15
          ? "collect-more-evidence"
          : focus.length
            ? "repeat-and-support"
            : "parent-check-before-next-week",
      focus,
      newPerDay: focus.length ? 2 : p.plan.newPerDay,
      reason:
        "Pilot heuristics, not a validated mastery test. Confirm with spoken recall and the child’s experience.",
    },
  };
}
