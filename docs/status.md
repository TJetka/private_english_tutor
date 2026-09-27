# Historical v1 status and priorities

**Source recovered during pilot preparation:** the parent supplied [scripts/worker.js](../scripts/worker.js). The binding is `PROGRESS`, progress uses per-device `d:` keys, and backups use five `b:` slots with a 120-day expiry. The current [pilot deployment guide](pilot-deployment.md) extends this service in place; statements below about missing source describe the earlier audit.

**Pilot update:** a new book-aligned implementation is prepared on `pilot/four-week-book-course`. See [pilot implementation](implementation.md), [four-week plan](learning-plan.md) and [deployment gate](pilot-deployment.md). The findings below describe the original v1, not the new branch. Its nine expected-failure checks have been superseded by positive v2 regressions. The deployed v1 has not been changed.

Reviewed on **27 September 2026**, against commit `b70cf40` and the locally supplied preliminary conversation. This review adds documentation and reproducible checks; it does not change the running application.

## Assessment

Keep the small static app. It is a sensible base for one child: fast to load, no account administration, simple to edit, and a focused interface. A framework migration or more infrastructure would not address the main gaps.

The implementation is currently a **two-unit vocabulary and sentence drill**, not the personalised teaching system discussed in the background. The largest missing pieces are a coherent course plan, explicit teaching before testing, meaningful evidence of retention, and a reliable feedback loop for the parent. Cloud progress also has confirmed correctness defects.

A parent-supported pilot on one primary device is reasonable after checking audio and saving progress. A fully independent course or dependable multi-device experience is not ready yet. Security hardening is not the priority of this assessment; keeping learning records accurate and recoverable is.

## Fit to the original aims

| Aim in the background | Implemented now | Assessment |
| --- | --- | --- |
| Beginner English for a roughly ten-year-old, supported by a parent | Polish instructions, translations, small task steps | Good starting point; first encounters are still quiz questions rather than teaching cards |
| Five short daily practices around a weekly lesson | Weekly completion strip; 12–20 target exercises, 14 on a fresh profile | Partly met; no lesson pack or actual duration measurement; “15 minutes” is display copy |
| Coherent Pre-A1 course, potentially 36–40 weeks | Two units: “Kick-off” and “Colours and kit” | Substantial gap; no curriculum map or evidenced Cambridge wordlist alignment |
| Vocabulary, grammar, reading, listening and speaking | Six exercise types; device speech; two short grammar explanations | No dialogue/reading lesson, picture vocabulary, speaking activity or comprehension of connected speech |
| Personal interests, name and continuing story | Scoreboard name and fixed football/blocks theme | Surface personalisation; interests are not configurable and one sentence hardcodes “Tomek” |
| Spaced practice that adapts to mistakes | Per-item boxes and due dates; weaker words sometimes fill short sessions | Useful foundation; early promotion, truncated sessions and ignored sentence due dates undermine it |
| Parent feedback and weekly adaptation | Word accuracy/status table, weak-word list, JSON export; external report route | Partial; no session history, time, hint use, grammar summary or in-app lesson authoring |
| Motivation | Points, badges, replay, weekend-friendly attendance streak | Promising design; effectiveness must be observed with the child; “50 słów” is unreachable with 34 words |
| Continuity across devices | Local storage plus Worker client and link-based identity | Services are live, but sync correctness and recovery are not yet dependable |
| Sustainable AI-assisted content preparation | Manual content editing is possible | No AI requests, model configuration, automatic generation or report-to-curriculum loop in the app |

The earlier conversation contains recommendations and ambitious possibilities, not an already delivered course. For example, its retention multiplier and old claims about AI audio capabilities are not used here as verified facts or current constraints.

## Confirmed defects and their impact

`P0` means fix before relying on cloud/multi-device continuity. `P1` means fix for dependable teaching and independent use. These priorities concern this family's use, not enterprise requirements.

| ID | Priority | Evidence in `index.html` | Consequence and recommended change |
| --- | --- | --- | --- |
| S1 | P0 | `merge()` omits `dirty`; `boot()` pulls before checking it | Reloading after offline practice can clear the pending-upload flag without sending progress. Preserve pending local changes until a validated acknowledgement. |
| S2 | P0 | `boot()` changes `S.key` while retaining all other local state | Opening another learner's link in an already-used browser mixes histories and retains the old name. Switch to an isolated profile before pulling; preserve the old profile separately. |
| S3 | P0 | `push()` replaces `S` with the response snapshot | An answer made while a PUT is in flight can disappear when its older acknowledgement arrives. Track the sent revision and reconcile newer local changes. |
| S4 | P0 | `merge()` takes max XP and chooses one whole item by attempt count; ties choose the first argument | Independent practice is discarded and equal-count answers merge differently depending on order. Specify deduplication and merge rules for independent practice, preferably stable attempt IDs or correctly aggregated per-device counters. Recover the server before choosing the final change. |
| S5 | P1 | `grade()` saves locally without marking dirty or incrementing revision | Quitting mid-session leaves answers locally saved but not queued for sync. Track every state-changing answer. |
| S6 | P1 | `push()` catches JSON errors and still clears dirty on an HTTP success | A malformed acknowledgement can be reported as saved. Validate response shape and acknowledgement before clearing pending work. |
| L1 | P1 | `buildSession()` appends grammar and later recall, then applies `slice(0, 20)` | With all 34 words due, the generated session has 20 vocabulary exercises and **zero grammar**. Reserve slots before sampling reviews/new words; preserve each new word's later retrieval. |
| L2 | P1 | `grade()` promotes on every correct response; `finishSession()` unlocks at 80% in box 2 | Four perfect rounds on one date unlock unit 2. Immediate recognition is treated as durable learning. Require recall on later dates and a short unit check; allow parent pacing. |

