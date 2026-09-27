import {
  APP_VERSION,
  COURSE_ID,
  localDay,
  progress,
  buildSession,
  weeklyReport,
  normalize,
  validateCourse,
  eligibleItems,
} from "./engine.mjs";
import {
  openDatabase,
  syncProfile,
  validateBackup,
  validateSyncUrl,
} from "./persistence.mjs";

const app = document.getElementById("app");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () => crypto.randomUUID();
const newKey = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (b) => "abcdefghijkmnopqrstuvwxyz23456789"[b % 32],
  ).join("");
let skillNames = {};
let store,
  course,
  config,
  key,
  events = {},
  pending = [],
  screen = "home",
  round = null,
  notice = "",
  syncBusy = false,
  syncAgain = false,
  syncError = "",
  syncAt = null,
  syncTimer;
let channel;
const stats = () => progress(events);
const activeWeek = () =>
  course.weeks.find((w) => w.id === stats().plan.week) || course.weeks[0];
const sub = (text) =>
  String(text ?? "").replaceAll("{{name}}", stats().name || "Alex");
const on = (id, handler) => {
  const el = document.getElementById(id);
  if (el) el.onclick = handler;
};
const speechAvailable = () =>
  Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
const statusText = () =>
  syncError
    ? `Zapis na urządzeniu; ${syncError}`
    : syncBusy
      ? "Łączenie…"
      : syncUrl()
        ? pending.length
          ? `Do wysłania: ${pending.length}`
          : syncAt
            ? `Potwierdzono wysłanie · ${syncAt}`
            : "Zapis na urządzeniu; chmura jeszcze niesprawdzona"
        : "Zapis na tym urządzeniu · zachowuj kopię postępu";
