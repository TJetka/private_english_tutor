# English Trainer: book-based pilot

A small mobile web app for a Polish-speaking beginner, using soccer, Minecraft and maths as familiar contexts. A parent leads one weekly lesson and reviews adjustments; short daily practice adapts through spaced review.

**Current branch:** `pilot/four-week-book-course`, approved by the parent on 28 September 2026. The existing [live v1](https://tjetka.github.io/private_english_tutor/) has not been replaced. Cloudflare sign-in and deployed acceptance checks remain before publication.

## Start here

- [Four-week pilot](docs/learning-plan.md): first three lessons from the supplied DK book, then consolidation.
- [Weekly adaptation](docs/weekly-review.md): how a parent and AI agent maintain the course with small changes.
- [Longer roadmap](docs/roadmap.md): 26 book milestones, roughly 27 weeks including the extra pilot review.
- [Implementation](docs/implementation.md): content, scheduling, growing practice history and sync.
- [Pilot deployment](docs/pilot-deployment.md): exact setup, acceptance checks and transition from v1.
- [Historical audit](docs/status.md) and [legacy deployment](docs/deployment.md): original findings and service information.

## What is prepared

The app contains 56 vocabulary items and 24 sentence patterns mapped to **My friends**, **At school**, and **Our classroom** (book pp. 10–27). Each pilot week has a parent brief, five daily prompts, a themed mission and oral checks. Material is shown before testing. Previous material returns, grammar keeps its own slots, and same-day repetitions do not increase retention levels repeatedly.

The parent panel controls week, pace and focus, records observations, and exports both a key-free review report and a full recovery backup. Progress is an append-only history in browser IndexedDB. Optional cloud history uses an update to the existing eng-sync Worker and its PROGRESS KV binding; it is not yet deployed. The original routes remain available and pilot events use separate keys.

## Why this is maintainable

Teaching content is ordinary versioned JSON in `content/`. An agent can read a weekly report, propose a small change, validate it and show it for parent review. The app handles daily repetition. There is no runtime AI dependency, SQL administration, CMS, build pipeline or generated 26-week exercise backlog.

```mermaid
flowchart LR
    Book[Book objectives and illustrations] --> Content[Reviewed JSON content in Git]
    Content --> App[Static app on GitHub Pages]
    App --> History[Practice events in IndexedDB]
    History <--> Cloud[Optional pilot Worker and KV]
    History --> Report[Weekly report and parent observations]
    Report --> Review[AI editor proposes small adjustments]
    Review --> Parent[Parent review]
    Parent --> Content
```

## Local use and checks

From the repository root:

```sh
node scripts/course.mjs validate
python3 -m pytest -q
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/` and use a synthetic profile for testing. `config.json` defaults to local-only progress until a v2 Worker is deployed. Review all four weeks through **Panel rodzica**.

If pytest is absent, `uv run --with pytest python -m pytest -q` creates a temporary tool environment. JavaScript tests use Node 22+ and its built-in test runner: `node --test tests/*.test.mjs`. They make no external network calls.

For a weekly report:

```sh
node scripts/course.mjs review local/english-review-YYYY-MM-DD.json
```

Keep learner exports under ignored `local/` or outside the checkout. The supplied PDF remains under ignored `book/`; its pages and recordings are not part of the deployed app. Source hash, edition and preparation provenance are recorded with the content.

Actual Android audio and cloud write/read/restore still need live acceptance checks. There is no guaranteed offline cold start. See [publishing the pilot](docs/pilot-deployment.md) before using it as the primary practice tool.