Further findings from source inspection:

- **Setup:** `SYNC_URL_DEFAULT` is blank in both repository and live HTML. A new device needs the Worker URL entered manually as well as the learner link. Saving the correct default is a high-value next implementation change.
- **Teaching sequence:** a new word is tested before its translation has been taught. Sentences can contain untaught material (`football`, `has`, `I've got`, `build with`). Add introductions and explicit prerequisites.
- **Grammar:** sentence records have due dates but the builder samples only the current unit's sentences. Previous-unit grammar does not get scheduled review. Progression considers words only.
- **Explanations:** unit 2 says `an` follows a vowel letter; it should refer to the following vowel **sound**. See the [British Council explanation](https://learnenglish.britishcouncil.org/free-resources/grammar/english-grammar-reference/indefinite-article). The rule “add -s” also needs a clearly limited scope and later irregular plurals.
- **Hints and scoring:** sentence audio exposes the complete gap/order answer. That can be useful scaffolding, but the app counts a helped answer like an unaided one. Separate practice success from a retention check.
- **Reporting:** `dates` counts completed practice days, although the parent UI labels it total sessions. Repeated rounds have no independent record; answers, duration and error history cannot be reconstructed from the aggregates.
- **Reliability:** no fetch timeout, queued retry while sync is busy, or refresh from the server when an already-open tab regains focus. Startup sync can also rerender home over an active exercise. Save failures after the initial storage probe are silently ignored.
- **Recovery:** five local backups rotate on backup calls, not calendar days. They live in the same browser storage as progress. Import checks only for `items`, imports the device ID, and replaces state immediately; reset relies on unverified server replacement semantics.
- **Installation/offline:** manifest and Apple metadata exist, but there is no service worker or managed offline asset cache. Keeping an already-loaded page usable without a network is different from guaranteed offline reopening.

## What to do next

1. **Recover the deployed Worker into version control**, together with its exact KV binding and deployment instructions. Record the current Pages publishing source. Keep the existing deployed service and data intact.
2. **Make continuity dependable:** implement S1–S6, configure the confirmed default Worker URL, then test offline recovery, concurrent devices and backup restore against an isolated test namespace/profile.
3. **Correct the lesson engine:** reserve grammar/retrieval slots, teach before testing, require delayed recall, review previous grammar, and correct misleading text.
4. **Prepare four reviewed units plus a course outline:** weekly parent briefs, clear outcomes, vocabulary, audio, speaking prompts and a modest continuing story. Confirm the child's actual interests before making the theme deeper.
5. **Pilot and measure:** record practice duration, help needed, delayed recall and willingness to return. Add a compact session/attempt history so next week's choices can be based on evidence.

Steps 1–3 are bounded engineering work; adding an AI service is not a prerequisite. The [first-week plan](learning-plan.md) provides a parent-led route while that work is being completed. No performance claim or learning outcome has been established from a real child trial.

## Verification

| Check | Result / limitation |
| --- | --- |
| All tracked app code and all three existing commits inspected | Only `index.html` and `LICENSE` existed in tracked HEAD; no Worker, build configuration or prior tests |
| Live HTML GET and local comparison | HTTP 200; byte-for-byte equal to `index.html`; SHA-256 `3de4577ab6cf3a6777207f9404f9ba48d1e2095d260e8718371235b492bbec8e` |
| Worker root GET | HTTP 404 with a helpful route listing; this is not evidence that the Worker is down |
| Worker preflight | OPTIONS for PUT with the app origin returned 200 and GET/PUT/OPTIONS plus Content-Type CORS headers |
| Progress and report GET using a synthetic nonexistent key | Both returned 404/empty as expected; no real learner data read or written |
| Worker backup capability | Root advertises list/read/restore routes; retention and restore semantics not tested |
| Local Chrome UI | Synthetic onboarding, home, exercise start and correct-answer feedback visibly worked; screenshot inspected |
| Automated current-code audit | `pytest -q tests/test_current_behavior.py`: 4 passed, 9 xfailed; same result for full suite |
| Actual phone audio, installation, session duration and child usability | Still require device/child testing |
| Live write/read, offline merge, two-device convergence and restore | Not certified: Worker source and isolated test setup absent |
| GitHub Pages settings and Cloudflare account/binding/billing | Not inspected; local GitHub CLI was not authenticated |

The historical checks were committed at `71441b2`. The current [pytest entry point](../tests/test_current_behavior.py) now runs the modular pilot tests; the old inline-script harness was intentionally retired. The Node harness executes trusted checked-out JavaScript with mocked DOM, storage and HTTP, date `2026-09-28T12:00:00Z`, and seed 42. It exercises the real builder, grading, save, completion, merge and sync functions. It does not emulate a complete browser or the missing server. The L2 test encodes a recommended learning requirement; it demonstrates the current pacing limitation rather than a promise already enforced by the original code.
