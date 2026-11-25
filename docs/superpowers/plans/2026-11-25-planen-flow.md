# PLANEN flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daniel can build and publish a whole week in PLANEN, with Bestätigungen and their revisions flowing in by themselves.

**Architecture:** One migration adds a planner-only phase source and three draft columns; the pure merge/creation helpers in `js/planer.js` / `js/planen.js` get the logic (tested with `node --test`); `js/planen.js` paints the new states, sheets and the table view; the save half of `wpSaveImport` becomes `wpCommitPlan` so PLANEN publishes in place.

**Tech Stack:** Vanilla JS (globals, no build), Supabase Postgres + RLS, node:test with vm contexts.

**Spec:** `docs/superpowers/specs/2026-11-25-planen-flow-design.md`

## Global Constraints

- Bump `?v=` of every changed file in `index.html` (only once per file on this branch) and keep `CACHE` in `sw.js` bumped.
- Every DB change: `supabase/migrations/20261205_planen_flow.sql` + `supabase/rollback/20261205_planen_flow_rollback.sql` + `supabase/tests/planen_flow_check.sql`, dry-run on testing DB `bdbjimmmksjyqmvopklk` inside a rolled-back transaction. Never touch the live DB here.
- `order_slots()` stays unchanged (Wochenplan „Ich kann“ needs MA > 0).
- Client code must keep working before the migration is applied (fall back to `order_slots()`, skip missing columns via `plForInsert`/`plWithout`).
- German UI copy, sentence case, no ALL CAPS.

## Review Focus

1. A Bestätigung revised after Daniel edited the time by hand: his time stays, the new one is reported, never silently applied.
2. `need` null (no MA number yet): every count (`plFilled`, `pnOpenCount`, publish open slots) treats it as 0 open, shown as "MA?", never NaN.
3. Draft rows loaded before the new columns exist (`manual`/`auftrag_changes`/`pair_id` missing): merge and paint must not throw.
4. Publishing from PLANEN after someone else published meanwhile: the existing version check of the commit refuses, no double week.
5. Quick Einsatz with Abbau before Aufbau or Abbau day outside the week: refused with a message.

---

### Task 1: Migration `20261205_planen_flow`

**Files:** Create the three SQL files named in Global Constraints.

- `public.planner_order_phases()`: copy of the latest `order_slots()` (`20261109_einsatz_auftrag.sql`) with `left join public.order_staffing`, no `ph.nd > 0` condition, and a guard `where (select public.plans_week()) or (select public.app_role()) in ('PL', 'Admin')`; same return columns; `revoke all … from public, anon; grant execute … to authenticated`.
- `plan_draft_shifts`: `manual text[] not null default '{}'`, `auftrag_changes jsonb`, `pair_id uuid`.
- `order_staffing` insert/update policies: also `(select public.plans_week())`.
- Check SQL: a phase without `order_staffing` row is returned for a planner and not for an MA; `order_slots()` still hides it; planner can upsert `order_staffing`.
- [ ] Write files · [ ] dry-run migration + check + rollback on testing DB → `all_ok` · [ ] commit.

### Task 2: Every Auftrag phase reaches PLANEN ("MA?")

**Files:** `js/planer.js` (`plRender`, `plRowFromSlot`, `plMergeSlots`), `js/planen.js` (`pnRowState`, `pnDays`, strip/row), tests `tests/planer.test.js`, `tests/planen.test.js`.

**Interfaces:** Produces `plLoadPhases(): Promise<slot[]|null>` (RPC `planner_order_phases`, falls back to `wpLoadSlots()` on error). `pnRowState` returns `'unknown'` for `need == null`.

- [ ] Tests: `plRowFromSlot(slot({needed:null}))` → `need === null`; `pnRowState(row({need:null}))` → `'unknown'`; `pnDays` with a `need:null` row → `open` counts it as 0 and day gets `unknown: 1`.
- [ ] Implement; strip shows `?` when a day has unknown rows and no open; row shows "MA?" count and amber bar.
- [ ] Full suite green · commit.

### Task 3: Auftrag sync with hand-edit protection

**Files:** `js/planer.js` (`plMergeSlots`, `plSaveSheet`, `plSyncSlots`), `js/planen.js` (sheet: changes block, "Gesehen", stale block), tests.

