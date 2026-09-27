# Deployment, operation and recovery

Verified where stated on **27 September 2026**. The existing services are already running; recover and document their configuration before recreating anything.

## The services you put together

| Component | Current address / status | What it does and what you need |
| --- | --- | --- |
| GitHub repository | `TJetka/private_english_tutor`; local branch `main` | Stores the frontend. Git access is needed to update it. |
| GitHub Pages | <https://tjetka.github.io/private_english_tutor/>; HTTP 200 | Serves the static `index.html` over HTTPS. No application server or build is required. Exact publishing branch/folder still to confirm in settings. |
| Cloudflare Worker | <https://eng-sync.t-jetka.workers.dev>; route/CORS checks responded | Receives and returns progress, renders reports, advertises backup routes. Cloudflare account access is needed to recover code/config or update it. |
| Cloudflare Workers KV | Named as storage in the original conversation; namespace/binding unknown | Persistent server-side progress and possibly backups. Must remain bound to the existing Worker. Source inspection is needed to establish the actual schema and retention. |
| Browser localStorage | On each device, for the app's origin | Holds profile, Worker URL override and five rotating local snapshots. No extra account required. |
| Device speech synthesis | Browser/OS voices | Reads English aloud. Test on the child's actual device; no paid audio API is configured. |

No custom domain, VPS, container, Python backend, subscription AI API or separately hosted SQL database is required by the current app. The development preview server is not part of production.

The small usage of one learner is plausibly within the Cloudflare free allowances, subject to the recovered Worker's actual operation count and the account's other usage. Current published free limits include 100,000 Worker requests/day and KV 100,000 reads, 1,000 writes, 1,000 deletes and 1,000 list requests/day, with 1 GB storage. Existing account charges have **not** been checked. [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).

GitHub Pages availability depends on repository visibility and GitHub plan; a repository name containing “private” does not establish its visibility. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Configuration to recover once

