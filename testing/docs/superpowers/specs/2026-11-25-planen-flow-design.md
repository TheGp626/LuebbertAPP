# PLANEN: smooth flow from Auftrag to published week

Date: 2026-11-25 · Status: approved approach (option 1), design for review · Branch base: `main` (live app)

## Why

Daniel plans the week in Excel today. By New Year the week must be planned in the app instead, in PLANEN
(`js/planen.js` on top of the Besetzungsplaner data in `js/planer.js`). For that to happen, planning in the app has to be
at least as quick as his Excel sheet and must not lose track of what the Auftragsbestätigungen say.
The user's two concrete complaints: the sync between an Auftragsbestätigung and the plan is "meh", and creating an
Einsatz that has no Bestätigung in a project folder is too cumbersome.

Success: Daniel builds and publishes a whole week in PLANEN without Excel, on a computer, roughly as fast as before;
Bestätigungen and their later revisions show up in the plan by themselves; the crew side ("Ich kann", pushes) keeps
working as it does now.

## Goals

1. Every Auftrag phase with a date this week appears in PLANEN as soon as its Bestätigung is read, even before anyone
   has entered an MA number ("MA?" state instead of invisible).
2. A revised Bestätigung updates the plan entry (day, time, room, title, MA number) unless someone changed that field by
   hand; every such change is visible on the entry until someone looks at it. A cancelled or vanished Auftrag is flagged
   clearly, never deleted silently.
3. Entries without a Bestätigung are quick to create: one short form creates Aufbau and Abbau together; entries can be
   duplicated; a week can be prepared from the previous week's recurring entries.
4. Opening a week in PLANEN creates its draft automatically (no "Woche planen" tap) for whoever plans.
5. Whoever has the switch "Planung" may set MA numbers for Aufträge (not only PL/Admin).
6. Publishing happens inside PLANEN: one sheet with what changed and who gets a push, then done; no jump to the Wochenplan.
7. On a computer (wide screen), a compact table view of the week that reads like Daniel's Excel sheet
   (Tag | Was | Wann | Wer | PL), switchable with the board; editing still happens in the Einsatz sheet.

## Non-goals

- No spreadsheet-style cell editing (option 2 was rejected).
- No live editing without a draft (option 3 was rejected); draft → publish stays.
- No change to how the crew applies ("Ich kann", Vorbehalt), to `notify-plan-change`, or to the PDF upload path itself
  (it stays as a fallback while Daniel switches over).
- No server-side PDF parsing; Bestätigungen are still read in the browser when PLANEN opens (`ordParseNew`).

## Anti-goals (would make this a failure even if it works)

- A plan entry silently overwritten by a Bestätigung after Daniel corrected it by hand.
- An Auftrag that exists in a folder but never shows up in PLANEN.
- Pushes to the crew for half-finished drafts.
- Publishing that loses the existing safety checks of the import preview (diff against the stored week, name checks,
  rollback on a failed save).

## Constraints

- Vanilla JS PWA, no build step; global functions across files; bump `?v=` in `index.html` and `CACHE` in `sw.js`.
- Live database: every change as migration + rollback + check SQL in `supabase/`, dry-run on the testing DB first.
- Draft tables and RLS from `20261110_besetzungsplaner.sql`: draft rows are read by `plans_week()` or PL; PLs may only
  edit Auftrag rows they are AP of. "Planung" = `plans_week` = `plan_interest_viewer` (`20261204_planung_ein_schalter`).
- `order_slots()` (used by the Wochenplan for "Ich kann") must keep returning only phases with MA > 0.
- Today `order_slots()` inner-joins `order_staffing` and filters `needed > 0`: a phase without a number never reaches
  PLANEN. This is the root cause of goal 1.

## Approaches

1. **Make PLANEN Daniel-proof (chosen).** Keep draft → publish and the PLANEN board/sheet; remove every speed bump
   listed in the goals. Fits the New-Year deadline and Daniel's phone + computer use.
2. Excel clone: a spreadsheet grid as the main editor. Most familiar to Daniel, but a big build, poor on phones, and a
   second editor beside PLANEN. Rejected.
3. Edit the published plan live, no draft. Simplest model, but unfinished weeks become visible and pushes get noisy.
   Rejected.

## Design (decided)

### 1. Every Auftrag phase reaches PLANEN
- New RPC `planner_order_phases()` (security definer): same shape as `order_slots()` but `left join order_staffing`,
  no `needed > 0` filter (needed may be null), plus a `cancelled` flag where known; only for `plans_week()` or PL/Admin.
  `plRender` uses it instead of `wpLoadSlots()`; the Wochenplan keeps `order_slots()`.
