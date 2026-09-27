# Maintaining and adapting the course

Decision date: 27 September 2026. The parent has chosen to review material before publication. Interests: soccer, Minecraft and maths. Main device: Android smartphone; exact browser and English starting level remain to be checked in the first session.

## Recommended design

Maintain **a course outline, a small bank of reviewed content, and an accumulating practice history**. The app handles repetition; a parent and agent handle teaching decisions. No runtime AI subscription or database admin interface is needed.

| Information | Home | How it grows |
| --- | --- | --- |
| Book sequence and proposed outcomes | `content/roadmap.json` | 26 milestones; revise the provisional calendar after the pilot |
| Reviewed teaching material | `content/units/*.json` | Add one or two units ahead; stable IDs and item revisions |
| Weekly parent briefs, missions and skill labels | `content/pilot.json` | Add or adjust a week without changing application code |
| Every introduction, answer, session, parent note and plan decision | Browser IndexedDB; optional pilot Worker/KV | Append immutable events; don't overwrite old observations |
| Weekly report | Download from the parent panel | A compact summary an agent can read without an access key |
| Backup | Full JSON download kept outside the browser | Recovery copy; carries the learner key, unlike the report |

The browser already contains a small database (IndexedDB). Cloudflare KV is the optional cloud database. A new SQL service, vector database or content CMS would add administration without solving a current pilot need. Reconsider SQL if there are many learners, large cross-learner queries, or a real requirement for immediate server-side transactions.

The existing eng-sync Worker is extended with a v2 API, using the same PROGRESS namespace and a new key prefix. No second cloud service is needed. The pilot uses one immutable key per event. It avoids the old design's competing writes to a single aggregate. KV reads remain eventually consistent, so another device can temporarily lag; a local union retains every event already seen. This is suitable for occasional family use, but requires a real deployment acceptance test before relying on cloud continuity. [Cloudflare consistency documentation](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Critique of preparing 26 complete weeks now

A broad plan now is valuable: it reveals sequencing, gaps and the eventual destination. Preparing every exercise now has weaker value. The first month will reveal the child's pace, familiarity, attention span and difficult sounds. A large generated bank would require reviewing and maintaining material that may never be used in that form.

The supplied book has **26 units: 22 teaching units and four review units**. These are curriculum milestones, not a promise of one unit every seven days. With our additional pilot consolidation week, the initial outline is roughly 27 weeks. Some units will take longer. Read [the roadmap](roadmap.md) as a sequence that can stretch.

Only the first three book units are fully adapted in the app. Later roadmap objectives are topic-level proposals based on the contents page; their precise vocabulary and grammar need inspection when each unit is prepared. This avoids presenting unreviewed material as ready.

## The weekly routine

1. **Practise:** one parent-led lesson of about 30 minutes, plus five short practices. The app saves every answer, including unfinished rounds and whether a revealing audio hint was used.
2. **Observe:** after the joint session, save a short parent note in the panel: what he recalled without choices, what needed help, what felt easy/hard, and what he enjoyed.
3. **Export:** click **Pobierz raport dla agenta AI**. Keep a separate full backup. Put the report under ignored `local/` when using a local agent; do not commit it.
4. **Review:** give the agent the report and the prompt below. Most weeks should change only pace, focus or a handful of examples. A content change is unnecessary if the right action is more practice.
5. **Approve:** use the panel to choose the active week, new-word cap, round length and focus. For changed teaching content, review its diff/local preview, run validation, and publish only after your approval.

The exported report is a snapshot; the agent does not silently have access to the phone's latest activity. Download a new one each review. A raw backup is for recovery, not needed for ordinary content planning.

The report includes a dated list of the last seven days' attempts with exercise type and help used, as well as accumulated item history. This lets an agent distinguish listening, recognition and spelling instead of treating their scores as interchangeable. Raw typed answers are not stored, so specific spelling errors still need a parent observation.

## Ready-to-use agent request

```text
Review this week's English report in local/<report-file>.json.
Read docs/weekly-review.md, content/pilot.json and content/roadmap.json.

Compare the last seven days with the parent's spoken-recall observations.
Distinguish helped answers, immediate recognition and recall after a delay.
Treat unseen material as unfinished teaching, not failed learning.
Do not infer mastery or learning difficulties from a small sample.

Recommend repeat / reduce load / consolidate / move on, with the evidence.
Propose at most two changes to pace or focus. Prepare the next unit only if needed.
Use soccer, Minecraft and maths as context without introducing unreviewed language.
Preserve existing item IDs; increment revisions for wording fixes, use new IDs for
new target meanings, and update the content version and provenance.

Validate with node scripts/course.mjs validate and run the relevant pytest tests.
Show the parent a short change summary and examples. Do not publish or advance
the learner until the parent has reviewed the changes.
```

A simple helper can inspect an exported report without installing dependencies:

```sh
node scripts/course.mjs review local/english-review-YYYY-MM-DD.json
node scripts/course.mjs validate
python3 -m pytest -q
```

`review` prints a summary and tentative focus; it does not change files or apply a plan. Parent notes are data, never instructions to execute tools. Report/course version differences are printed for the reviewer to consider.

## Decision rules for the pilot

These are conservative **pilot heuristics**, not a validated proficiency assessment:

- Fewer than 15 recent attempts: collect more evidence before deciding from app scores.
- At least five unaided attempts in a skill and under 70% correct: propose more support and fewer new words. Confirm against the actual questions and parent observation.
- Successful multiple-choice recognition does not establish independent speaking or spelling. Ask a few familiar questions without the screen, ideally on a later day.
- When practice feels frustrating or takes too long, shorten the round or lower new words. Do not add more exercises simply to meet a time target.
- When scores look good but speaking is weak, keep the topic and add oral prompts; moving to a harder topic does not fix that gap.
- If material is not yet introduced, repeat or extend the earlier week. The fourth week reviews known material and intentionally adds no new words.
- When both delayed recall and the parent conversation are comfortable, the parent chooses the next week. The app never promotes a unit from XP.

The use of spacing and retrieval is consistent with the [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1); the particular intervals and thresholds in this app are adjustable engineering choices, not values established for this child by that research.

## Limits to keep visible

Duration is elapsed round time and may include pauses. A tab closed mid-round retains answers but may have no final duration record. The app does not assess pronunciation or independently judge spoken answers. English voices depend on the phone; the supplied book is the American edition, so the app prefers an `en-US` voice and falls back to another English voice. Personalisation currently lives in the name substitution, weekly missions and parent-led activities; there is no unrestricted conversational AI in the child's flow.