function syncUrl() {
  return localStorage.getItem("pilot-sync-url") ?? config?.syncUrl ?? "";
}
async function refresh() {
  ({ events, pending } = await store.load(key));
}
function event(type, fields = {}) {
  return {
    id: uid(),
    type,
    courseId: COURSE_ID,
    courseVersion: course.version,
    appVersion: APP_VERSION,
    at: new Date().toISOString(),
    day: localDay(),
    ...fields,
  };
}
async function record(type, fields = {}) {
  await store.add(key, [event(type, fields)]);
  await refresh();
  channel?.postMessage({ profile: key });
}
function showError(error) {
  notice = error.message || "Nie udało się wykonać operacji.";
  if (!round) render();
  else document.getElementById("message").textContent = notice;
}
function guard(action) {
  return async () => {
    try {
      await action();
    } catch (error) {
      showError(error);
    }
  };
}
function download(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function speak(text) {
  if (!speechAvailable()) {
    notice =
      "Brak syntezy mowy. Użyj ćwiczenia ze znaczeniem i sprawdź głos angielski w telefonie.";
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(sub(text));
  utterance.lang = "en-US";
  utterance.rate = 0.85;
  const voices = speechSynthesis.getVoices();
  utterance.voice =
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null;
  utterance.onerror = () => {
    const target = document.getElementById("message");
    if (target)
      target.textContent =
        "Dźwięk niedostępny. Sprawdź głośność lub wybierz ćwiczenie ze znaczeniem.";
  };
  speechSynthesis.speak(utterance);
}
async function synchronise() {
  if (!syncUrl()) return;
  if (syncBusy) {
    syncAgain = true;
    return;
  }
  syncBusy = true;
  syncError = "";
  try {
    await syncProfile(store, key, syncUrl());
    syncAt = new Date().toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });
    await refresh();
  } catch (error) {
    syncError = error.message;
  } finally {
    syncBusy = false;
    if (!round && screen === "home") render();
    if (syncAgain && !syncError) {
      syncAgain = false;
      scheduleSync();
    }
  }
}
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(synchronise, 1000);
}
function banner() {
  return `<p id="message" class="note" role="status">${esc(notice)}</p>`;
}
function board(message = "ENGLISH · PILOT") {
  const p = stats();
  return `<header class="board"><div class="board-row"><div class="cell"><span class="cell-k">Punkty</span><span class="cell-v">${p.xp}</span></div><div class="cell"><span class="cell-k">Etap</span><span class="cell-v">${activeWeek().id}/${course.weeks.length}</span></div><div class="cell"><span class="cell-k">Dni nauki</span><span class="cell-v">${p.dates.length}</span></div></div><div class="board-msg">${esc(message)}</div></header>`;
}
function render() {
  if (!course || round || screen === "result") return;
  screen === "parent" ? parentScreen() : stats().name ? home() : nameScreen();
}
function nameScreen() {
  app.innerHTML =
    board() +
    `<div class="hero"><span class="eyebrow">Cztery tygodnie razem</span><h1>Jak masz na imię?</h1><p>Piłka, klocki i liczby. Zaczynamy od poznania drużyny.</p></div><label for="name">Imię lub pseudonim</label><input class="typed" id="name" maxlength="30" autocomplete="given-name"><button class="cta" id="save-name">Zaczynamy</button>${banner()}`;
  on(
    "save-name",
    guard(async () => {
      const name = document.getElementById("name").value.trim();
      if (!name) throw new Error("Wpisz imię lub pseudonim.");
      await record("profile", { name });
      home();
      scheduleSync();
    }),
  );
}
function home() {
  screen = "home";
  const p = stats(),
    w = activeWeek();
  const dayIndex = Math.min(
    4,
    new Set(
      Object.values(events)
        .filter((e) => e.type === "session" && e.completed && e.week === w.id)
        .map((e) => e.day),
    ).size,
  );
  const items = eligibleItems(course, w.id),
    known = items.filter((i) => p.items[i.id]?.box >= 3).length;
  app.innerHTML =
    board() +
    `<div class="hero"><span class="eyebrow">${esc(p.name)} · Tydzień pilota ${w.id}</span><h1>${esc(w.title)}</h1><p>${esc(w.daily[dayIndex])}</p></div>
    <button class="cta" id="start">Zacznij trening<span class="cta-sub">Krótka runda · twoje tempo</span></button>
    <div class="card"><h3>Dzisiejsza misja</h3><p>${esc(w.offlineMission)}</p></div>
    <div class="card"><h3>Powiedz na głos</h3>${w.speaking.map((s, i) => `<button class="ghost" id="speak-${i}">${esc(sub(s))} 🔊</button>`).join("")}<p class="note">Powiedz po swojemu. Rodzic pomoże sprawdzić odpowiedź.</p></div>
    <div class="card"><h3>Wraca coraz łatwiej: ${known} / ${items.length}</h3><p>Liczymy odpowiedzi bez podpowiedzi, po przerwie. Powtórka tego samego dnia jest treningiem.</p></div>
    <p class="note">${esc(statusText())}</p>${banner()}<div class="foot"><button id="parent">Panel rodzica</button></div>`;
  on("start", guard(start));
  on("parent", () => {
    screen = "parent";
    parentScreen();
  });
  w.speaking.forEach((s, i) => on(`speak-${i}`, () => speak(s)));
}
async function start() {
  await refresh();
  const list = buildSession(
    course,
    events,
    localDay(),
    Math.random,
    speechAvailable(),
  );
  if (!list.length) {
    notice =
      "Brak poznanych materiałów do powtórki. W panelu rodzica wybierz wcześniejszy tydzień i poznaj materiał.";
    home();
    return;
  }
  round = {
    id: uid(),
    list,
    index: 0,
    right: 0,
    wrong: 0,
    started: Date.now(),
    week: activeWeek().id,
    busy: false,
  };
  question();
}
function question() {
  const ex = round.list[round.index];
  round.answered = false;
  round.assisted = false;
  round.selected = [];
  round.questionAt = Date.now();
  let body;
  if (ex.kind === "learn")
    body = `<div class="q"><span class="q-tag">Najpierw poznaj</span><p class="q-main">${esc(sub(ex.item.en))}</p><p class="q-sub">${esc(sub(ex.item.pl))}</p>${ex.item.cue ? `<p class="q-main" aria-hidden="true">${esc(ex.item.cue)}</p>` : ""}<button class="speak" id="audio">🔊 Posłuchaj i powtórz</button></div><button class="cta" id="learned">Przechodzę do ćwiczenia</button>`;
  else {
    const labels = {
      en2pl: "Co to znaczy?",
      pl2en: "Jak to powiedzieć?",
      listen: "Posłuchaj i wybierz",
      spell: "Napisz po angielsku",
      gap: "Uzupełnij",
      order: "Ułóż zdanie",
    };
    body = `<div class="q"><span class="q-tag">${labels[ex.kind]}</span><p class="q-main small">${esc(sub(ex.prompt))}</p>${ex.kind === "gap" ? `<p class="q-sub">${esc(sub(ex.item.pl))}</p>` : ""}${ex.kind !== "pl2en" ? `<button class="speak" id="audio">🔊 ${["gap", "order", "spell"].includes(ex.kind) ? "Podpowiedź głosowa" : "Posłuchaj"}</button>` : ""}</div>`;
    if (ex.kind === "spell")
      body +=
        '<label class="note" for="typed">Twoja odpowiedź</label><input class="typed" id="typed" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="cta" id="check">Sprawdź</button>';
    else if (ex.kind === "order")
      body += `<div class="slot" id="slot" aria-live="polite">Dotknij słów po kolei</div><div class="chips">${ex.tokens.map((t, i) => `<button class="chip" id="token-${i}">${esc(sub(t))}</button>`).join("")}</div><button class="ghost" id="undo">Cofnij słowo</button><button class="cta" id="check">Sprawdź</button>`;
    else
      body += `<div class="opts">${ex.options.map((o, i) => `<button class="opt" id="option-${i}">${esc(sub(o))}</button>`).join("")}</div>`;
    if (ex.kind === "listen")
      body +=
        '<button class="ghost" id="no-audio">Nie słyszę — ćwicz znaczenie</button>';
  }
  app.innerHTML =
    board(`Zadanie ${round.index + 1} / ${round.list.length}`) +
    body +
    '<div id="feedback" aria-live="polite"></div>' +
    banner() +
    '<div class="foot"><button id="quit">Zapisz i przerwij</button></div>';
  on("audio", () => {
    if (["gap", "order", "spell"].includes(ex.kind) && !round.answered)
      round.assisted = true;
    speak(ex.item.en);
  });
  on(
    "learned",
    guard(async () => {
      if (round.busy) return;
      round.busy = true;
      try {
        await record("intro", {
          itemId: ex.item.id,
          itemRevision: ex.item.revision,
        });
        round.answered = true;
        await next();
      } finally {
        if (round) round.busy = false;
      }
    }),
  );
  on(
    "check",
    guard(() =>
      answer(
        ex.kind === "spell"
          ? document.getElementById("typed").value
          : round.selected.map((i) => sub(ex.tokens[i])).join(" "),
      ),
    ),
  );
  if (ex.kind === "spell")
    document.getElementById("typed").onkeydown = (e) => {
      if (e.key === "Enter") guard(() => answer(e.target.value))();
    };
  ex.options?.forEach((value, i) =>
    on(
      `option-${i}`,
      guard(() => answer(sub(value))),
    ),
  );
  ex.tokens?.forEach((token, i) =>
    on(`token-${i}`, () => {
      if (round.answered || round.selected.includes(i)) return;
      round.selected.push(i);
      document.getElementById(`token-${i}`).disabled = true;
      document.getElementById("slot").textContent = round.selected
        .map((j) => sub(ex.tokens[j]))
        .join(" ");
    }),
  );
  on("undo", () => {
    if (round.answered) return;
    const i = round.selected.pop();
    if (i === undefined) return;
    document.getElementById(`token-${i}`).disabled = false;
    document.getElementById("slot").textContent =
      round.selected.map((j) => sub(ex.tokens[j])).join(" ") ||
      "Dotknij słów po kolei";
  });
  on("no-audio", () => {
    if (round.answered || round.busy) return;
    ex.kind = "pl2en";
    ex.prompt = ex.item.pl;
    question();
  });
  on(
    "quit",
    guard(() => {
      if (!round.busy) return end(false);
    }),
  );
  if (ex.kind === "listen") speak(ex.item.en);
}
async function answer(value) {
  if (round.answered || round.busy) return;
  round.busy = true;
  try {
    const ex = round.list[round.index],
      correct = normalize(value) === normalize(sub(ex.correct));
    await record("attempt", {
      itemId: ex.item.id,
      itemRevision: ex.item.revision,
      kind: ex.kind,
      correct,
      assisted: round.assisted,
      sessionId: round.id,
      week: round.week,
      durationMs: Math.min(86400000, Date.now() - round.questionAt),
    });
    round.answered = true;
    round[correct ? "right" : "wrong"]++;
    document.querySelector(".board").outerHTML = board(
      `Zadanie ${round.index + 1} / ${round.list.length}`,
    );
    document
      .querySelectorAll(".opt,.chip,#check,#typed,#no-audio")
      .forEach((el) => (el.disabled = true));
    document.getElementById("feedback").innerHTML =
      `<div class="fb ${correct ? "good" : "bad"}">${correct ? "Dobrze!" : `Spróbujemy znów. Poprawnie: ${esc(sub(ex.correct))}`}<small>${esc(sub(ex.item.en))} · ${esc(sub(ex.item.pl))}${round.assisted ? " · z podpowiedzią" : ""}</small></div><button class="cta" id="next">Dalej</button>`;
    speak(ex.item.en);
    on("next", guard(next));
  } finally {
    if (round) round.busy = false;
  }
}
async function next() {
  if (!round?.answered) return;
  round.answered = false;
  round.index++;
  if (round.index < round.list.length) question();
  else await end(true);
}
async function end(completed) {
  if (!round) return;
  round.busy = true;
  const savedRound = round;
  try {
    await record("session", {
      sessionId: round.id,
      week: round.week,
      completed,
      durationMs: Math.min(86400000, Date.now() - round.started),
    });
  } catch (error) {
    round.busy = false;
    if (completed) {
      round.index--;
      round.answered = true;
    }
    throw error;
  }
  round = null;
  window.speechSynthesis?.cancel();
  scheduleSync();
  if (!completed) {
    notice =
      "Postęp zapisany. Niedokończona runda też pomaga zaplanować powtórki.";
    home();
    return;
  }
  app.innerHTML =
    board("TRENING ZAKOŃCZONY") +
    `<div class="result"><div class="score">${savedRound.right}:${savedRound.wrong}</div><h2>Dobra robota!</h2><p>Teraz powiedz jedno zdanie bez ekranu. Następny tydzień wybierzecie razem z rodzicem.</p></div><button class="cta" id="home">Wróć do misji</button>${banner()}`;
  // Keep background sync from replacing this result screen until the user leaves it.
  screen = "result";
  on("home", () => {
    screen = "home";
    home();
  });
}
function parentScreen() {
  screen = "parent";
  const p = stats(),
    w = activeWeek(),
    report = weeklyReport(course, events),
    focus = p.plan.focus[0] || "";
  const unseen = eligibleItems(course, w.id).filter(
    (i) => !p.items[i.id]?.seen,
  );
  const legacy = localStorage.getItem("eng-trainer-v1");
  app.innerHTML =
    board("PANEL RODZICA") +
    `<div class="hero"><h1>Plan i postęp</h1><p>Ostatnie 7 dni — dni nauki: ${report.practiceDays}, ukończone rundy: ${report.completedSessions}.</p></div>${banner()}
    <div class="card"><h3>Plan na teraz</h3><label for="week">Tydzień pilota</label><select id="week">${course.weeks.map((x) => `<option value="${x.id}" ${x.id === w.id ? "selected" : ""}>${x.id}. ${esc(x.title)}</option>`).join("")}</select>
    <label for="new-count">Maksimum nowych słów dziennie</label><select id="new-count">${[0, 1, 2, 3, 4, 5].map((n) => `<option ${n === p.plan.newPerDay ? "selected" : ""}>${n}</option>`).join("")}</select>
    <label for="length">Długość rundy (razem z nauką nowych rzeczy)</label><select id="length">${[12, 16, 20].map((n) => `<option ${n === p.plan.maxExercises ? "selected" : ""}>${n}</option>`).join("")}</select>
    <label for="focus">Dodatkowa uwaga</label><select id="focus"><option value="">Zwykłe powtórki</option>${Object.entries(
      skillNames,
    )
      .map(
        ([id, name]) =>
          `<option value="${id}" ${focus === id ? "selected" : ""}>${name}</option>`,
      )
      .join(
        "",
      )}</select><button class="ghost" id="save-plan">Zatwierdź plan</button><p class="note">Tydzień nie zmienia się sam. Krótsza runda może wprowadzić mniej słów. Dużo zaległych powtórek wstrzymuje nowe słowa.</p></div>
    <div class="card"><h3>Wspólna lekcja · tydzień ${w.id}</h3><p>${esc(w.parentBrief)}</p><ul>${w.outcomes.map((s) => `<li>${esc(s)}</li>`).join("")}</ul><details><summary>Pięć krótkich praktyk</summary><ol>${w.daily.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details><h3>Sprawdź bez gotowych odpowiedzi</h3><ul>${w.parentCheck.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
    ${course.units
      .filter((u) => w.units.includes(u.id))
      .map(
        (u) =>
          `<div class="card"><h3>${esc(u.title)} · książka str. ${u.pages.join("–")}</h3><p>${esc(u.grammar)}</p><details><summary>Materiały do przejrzenia (${u.items.length})</summary><ul>${u.items.map((i) => `<li><b>${esc(sub(i.en))}</b> — ${esc(sub(i.pl))}</li>`).join("")}</ul></details></div>`,
      )
      .join("")}
    <div class="card"><h3>Obserwacja rodzica</h3><label for="rating">Jak było?</label><select id="rating"><option value="okay">W sam raz</option><option value="easy">Łatwo</option><option value="hard">Trudno</option></select><label for="note">Co pamiętał bez pomocy? Co go zainteresowało?</label><textarea id="note" maxlength="1500"></textarea><button class="ghost" id="save-note">Zapisz obserwację</button></div>
    <div class="card"><h3>Przegląd tygodnia</h3><p>Jeszcze nie wprowadzone — słowa: ${unseen.filter((i) => i.type === "word").length}, zdania: ${unseen.filter((i) => i.type === "sentence").length}.</p><p class="note">To materiał do poznania, a nie błędy. Możecie przedłużyć wcześniejszy tydzień. W tygodniu powtórkowym ćwiczymy tylko poznane rzeczy.</p><p>${esc(report.recommendation.decision === "collect-more-evidence" ? "Za mało prób do decyzji. Zbierz kilka dni obserwacji." : report.recommendation.focus.length ? "Warto utrwalić: " + report.recommendation.focus.map((s) => skillNames[s]).join(", ") : "Sprawdź pamięć i mówienie z rodzicem przed przejściem dalej.")}</p>
    <table class="tbl"><thead><tr><th>Zakres</th><th>Bez pomocy</th><th>Z pomocą</th></tr></thead><tbody>${report.skills.map((s) => `<tr><td>${esc(skillNames[s.skill])}</td><td>${s.correct}/${s.unaided}</td><td>${s.helped}</td></tr>`).join("")}</tbody></table><button class="ghost" id="export-report">Pobierz raport dla agenta AI</button><p class="note">Raport obejmuje obserwacje i wyniki; nie zawiera klucza dostępu. Agent proponuje zmiany, rodzic je przegląda.</p></div>
    ${report.parentNotes.length ? `<div class="card"><h3>Ostatnie obserwacje</h3><ul>${report.parentNotes.map((n) => `<li><b>${esc(n.day)} · ${{ easy: "łatwo", okay: "w sam raz", hard: "trudno" }[n.rating]}</b><p>${esc(n.note)}</p></li>`).join("")}</ul></div>` : ""}
    <div class="card"><h3>Kopia i synchronizacja</h3><p>${esc(statusText())}</p><button class="ghost" id="export-backup">Pobierz pełną kopię postępu</button><label for="import-file">Przywróć z kopii (łączy historię, nie usuwa bieżącej)</label><input type="file" id="import-file" accept="application/json,.json"><button class="ghost" id="import">Wczytaj wybraną kopię</button>${legacy ? '<button class="ghost" id="legacy">Pobierz zachowaną kopię poprzedniej aplikacji</button>' : ""}
    <label for="share">Link tego ucznia</label><textarea id="share" readonly>${esc(location.origin + location.pathname + "#k=" + key)}</textarea>
    <label for="sync-url">Adres Workera pilota v2 (opcjonalnie)</label><input id="sync-url" type="url" value="${esc(syncUrl())}" placeholder="https://eng-sync.t-jetka.workers.dev"><button class="ghost" id="connect">Zapisz adres i synchronizuj</button><p class="note">Worker eng-sync wymaga aktualizacji do v2. Do tego czasu używaj jednego urządzenia i pobieraj kopię co tydzień. Książka i audio wydawcy pozostają osobno.</p></div>
    <div class="foot"><button id="back">Wróć do treningu</button></div>`;
  on("back", home);
  on(
    "save-plan",
    guard(async () => {
      await record("plan", {
        week: Number(document.getElementById("week").value),
        newPerDay: Number(document.getElementById("new-count").value),
        maxExercises: Number(document.getElementById("length").value),
        focus: document.getElementById("focus").value
          ? [document.getElementById("focus").value]
          : [],
      });
      notice =
        "Plan zatwierdzony. Dotychczasowe odpowiedzi pozostają w historii.";
      parentScreen();
      scheduleSync();
    }),
  );
  on(
    "save-note",
    guard(async () => {
      await record("review", {
        rating: document.getElementById("rating").value,
        note: document.getElementById("note").value.trim(),
      });
      notice = "Obserwacja zapisana w raporcie.";
      parentScreen();
      scheduleSync();
    }),
  );
  on("export-report", () =>
    download(`english-review-${localDay()}.json`, weeklyReport(course, events)),
  );
  on("export-backup", () =>
    download(`english-backup-${localDay()}.json`, {
      schemaVersion: 2,
      courseId: COURSE_ID,
      profileKey: key,
      exportedAt: new Date().toISOString(),
      events: Object.values(events),
    }),
  );
  on("legacy", () =>
    download(`english-legacy-backup-${localDay()}.json`, JSON.parse(legacy)),
  );
  on(
    "connect",
    guard(async () => {
      const url = validateSyncUrl(document.getElementById("sync-url").value);
      localStorage.setItem("pilot-sync-url", url);
      notice = url
        ? "Łączę z Workerem pilota."
        : "Synchronizacja wyłączona; postęp zostaje na urządzeniu.";
      parentScreen();
      await synchronise();
      notice = url
        ? syncError
          ? "Nie potwierdzono zapisu w chmurze."
          : "Synchronizacja zakończona."
        : "Synchronizacja wyłączona.";
      parentScreen();
    }),
  );
  on(
    "import",
    guard(async () => {
      const file = document.getElementById("import-file").files[0];
      if (!file || file.size > 20000000)
        throw new Error("Wybierz kopię JSON do 20 MB.");
      const backup = JSON.parse(await file.text()),
        incoming = validateBackup(backup);
      if (backup.profileKey !== key)
        throw new Error(
          "Ta kopia należy do innego profilu. Otwórz zapisany link tego ucznia, zanim ją wczytasz.",
        );
      await store.add(key, Object.values(incoming), true);
      await refresh();
      notice = "Połączono historię z kopii. Niczego nie usunięto.";
      parentScreen();
      scheduleSync();
    }),
  );
}

