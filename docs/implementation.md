# Pilot implementation

Released as app `2.0.0-pilot.1` and course `2026.09-pilot.1`, approved on 28 September 2026. This replaces the original inline-script design with a small, build-free set of ES modules and JSON content. No runtime libraries or AI service were added. GitHub Pages serves `main`; the parent deployed the extended existing Worker through the private Opera dashboard.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `index.html` | Existing mobile styling and app mount; loads the application module |
| `src/app.mjs` | Learner screens, parent controls, browser speech, report/backup downloads |
| `src/engine.mjs` | Pure validation, event reduction, scheduling and weekly-report logic |
| `src/persistence.mjs` | IndexedDB event storage, backup validation and v2 sync client |
| `content/pilot.json` | Content version, source provenance, skill labels, weekly briefs and missions |
| `content/units/u01.json` … `u03.json` | First three book units: 56 vocabulary items and 24 sentences |
| `content/roadmap.json` | 26 provisional book milestones, mostly not yet authored |
| `config.json` | Release status and default sync URL, `https://eng-sync.t-jetka.workers.dev` |
| `worker/index.mjs` | Extended eng-sync Worker: new event API plus existing routes |
| `scripts/worker.js` | Parent-supplied legacy Worker source, preserved unchanged |
| `scripts/course.mjs` | Dependency-free validation and report review helper |

## Data model

Every practice observation is an immutable event with a unique ID, timestamp, local date, course/version and app version. Event types are `intro`, `attempt`, `session`, `plan`, `review` and `profile`.

Attempts reference permanent item IDs and revisions, exercise type, correctness, assistance, session ID and response duration. Raw typed answers are not stored. A session completion records elapsed time; a partial round can still be inferred from its attempts after a tab is closed. Parent notes and pacing decisions also remain in the event history.

The local database is `english-trainer-pilot`, IndexedDB version 1. Its `events` object store uses a combined profile/event key, indexed by profile. Rows include the event and a pending-upload marker. Each answer is committed before allowing the learner to advance. A quota/write failure is surfaced rather than silently presenting the answer as saved.

The learner key is in `#k=...` and small localStorage metadata (`pilot-profile-key`). The optional endpoint override uses `pilot-sync-url`. Different profile keys have separate event histories. The original `eng-trainer-v1` localStorage record is left intact and is downloadable from the parent panel if present. Legacy aggregate scores are not converted into invented detailed attempts or silently applied to the new book syllabus.

Derived state is recomputed from the event union: item attempts, boxes/due dates, separate sessions and completed practice dates, XP, parent notes and the latest plan. This provides a small inspectable record rather than competing mutable aggregate snapshots. The app never deletes or resets an existing history through its UI.

## Scheduling and teaching

- Parent selects the week, round cap (12/16/20), daily new-word cap (0–5) and optional focus. Weeks do not auto-unlock from scores.
- Introductions show English, Polish meaning and optional cue before testing. Introductions are ungraded.
- Four grammar slots are reserved before vocabulary allocation. A new sentence costs an introduction plus an exercise; known sentences cost one exercise. Due sentences from earlier units remain eligible.
- A new word receives introduction, recognition and later retrieval; all three are budgeted together so truncation cannot discard the latter.
- Due vocabulary is prioritised by focus and due date. More than twelve due vocabulary items pauses new words for that round.
- At most four spelling tasks are generated; listening has a visual fallback if speech synthesis is missing or silent.
- Only an unaided correct answer on a later date, when due, promotes an item, at most once per date. A mistake resets its box and schedules another day. Intervals are `[1,1,3,7,14]` days.
- A revealing audio hint on spelling or sentence tasks is recorded as assistance. Listening to the target in a listening exercise is part of the task, not a hint.
- Consolidation week does not introduce new words. Unseen backlog is unfinished teaching: repeat an earlier week if necessary.

The weekly report includes a dated list of recent attempts with exercise type and assistance, cumulative item history and recent parent observations. It uses explicit conservative heuristics; it is not a pronunciation or proficiency assessment. See [weekly adaptation](weekly-review.md).

## Sync contract

