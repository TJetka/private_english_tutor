# Publishing the reviewed pilot

The parent approved the prepared pilot and publication on **28 September 2026**. It is on `pilot/four-week-book-course`; the existing live v1 app and `eng-sync` Worker remain unchanged until the cloud update is verified. No further content approval is needed for this reviewed release.

Release preparation on 28 September: GitHub Pages settings were verified in the dashboard as **Deploy from a branch → main → /(root)**. SSH repository access works. Opera is signed into the private Cloudflare account containing `eng-sync`; the normal Chrome profile is the user's work account and must not be used for private project authentication. The separate Wrangler sign-in attempt timed out waiting for its authorization callback; command-line authentication is **not verified**. No publishing settings or workflows were changed, and no new Worker code has been deployed.

Verified in the private Cloudflare dashboard:

| Setting | Existing value |
| --- | --- |
| Worker | `eng-sync` |
| Public address | `https://eng-sync.t-jetka.workers.dev` |
| KV binding | `PROGRESS` |
| KV namespace | `eng_tutor_progress` |
| KV namespace ID | `5785a6ebe60e4bef883e51d0708484a2` |
| Active version before the pilot update | `ec55b282` (dashboard's abbreviated ID) |

The namespace ID is configuration, not a credential. The deployed editor showed the legacy `worker.js`; a complete source comparison is still pending. The table is a deployment checkpoint, not evidence that the pilot has been published.

## What has changed operationally

Frontend hosting stays on GitHub Pages. The frontend now needs `index.html`, `src/`, `content/` and `config.json`; copying only the HTML is no longer enough. There is still no build step, runtime dependency installation or AI API.

The browser uses IndexedDB for growing practice history. The old v1 localStorage record is retained and can be exported. The pilot begins a new book-aligned course; old aggregate scores do not become fabricated answer history. Keep the old full learner link and an external v1 backup before any transition.

The parent supplied the current Worker source in `scripts/worker.js`; it is preserved unchanged. The entry point `worker/index.mjs` extends it with the pilot API. **Keep the existing `eng-sync` Worker and `PROGRESS` KV namespace.** Legacy `/p/...` and `/b/...` routes delegate to the original module. Pilot events use new `v2:` keys; legacy `d:` progress shards and `b:` backups are retained. No second Worker, database or SQL service is required.

The original service keeps five rotating backup slots with a 120-day expiry. Those are legacy snapshot backups, not a backup system for the new event history. Continue downloading external pilot JSON backups.

## Local parent review

```sh
node scripts/course.mjs validate
python3 -m pytest -q
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`, create a synthetic learner and inspect **Panel rodzica**. The panel lets you select any pilot week and inspect its brief and material. Repeated testing uses the local site's storage, separately from the live site.

Review the three book mappings, four weekly plans, pacing controls and [weekly adaptation workflow](weekly-review.md). The exact name is entered in the app. The initial English level and Android voice are checked in the first joint session, not assumed by the code.

## One-time cloud update after review

Use the existing private Cloudflare account through **Opera**, or Chrome **Guest** if necessary. Keep command-line credentials separate with the named profile `private-english-tutor`; always pass it explicitly. Wrangler's named-profile commands are experimental, so these instructions pin the tested version **4.142.0**. Wrangler is a deployment tool, not an app runtime dependency. The example must be copied to a file ending in `.toml` before Wrangler reads it.

```sh
cd worker
npx wrangler@4.142.0 auth create private-english-tutor --browser=false --scopes account:read user:read workers_scripts:write workers_kv:write
cp -n wrangler.toml.example wrangler.toml
```

Open the printed authorization URL in Opera, confirm the private account, and authorize Wrangler. `--browser=false` prevents the operating system from opening the work Chrome profile. Subsequent commands reuse this profile; do not recreate it for routine deployment.

In Cloudflare **Workers & Pages → eng-sync → Settings → Bindings**, identify the namespace already bound as **PROGRESS**. Put that existing namespace ID into the local `wrangler.toml`. Keep the Worker name `eng-sync` and binding name `PROGRESS`. Do not create an empty replacement namespace. The namespace ID is an identifier; API credentials do not belong in this file or repository.

Before deployment, compare the dashboard's deployed source/bindings with the supplied `scripts/worker.js`, and record the current deployment version for rollback. The local supplied source is not proof that the dashboard has no later edits. If the deployed code differs, recover those changes before replacing it.

Check packaging, then deploy the additive update:

```sh
npx wrangler@4.142.0 deploy --dry-run --config wrangler.toml --profile private-english-tutor
npx wrangler@4.142.0 deploy --config wrangler.toml --profile private-english-tutor
```

Wrangler bundles the original Worker module and shared validator. Confirm the Worker URL remains `https://eng-sync.t-jetka.workers.dev`. Check `GET /health` returns `schemaVersion: 2` and `storageConfigured: true`. This checks configuration, not data persistence.

### Dashboard fallback if CLI sign-in fails

An already authenticated private Opera session can publish through **eng-sync → Edit code** without granting Wrangler access. First export the existing `worker.js`, compare it with `scripts/worker.js`, and record the prior version as above. Build a single bundled module locally:

```sh
npx wrangler@4.142.0 deploy --dry-run --minify --outdir ../local/worker-bundle --config wrangler.toml
```

The dry run does not publish or need an authenticated profile. Replace the editor's `worker.js` with the generated `local/worker-bundle/index.js`, review the draft, then deploy it to the existing Worker. Do not paste only `worker/index.mjs`: its imports need bundling. Keep the existing binding and namespace. The same health, persistence and legacy-route acceptance checks below apply. A minified dry run passed on 28 September; the dashboard replacement has not yet been performed.

If the browser switches to an unrelated personal page, return to the project tab before continuing. Do not inspect other private tabs to recover deployment state.

After the update and acceptance checks, set that URL in `config.json`'s `syncUrl`, so new devices need no manual server entry. Existing browser overrides still take precedence; a deliberately empty override disables sync on that browser. The currently deployed old code does not serve the v2 API yet, so the checked-in config remains blank until the upgrade is verified.

If account access or deployment is unavailable, a one-device pilot can run with `syncUrl` blank and external JSON backups. Make that limitation explicit; don't present local saves as cloud saves.

## Acceptance before the child relies on cloud history

Use a new synthetic profile. Do not use the real learner key as test data. The test profile's v2 event keys remain separate from all existing legacy records.

1. Complete a round and reload: the score, completed session and date remain.
2. Disable the network after loading, answer and quit; restore it and verify the records on a fresh browser using the complete pilot learner link.
3. Repeat with a reload before reconnect: pending events still upload.
4. Practise on two devices; allow for KV propagation, then verify that both histories converge with no lost or duplicated attempts.
5. Export a backup, join that same profile in a separate browser and import the backup. Import merges event IDs rather than clearing state.
6. Check that a different profile key has no other learner's progress, and that a failed/malformed acknowledgement leaves the local records queued.
7. On Android, test manual audio playback, a listening task and the silent-audio fallback. Test the actual browser and home-screen shortcut separately.
8. Confirm legacy GET progress, report and backup-list routes still work using synthetic legacy data; verify v2 writes leave those records unchanged. Do not exercise a destructive legacy restore against real progress.
9. Complete the first parent-led lesson and check duration, clarity and motivation.

The code has deterministic engine/client/Worker tests; they don't substitute for these live/browser checks. KV may take 60 seconds or more to make writes visible elsewhere. [Cloudflare consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Publish and recover

After content review and the applicable acceptance checks, merge the reviewed branch normally into the actual Pages publishing branch and push. No CI/CD changes or force-push are required. Check the live HTML and modules; stale cached content can require a reload. Record the deployed commit and course version.

The complete learner link identifies the new pilot profile. Save it outside the phone together with periodic JSON backups. The parent report intentionally omits the access key; use it for ordinary agent reviews.

Rollback the frontend using a new commit if necessary; legacy routes remain available in the updated Worker, and the v1 localStorage record was not deleted. If the Worker itself needs rollback, use the recorded prior Cloudflare deployment; that makes the v2 API temporarily unavailable but does not remove `v2:` KV keys. Pilot IndexedDB records remain separate and must be exported before clearing browser data. Rolling back application code does not roll back learning history.

For ongoing content-only changes, update the JSON version/provenance, validate, review and publish the small diff. A Worker deployment is unnecessary unless the storage/API code changes.