- A row with `need` null shows the state "MA?" (amber bar, label "MA eintragen") on the board and in the day strip count
  as "?" (not as 0 open).

### 2. Auftrag sync with hand-edit protection
- New column `plan_draft_shifts.manual text[]`: names of fields a person changed by hand in the edit sheet
  (`date`, `wann`, `location`, `title`, `venue`, `need`). `plSaveSheet` adds every changed field to it.
- `plMergeSlots` compares day, time (`wann` built by `plWannText`), room/event (`location`), name (`title`) and MA number
  with the slot; fields not in `manual` are patched; differences in manual fields are kept but reported.
- New column `plan_draft_shifts.auftrag_changes jsonb`: list of `{field, from, to, at}` written by the merge; shown as a
  tag "Auftrag geändert" on the row and as readable lines in the sheet ("Zeit: 7:00 → 8:00", "laut Auftrag jetzt 8:00,
  von Hand 7:00 behalten"); a button "Gesehen" clears it.
- Vanished/cancelled Auftrag: today's `stale` flag becomes a red tag "Auftrag nicht mehr gültig" with "Eintrag löschen"
  and "Behalten" (behalten = becomes a free entry, `job_no` kept only as reference text in notes).

### 3. Quick Einsatz without Bestätigung
- "Neuer Eintrag" opens a short form: Ort, Was (one line), Aufbau Tag + Uhrzeit, optional Abbau Tag + Uhrzeit, MA,
  Art (Auftrag/Angebot/Intern/Bus). Saves one row for Aufbau and, when filled, one for Abbau (`wann` "Aufbau: 7 Uhr" /
  "Abbau: 22 Uhr"), linked by a shared `pair_id uuid` (new column) so the sheet can show "Abbau am Mi" and duplicate both.
- The full edit sheet (`plEditRow`) stays for everything else.
- "Duplizieren" in the sheet copies a row (or its pair) to another day of the week without people.
- "Woche vorbereiten" (menu): lists the free entries (no `job_no`) of the previous week; ticked ones are copied to the
  same weekdays, without people. Auftrag rows are never copied (they come from Bestätigungen).

### 4. Draft created on open
- `plRender`: when the week has no draft and the viewer `plCanPublish`, call `plStart()` directly (same seeding) instead
  of showing the empty state. A PL without the switch still sees the empty state (unchanged rule).

### 5. Planung may set MA numbers
- Migration: `order_staffing` insert/update policies also allow `plans_week()`. `pnNeed` enables the stepper for
  `ordCanEdit() || plCanPublish(plWho())`.

### 6. Publish inside PLANEN
- Factor the save part of `wpSaveImport` (`js/wochenplan.js`) into `wpCommitPlan(parsed, existing, opts)` without DOM
  access; the import preview keeps calling it for PDF uploads.
- `plPublish` builds `parsed` as today, computes `planDiff` against the stored week and opens a PLANEN sheet:
  counts of new/changed/removed entries, the list of people who will get a push, warnings from `planChecks`, and
  "Veröffentlichen". It calls `wpCommitPlan` with `afterSave = plAfterPublish`, stays in PLANEN and repaints with the
  new status. Draft rows always carry user ids, so the name-mapping step of the preview is not needed here.

### 7. Table view on wide screens
- From 900 px width a toggle "Tafel | Tabelle" in the PLANEN head (remembered per device in localStorage).
- Tabelle: one row per entry, grouped by day: Tag | Was (venue, title, details) | Wann | Wer (names with role, open
  places as "+2 MA") | PL | status bar colour; tapping a row opens the same Einsatz sheet. Read-only cells.

## Left to the builder

- Exact SQL of `planner_order_phases()` (copy of `order_slots()` with the changes above) and the RLS additions.
- How `manual` is filled for rows edited before the column exists (treat as empty).
- Wording of tags and toasts within the app's existing tone (German, sentence case, no ALL CAPS).
- Splitting the work into steps; each step shippable on its own, migrations first.
- Tests for the pure parts (merge with manual fields, pair creation, week preparation, publish diff summary).

## Calls made while writing (check these)

- Browsing ahead to a future week creates its draft too (it only holds that week's Aufträge; harmless, and it means
  Meldungen on Aufträge can be placed early).
- The push list in the publish sheet is an estimate made in the app (people on new or changed entries and people taken
  off); the server function `notify-plan-change` still decides who really gets one.
- "Woche vorbereiten" copies from the previous week only (no saved templates).
- A kept vanished Auftrag becomes a free entry rather than staying linked, so a later Bestätigung with the same number
  does not fight with it.
- The PDF upload stays as a fallback until Daniel has switched; removing it is a separate decision.