**Interfaces:** `plMergeSlots(rows, slots, week, users)` patches now may contain `date, wann, location, title, need, auftrag_changes`; `plSlotFields(slot, week, users) → {date, wann, location, title, need}` (pure, shared with `plRowFromSlot`).

- [ ] Tests: slot time 07:00→08:00, row not manual → patch `wann` + `auftrag_changes` entry `{field:'wann', from, to}`; same with `manual:['wann']` → no `wann` patch, change entry with `kept:true`; unchanged slot → no patch; row without `manual` key → treated as `[]`.
- [ ] `plSaveSheet` adds changed field names to `manual` (only when the column exists: `plState.hasManual`).
- [ ] Sheet: lines "Zeit: 07:00 → 08:00" / "laut Auftrag jetzt …, von Hand … behalten", button "Gesehen" → `plSave(row, {auftrag_changes: null})`; row tag "Auftrag geändert". Stale: red block with "Eintrag löschen" (`plDeleteRow`) and "Behalten" (`plSave(row, {job_no: null, phase: null, notes: 'Auftrag <no> (nicht mehr gültig)\n' + notes})`).
- [ ] Suite green · commit.

### Task 4: Quick Einsatz, duplicate, Woche vorbereiten

**Files:** `js/planen.js`, tests `tests/planen.test.js`.

**Interfaces:** `pnQuickRows(form, week) → {rows: row[]} | {error: string}` with form `{venue, was, kind, need, setupDate, setupTime, teardownDate, teardownTime}`; `pnCopyRows(rows, fromWeek, toWeek) → row[]` (free rows only, same weekday, people `[]`, new `pair_id` per copied pair).

- [ ] Tests: setup only → 1 row `wann 'Aufbau: 7 Uhr'`; with teardown → 2 rows same `pair_id`, teardown `wann 'Abbau: 22 Uhr'`; teardown before setup → error; date outside week → error; `pnCopyRows` skips `job_no` rows, moves dates by 7 days, empties people.
- [ ] UI: "Neuer Eintrag" opens quick form sheet (`pnQuickOpen`), "Alle Felder" link to `plEditRow(null)`; sheet button "Duplizieren" (day select); menu "Woche vorbereiten" (checkbox list of last week's free rows).
- [ ] Suite green · commit.

### Task 5: Draft on open, Planung sets MA numbers

**Files:** `js/planen.js` (`pnPaint`, `pnNeed`), `js/planer.js` (`plRender`).

- [ ] When `!st.draft && plCanPublish(who)` and the week has no uploaded plan → `plStart()` once per week per load (guard against loops).
- [ ] Stepper enabled for Auftrag rows when `ordCanEdit() || plCanPublish(plWho())`.
- [ ] Suite green · commit.

### Task 6: Publish inside PLANEN

**Files:** `js/wochenplan.js` (extract `wpCommitPlan(imp) → Promise<weekId|null>` from `wpSaveImport`, DOM-free; `wpSaveImport` reads the name selects then calls it), `js/planer.js` (`plPublish`), `js/planen.js` (`pnPublishSheet`), tests `tests/planen.test.js` for `pnPublishSummary`.

**Interfaces:** `pnPublishSummary(diffStatus, parsed, existing) → {neu, geaendert, entfernt, people: string[]}`.

- [ ] Test `pnPublishSummary` with a `planDiff` result (counts and names of people on new/changed shifts plus removed people).
- [ ] Refactor; PDF upload path still works (existing wochenplan tests green).
- [ ] `plPublish` opens the sheet (counts, push list, `planChecks` warnings, "Veröffentlichen"), commits via `wpCommitPlan`, runs `plAfterPublish`, toasts "KW n veröffentlicht", stays in PLANEN.
- [ ] Suite green · commit.

### Task 7: Table view on wide screens

**Files:** `js/planen.js` (`pnTableHtml`, toggle in head, localStorage key `luebbert_pn_view`), `css/ui.css`.

- [ ] Toggle shown from 900 px; table rows open `pnOpen(id)`; Wer shows names with role and "+2 MA" for open places.
- [ ] Visual check light/dark at 1280 px; suite green · commit.
