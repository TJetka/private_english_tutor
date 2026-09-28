# Private project account separation

- Use **Opera** or a **Chrome Guest window** for this project's browser sign-in. The normal Chrome profile is the user's work account; do not use it for private project authentication.
- Use Wrangler's named profile **`private-english-tutor`** explicitly for authenticated Cloudflare commands (`--profile private-english-tutor`). Do not change the default profile or bind private credentials to unrelated directories.
- Do not read or print authentication tokens, credential files, or environment secrets. Use the normal provider sign-in flow.
- Keep the existing `eng-sync` Worker and its `PROGRESS` KV binding. See `docs/pilot-deployment.md` before deploying; preserve legacy records and routes.
- Teaching changes follow `content/AGENTS.md`. Parent approval for the initial four-week pilot was received on 28 September 2026; do not ask for that same publication approval again.
