# Implementation reference

As reviewed on 27 September 2026 at `b70cf40`. All runtime code is in [index.html](../index.html); the live file matched it exactly. The new tests and documentation do not alter runtime behaviour.

## Structure

| Part | Location / entry points | Responsibility |
| --- | --- | --- |
| Page and styling | HTML head, inline CSS, `#app` | Responsive column, football scoreboard, cards, buttons, reduced-motion support |
| Teaching content | `CONTENT.weeks` | Two units, words, Polish glosses, grammar explanations, sentences and gap options |
| Configuration | `CFG` | Five new words, maximum 20 exercises, intervals `[0,1,2,4,8]` days, weekly target five days, 10/2 XP |
| Local persistence | `canStore`, `load`, `save`, `backup` | JSON in browser localStorage, memory fallback, five rotating snapshots |
| Remote client | `syncUrl`, `merge`, `pull`, `push`, `trySync` | Worker URL configuration, profile fetch, save and reconciliation |
| Learning logic | `rec`, `buildSession`, `grade`, `finishSession` | Item records, task selection, answer results, attendance, badges and unit unlock |
| Speech | `initVoice`, `say` | Browser text-to-speech; prefer `en-GB`, then another English voice; rate 0.85 |
| Interface | `screenHome`, `renderQ`, `answer`, `screenResult`, `screenParent`, `screenName` | Rebuild screen HTML and bind its controls |
| Startup | `boot`, `online` event listener | Adopt link key, load/pull profile, render, attempt pending uploads |

There are no imported JavaScript libraries, remote fonts, analytics scripts, AI calls or audio files. Browser/device voices supply audio, with availability depending on the device ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)). There is no speech recognition or pronunciation assessment.

## Exercise and progression model

1. Unlock words from units whose numeric ID is at most `S.week`.
2. Select up to five unseen words in content order. Each gets English-to-Polish recognition and later Polish-to-English recall.
3. Collect seen words whose due date is today or earlier. Choose listening, translation or typing by box; limit typing to five tasks.
4. Shuffle initial/review exercises; append later recall and four randomly chosen current-unit sentence tasks, normally two gaps and two ordering tasks.
5. Try to reach 12 exercises using spare sentences or weaker known words. Finally truncate to 20, which currently creates the L1 defect.

Answers are compared after lowercasing, trimming, removing `. ! ? ,` and collapsing whitespace. Apostrophes and alternative phrasings are not normalised. There is no semantic grading.

A correct answer advances the item one box up to four; a mistake resets it to zero. Due date becomes today plus the box interval. The same word can advance twice in its introductory session. The home screen calls box 3+ “known”; unlocking the next unit uses a different threshold: at least 80% of the current unit's words in box 2+. Sentence performance does not influence unlocking.

“Week” is a content-unit ID, not a calendar week. The current increment logic expects contiguous IDs `1, 2, 3, ...`. Attendance counts unique completed dates. A gap of at most three days preserves the streak, permitting a weekend break. Multiple rounds in one day add XP but do not add another attendance day.

## State and browser storage

| Storage key | Value |
| --- | --- |
| `eng-trainer-v1` | Current profile JSON |
| `eng-trainer-v1-url` | Device/browser override for the Worker base URL |
| `eng-trainer-v1-bakn` | Rotating backup slot index |
| `eng-trainer-v1-bak0` … `-bak4` | Five profile snapshots |

Profile fields:

| Fields | Meaning |
| --- | --- |
| `name` | Cosmetic display name |
| `key` | Shared learner identifier used in the app fragment and Worker path |
| `dev` | Per-device shard identifier intended for the server's merge design |
| `rev`, `dirty` | Revision and pending-upload flag; current handling has known defects |
| `started`, `week` | Start date and content-unit ID |
| `xp`, `streak`, `best`, `last`, `dates`, `badges` | Aggregate rewards and attendance |
| `items[id]` | `{box, due, ok, bad, seen}` for a word or sentence |

`due` is an integer count of days since the Unix epoch. `today()` uses the device's local date; `dayNum()` converts that date to a UTC midnight day index. Dates such as `started` and entries in `dates` are `YYYY-MM-DD` strings.

There is no stored session list, individual answer log, elapsed time, hint count, content version or schema version field. `Q` holds the active round only in memory. Reloading loses the position in that round, although already graded answers are locally saved.

If localStorage is unavailable on initial probing, the app uses memory for the current page. Later write failures are swallowed. Adding to the home screen does not establish a general guarantee that storage or offline speech will work.

## Identity, sync and server contract

The complete app link has the form `https://tjetka.github.io/private_english_tutor/#k=<learner-key>`. The key represents the learner across devices; the name does not. A new device also needs the Worker address because the default is currently empty. The share link carries the learner key, but not the Worker address. The saved URL override wins over any future nonempty default.

The local app is not simply an independent authority with a passive cloud backup: a successful PUT can replace local state with the server response. Correct reconciliation is therefore essential.

| Operation | Client request | Expected response / usage |
| --- | --- | --- |
| Read | `GET /p/<key>` | Profile JSON; 404 means no saved profile |
| Save | `PUT /p/<key>` with JSON profile | HTTP success; client recognises `{ "state": <merged profile> }` and adopts it |
| Replace | `PUT /p/<key>?mode=replace` | Used for import/reset; deployed semantics need source inspection |
| Parent report | `GET /p/<key>/report` | Readable text, as described by conversation and live root route listing |
| Preflight | `OPTIONS` | Needed for cross-origin JSON PUT from GitHub Pages |

The live Worker also advertises `GET /b/<key>`, `GET /b/<key>/<slot>` and `PUT /b/<key>/<slot>` for listing, reading and restoring backups. These are not called by the current HTML. Their schemas, slot rules and retention are unknown until the Worker is recovered.

The conversation describes KV entries named `d:<learner-key>:<device-id>` and server-side merging across device shards. This is historical design evidence, not recovered server code. Do not assume that either sharding or a higher `rev` automatically solves the client defects in the [status report](status.md).

Startup pulls; session completion starts a fire-and-forget push. Saving the Worker address pulls then pushes. Import/reset push with replace mode. The browser's `online` event pushes only if dirty. There is no periodic polling, focus refresh, request timeout or durable retry queue.

## Editing and extending content

Each unit needs `id`, `title`, `sub`, `grammar: {t,b}`, `words` and `sentences`. Words need a permanent `id`, `en` and `pl`. Sentences need a permanent `id`, complete English and Polish text, and `gap: {q,a,o}`. Supply at least four usable sentences per unit for the current builder.

- Keep IDs globally unique across words and sentences. Never reuse an ID for a different learning item: historical progress stays attached to it.
- Keep unit IDs ordered and contiguous while the current unlocking code remains in use.
- Make each correct option occur exactly once. Keep distractor translations distinct and pedagogically plausible.
- Review spelling, grammar, Polish meaning, speech playback and prerequisites. Model generated text needs the same review as manually written content.
- To correct meaning substantially, consider a new ID. Deleting old content removes it from the teaching pool but does not erase its historical item record.
- Update the content-count baseline test when intentional content expansion changes the current 2/34/11 inventory. Add checks for new behaviour as it is implemented.

For the next implementation phase, separate content, pure learning logic, browser storage and sync into small modules when that makes the fixes easier. Preserve a build-free static deployment if possible. Add a versioned content/schema format and capture app version, content version and lesson preparation provenance with future session records; these are proposed improvements, not existing fields.