async function boot() {
  const manifest = await fetch("content/pilot.json", {
    cache: "no-cache",
  }).then((r) => {
    if (!r.ok) throw new Error("Nie można wczytać lekcji.");
    return r.json();
  });
  if (
    !Array.isArray(manifest.unitFiles) ||
    !manifest.unitFiles.every((p) => /^units\/[a-z0-9-]+\.json$/.test(p))
  )
    throw new Error("Nieprawidłowe ścieżki lekcji.");
  const units = await Promise.all(
    manifest.unitFiles.map((file) =>
      fetch("content/" + file, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error("Nie można wczytać materiału.");
        return r.json();
      }),
    ),
  );
  course = validateCourse({ ...manifest, units });
  skillNames = course.skillNames;
  config = await fetch("config.json", { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error("Brak konfiguracji.");
    return r.json();
  });
  store = await openDatabase();
  const hash = new URLSearchParams(location.hash.slice(1)).get("k");
  if (hash && !/^[a-z2-9]{12,32}$/.test(hash))
    throw new Error("Nieprawidłowy link ucznia. Otwórz zachowany pełny link.");
  key = hash || localStorage.getItem("pilot-profile-key") || newKey();
  localStorage.setItem("pilot-profile-key", key);
  history.replaceState(null, "", "#k=" + key);
  await refresh();
  render();
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("english-pilot");
    channel.onmessage = async (e) => {
      if (e.data.profile === key) {
        await refresh();
        if (!round && screen === "home") render();
      }
    };
  }
  scheduleSync();
}
window.addEventListener("online", scheduleSync);
window.addEventListener("focus", () => {
  if (store)
    refresh()
      .then(() => {
        if (!round && screen === "home") render();
        scheduleSync();
      })
      .catch(showError);
});
window.addEventListener("hashchange", () => location.reload());
boot().catch((error) => {
  app.innerHTML = `<div class="hero"><h1>Nie udało się uruchomić treningu</h1><p>${esc(error.message)}</p><p>Otwórz aplikację przez HTTPS lub lokalny serwer. Nie usuwaj danych przeglądarki.</p></div>`;
});
