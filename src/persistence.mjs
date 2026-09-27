import { validateEvent, unionEvents, COURSE_ID } from "./engine.mjs";

// One immutable event per row prevents one tab from overwriting another tab's work.
export function openDatabase(indexedDB = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) {
      reject(new Error("Ta przeglądarka nie udostępnia zapisu postępu."));
      return;
    }
    const request = indexedDB.open("english-trainer-pilot", 1);
    request.onupgradeneeded = () => {
      const events = request.result.createObjectStore("events", {
        keyPath: "storageId",
      });
      events.createIndex("profile", "profile");
    };
    request.onerror = () =>
      reject(new Error("Nie można otworzyć lokalnego zapisu."));
    request.onblocked = () =>
      reject(new Error("Zamknij starszą kartę aplikacji i spróbuj ponownie."));
    request.onsuccess = () => resolve(new EventStore(request.result));
  });
}

export class EventStore {
  constructor(db) {
    this.db = db;
  }
  async load(profile) {
    return new Promise((resolve, reject) => {
      const request = this.db
        .transaction("events")
        .objectStore("events")
        .index("profile")
        .getAll(profile);
      request.onerror = () => reject(new Error("Nie można odczytać postępu."));
      request.onsuccess = () => {
        const events = {},
          pending = [];
        for (const row of request.result) {
          events[row.event.id] = row.event;
          if (row.pending) pending.push(row.event.id);
        }
        resolve({ events, pending });
      };
    });
  }
  async add(profile, events, pending = true) {
    events.forEach(validateEvent);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("events", "readwrite"),
        store = tx.objectStore("events");
      let conflict = false;
      for (const event of events) {
        const storageId = `${profile}:${event.id}`,
          request = store.get(storageId);
        request.onsuccess = () => {
          const previous = request.result;
          if (
            previous &&
            JSON.stringify(previous.event) !== JSON.stringify(event)
          ) {
            conflict = true;
            tx.abort();
            return;
          }
          // Remote reads never clear a locally pending write.
          store.put({
            storageId,
            profile,
            event,
            pending: Boolean(previous?.pending || pending),
          });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            conflict
              ? "Sprzeczne wersje zdarzenia."
              : "Zapis nie powiódł się. Zachowaj kopię i sprawdź wolne miejsce.",
          ),
        );
    });
  }
  async acknowledge(profile, ids) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("events", "readwrite"),
        store = tx.objectStore("events");
      for (const id of ids) {
        const request = store.get(`${profile}:${id}`);
        request.onsuccess = () => {
          if (request.result) store.put({ ...request.result, pending: false });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error("Nie zapisano potwierdzenia synchronizacji."));
    });
  }
}

export function validateBackup(value) {
  if (
    value?.schemaVersion !== 2 ||
    value.courseId !== COURSE_ID ||
    !/^[a-z2-9]{12,32}$/.test(value.profileKey || "") ||
    !Array.isArray(value.events) ||
    value.events.length > 50000
  )
    throw new Error("To nie jest kopia postępu pilota.");
  const events = {};
  for (const e of value.events) {
    validateEvent(e);
    if (events[e.id]) throw new Error("Powtórzone ID w kopii.");
    events[e.id] = e;
  }
  return events;
}

export function validateSyncUrl(value) {
  if (!value.trim()) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Podaj sam adres HTTPS workera, bez ścieżki.");
  return url.origin;
}

async function requestJSON(fetcher, url, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        `Synchronizacja: HTTP ${response.status}. Sprawdź, czy to Worker pilota v2.`,
      );
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Acknowledgements refer to immutable IDs, so a slow response cannot erase later answers.
export async function syncProfile(store, profile, baseUrl, fetcher = fetch) {
  const base = validateSyncUrl(baseUrl);
  if (!base) return false;
  const path = `${base}/v2/p/${profile}`;
  const initial = await store.load(profile);
  for (let i = 0; i < initial.pending.length; i += 40) {
    const ids = initial.pending.slice(i, i + 40),
      events = ids.map((id) => initial.events[id]);
    const ack = await requestJSON(fetcher, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    if (
      ack.schemaVersion !== 2 ||
      !Array.isArray(ack.accepted) ||
      ack.accepted.length !== ids.length ||
      new Set(ack.accepted).size !== ids.length ||
      !ids.every((id) => ack.accepted.includes(id))
    )
      throw new Error(
        "Worker nie potwierdził wszystkich zapisów. Kopia lokalna pozostaje do wysłania.",
      );
    await store.acknowledge(profile, ids);
  }
  let cursor = "",
    pages = 0;
  const cursors = new Set();
  do {
    const data = await requestJSON(
      fetcher,
      `${path}${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    if (
      data.schemaVersion !== 2 ||
      !Array.isArray(data.events) ||
      data.events.length > 100 ||
      typeof data.cursor !== "string"
    )
      throw new Error("Nieprawidłowa odpowiedź workera.");
    const current = await store.load(profile);
    unionEvents(
      current.events,
      Object.fromEntries(data.events.map((e) => [e.id, validateEvent(e)])),
    );
    await store.add(profile, data.events, false);
    cursor = data.cursor;
    if (cursor && cursors.has(cursor))
      throw new Error("Powtórzona strona synchronizacji.");
    cursors.add(cursor);
    if (++pages > 500)
      throw new Error("Historia wymaga ręcznego przeglądu rozmiaru.");
  } while (cursor);
  return true;
}