| Record | Known value / action |
| --- | --- |
| Live frontend URL | `https://tjetka.github.io/private_english_tutor/` |
| Live Worker base URL | `https://eng-sync.t-jetka.workers.dev` |
| Frontend default Worker URL | **Blank** in current live and repository HTML |
| Pages source branch and folder | Check [repository Pages settings](https://github.com/TJetka/private_english_tutor/settings/pages); likely root publishing, but not verified |
| Cloudflare account and Worker | Locate `eng-sync` in Workers & Pages in the existing account |
| Worker source | Export/retrieve the deployed source into a future `worker/` directory; currently absent |
| KV namespace and binding variable | Record the existing namespace and exact variable name expected by the Worker; do not guess |
| Worker deployment configuration | Add a version-controlled Wrangler configuration after inspecting the existing setup; no config exists here now |
| Actual learner app link | Keep the complete `#k=...` link in a parent-controlled note/bookmark; do not commit it |
| Actual learner report link | Derived in the parent panel after sync is configured; do not commit it |

Cloudflare bindings associate a Worker variable with a specific KV namespace. Inspect **Workers & Pages → Worker → Settings → Bindings** and the deployed source together. A recreated Worker with the wrong or empty namespace will not find existing progress. [Cloudflare KV binding instructions](https://developers.cloudflare.com/kv/concepts/kv-namespaces/).

## Connect the current app on a device

1. On the device that already has the desired progress, open **Panel rodzica**. Copy the JSON under **Kopia postępu** to a dated file or note outside the browser before changing setup.
2. Record the full **Link dla drugiego urządzenia**. The learner key is a shared account identifier, not the child's name or a device identifier.
3. Confirm **Adres workera** is `https://eng-sync.t-jetka.workers.dev`, with no `/p/...` suffix. The button **Zapisz adres i połącz** pulls and then pushes; use it for the same learner after preserving a copy.
4. On a fresh browser/device, open the full learner link. Enter the same Worker URL in its parent panel if necessary. A blank profile or name prompt before configuring the Worker does not prove that cloud progress is gone.
5. Check that the expected name, unit and totals appear. The green “zapisane w chmurze” label is not sufficient verification given current sync defects. Check the report as well.

Until S1–S6 in [the review](status.md) are fixed, use one primary practice device, avoid switching between learners in the same browser, and keep external progress copies. Other devices with an old profile should not be used for practice during recovery. A fresh browser avoids the confirmed profile-mixing case; it does not fix concurrent-write or stale-acknowledgement defects.

For a future frontend change, the confirmed default would be:

```js
const SYNC_URL_DEFAULT = "https://eng-sync.t-jetka.workers.dev";
```

This review has **not** applied that change. Existing per-browser URL overrides still win over the default. A blank field cannot disable sync once a nonempty default is introduced under the current `||` fallback logic; add an explicit disabled mode if needed.

## Updating the frontend

1. Make the intended code/content change and run the relevant pytest file, then the full suite for core logic/IO changes. Inspect the changed screens locally.
2. Commit the coherent change and push normally to the configured publishing branch. Preserve existing publishing settings; there is no need to add a custom GitHub Actions workflow for this single file.
3. Check the Pages deployment/build status and open the published site. Allow for cached HTML and reload to obtain the intended version.
4. Verify the deployed file or displayed version, exercise flow, actual device audio, and persistence. Content edits keep progress by item ID; respect the ID rules in [implementation](implementation.md#editing-and-extending-content).

If the existing Pages setup needs repair, the simplest supported option is publishing the branch containing `index.html` from `/(root)`. **Do not select `/docs`** for this repository's current layout: the runnable page is at the root. Confirm existing settings before changing them. [GitHub publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

For rollback, restore the prior known-good app/content with a new commit and normal push. Account for saved data compatibility; reverting an HTML file does not roll back learner progress.

## Updating or rebuilding the Worker

This cannot yet be reproduced from the checkout. First recover its actual source, bindings, backup policy and replacement semantics. Then establish a separate test Worker/namespace and exercise the client's required routes before updating the existing deployment.

Required client contract: GET and PUT `/p/<key>`, GET `/p/<key>/report`, JSON response handling, and cross-origin OPTIONS for JSON PUT. Current import/reset also use `?mode=replace`. The live root advertises additional `/b/...` backup routes; preserve them if they contain the existing recovery mechanism. See [implementation](implementation.md#identity-sync-and-server-contract).

KV is eventually consistent: another location may observe older values for 60 seconds or more. A browser `cache: "no-store"` setting does not remove KV's consistency behaviour. Test retry/idempotency and reconciliation explicitly; per-device shard names alone do not establish correctness. [Cloudflare consistency documentation](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Progress copies and recovery

- **Routine copy:** use the JSON in **Kopia postępu**, save outside the browser with a date, and retain the complete learner link plus Worker URL separately. The JSON contains the learner key, so keep it out of Git.
- **Browser/device lost:** open the saved learner link in a fresh browser and configure the Worker. If cloud data is current, it should reappear; validate against the external copy. Opening only the bare app URL can create a different learner.
- **Cloud data seems old:** inspect the primary device before resetting or importing. It may hold newer local answers that were never uploaded. Preserve both versions for reconciliation.
- **Restore from JSON:** the current import button immediately replaces local state and requests server replacement. First verify the copy belongs to the learner, preserve the current state, and stop practice on other devices. Test the recovered Worker's replacement behaviour before relying on this for real recovery; imported `dev` currently carries over too.
- **Server backups:** the Worker root advertises list/read/restore routes, but their format, retention and consistency are unverified. Recover source before using restore; do not invent slot numbers or assume that every day is backed up.
- **Reset:** “Wyczyść wszystko” keeps identity/name/device ID while clearing progress and sends a replace request. It is not a troubleshooting step and should not be used to reconnect a device.

The five browser backup slots share the same origin/storage as the main profile and rotate per backup call. Clearing site data can remove all of them. They are useful snapshots, not an independent backup service.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| App works on old phone; new phone looks empty | Same complete learner link? Worker URL configured on the new browser? Default is still blank. |
| Worker base URL shows 404 | Expected for the live root: it lists supported routes. Use a profile/report route to inspect that learner. |
| Report says no progress | Confirm learner link/key and primary-device copy; a different key is a different profile. Do not reset. |
| Sync error or “do wysłania” | Internet, exact Worker base URL, Worker errors and KV binding; preserve local copy before retrying changes. |
| “Saved in cloud” but totals disagree | Known acknowledgement/dirty/merge defects; compare copies and resolve S1–S6 rather than trusting the label. |
| Listening task is silent | Device volume, English voice availability and manual “Posłuchaj”; app has no audio-error fallback. |
| Home-screen icon fails without internet | No service worker/offline asset cache is implemented. Test online and offline launch separately. |

## Release acceptance on test data

Before calling a revised app ready, prove: a whole session survives reload; an offline session uploads after reconnect **and after reload**; a delayed response preserves a newer answer; two devices converge without duplicating/loss of attempts; a fresh device joins without extra URL entry; a different learner link remains isolated; invalid responses stay visibly unsynced; a backup restores in an isolated test profile; and phone audio works for every exercise type. Finish with one observed practice by the child. The current audit does not certify these yet.