The parent supplied the original Worker in `scripts/worker.js`. The extended Worker delegates legacy routes to that unchanged module and adds the v2 API. Both use the existing `PROGRESS` KV binding. Legacy data uses `d:<profile>:<device>` and `b:<profile>:<slot>`; pilot events use `v2:<profile>:<event-id>`. Neither API's writes overlap the other's keys. The pilot frontend never invokes legacy reset or restore routes.

| Request | Response |
| --- | --- |
| `GET /health` | v2 service identity and whether the KV binding exists |
| `POST /v2/p/<key>` with `{events:[...]}` | `{schemaVersion:2, accepted:[event IDs]}` after storage writes succeed |
| `GET /v2/p/<key>?cursor=...` | `{schemaVersion:2, events:[...], cursor:"..."}`; empty cursor ends pagination |
| `OPTIONS` | CORS support for GET, PUT and POST with Content-Type |

KV keys use `v2:<profile>:<event-id>`. POST batches contain at most 40 events; a bulk existence read plus 40 writes stays below the documented 50 subrequest free-plan limit. GET lists up to 100 keys and uses a bulk read. [KV read API](https://developers.cloudflare.com/kv/api/read-key-value-pairs/), [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

The client uploads pending IDs before pulling pages. Only a complete, validated acknowledgement clears the sent IDs. New answers created while a request is in flight remain pending. Retries carry the same IDs; unions prevent duplicated XP. A conflicting payload with the same ID is rejected. Neither a stale response nor an old cloud page replaces newer local records.

Requests time out after 12 seconds. Offline errors retain pending records; retry occurs on app opening, completing/quitting a session, reconnect, focus, or a manual connection action. Browser tabs merge through per-event IndexedDB rows and refresh through BroadcastChannel; background refresh leaves active questions and parent form edits alone.

KV is eventually consistent; cross-device visibility may lag. This design avoids overwriting separate events but does not claim instantaneous cross-region reads. Local fake-KV tests and live API/client checks passed; physical-device testing remains a first-session check.

## Editing content

JSON is the source of truth, not generated HTML. Add a unit file, list it in `unitFiles`, add readable labels for new skill tags and append a contiguous weekly plan. The engine accepts additional weeks (up to 52) without a new UI route.

A wording correction keeps the item's ID and increments revision. A different target meaning gets a new ID. Update the course version/provenance, validate, inspect the parent preview and obtain review before publication. Old events retain their original item revision/content version.

The source PDF is ignored by Git and absent from the frontend. Only source metadata and original adapted practice are versioned. See `content/AGENTS.md` for editing rules.

## Verification and limits

Run `node scripts/course.mjs validate` and `python3 -m pytest -q`. Pytest runs three standard Node test suites for engine, sync client and Worker; the original inline-script extraction harness was intentionally replaced after modularisation. The previous audit's expected failures are now ordinary positive regression checks.

Validation on 27 September 2026:

- Full pytest suite: three passing suite wrappers, running 38 deterministic Node tests (18 engine, 10 sync, 10 Worker). Ruff and content validation pass.
- Chrome at a 390 × 844 viewport: introductions, grading, a complete synthetic round and reload persistence checked. Week/pace/focus controls retain their values after reload; parent notes save and appear in the panel.
- Downloaded a synthetic weekly report and backup. The report helper reads the exported file; the backup validator reconstructs the expected 52 XP, completed day, plan and observation. Browser console showed no errors.
- Worker bundles successfully in Wrangler **4.142.0** dry-run mode, using a temporary TOML config with a dummy namespace. No cloud deployment or cloud data write was performed.
- Backup import through the browser file chooser could not be completed because the automation extension disallowed local file access. Backup schema/conflict handling is covered in the automated tests; the complete browser restore flow still needs acceptance testing.

On 28 September the parent-deployed Worker passed live health/CORS, synthetic writes and acknowledgements, two independent sync clients converging without duplicate XP, offline queue retention across a simulated client restart, retry, conflicting/malformed event rejection, profile isolation and backup merge/sync into a fresh client. Synthetic legacy progress, report and backup-list routes worked and v2 writes preserved their data. These tests used the real sync client with in-memory client stores over HTTPS; they do not certify physical Android storage, connectivity or browser file import. All ten Worker regressions also passed against the exact standalone bundle supplied for manual deployment.

Android device voices, real-child usability and browser backup import/recovery across real devices require acceptance testing. There is no service worker, so an already-loaded page can keep saving without internet, but offline cold start is not guaranteed.
