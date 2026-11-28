# AppDev Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A protocol Aktion "AppDev", selectable only by Patryk's accounts, with a reduced form, an AppDev PDF and an AppDev mail wording; hours sync to the Stundenzettel through the normal protocol save.

**Architecture:** `protocols.action` is free text, so no migration. Guarded branches in `js/protokoll.js` (form and PDF) and `supabase/functions/send-protocol-mail/mail.mjs` (mail wording), modelled on the existing `side_of` (Zusatzauftrag) branches. Crew protocol behaviour for every other action stays untouched.

**Tech Stack:** Vanilla JS PWA (no build step), jsPDF, Deno edge function, `node --test` via `tools/test.sh`.

**Spec:** `docs/superpowers/specs/2026-11-28-appdev-protokoll-design.md` (PDF look mockup: https://claude.ai/artifact/CUrV21U8EAEfBPU3w4RnpJ)

## Global Constraints
- After changing a file bump its `?v=` in `index.html` and `CACHE` in `sw.js` (`stundenzettel-v290` today).
- Allowed accounts (constant, UI-only gate): live `4e71084c-4942-4565-ade5-974a0c3480f4`, testing `977135e4-9029-4efc-a778-33cae8f29237`.
- Action text is exactly `AppDev`. No new table, migration or edge function.
- 3 h minimum comes from `shiftNetHours({ von, bis, pause })` in `js/utils.js`; do not re-implement it.
- Mapping of the two notes: `incidents` = "Was ist neu in der App", `feedback` = "Woran ich gearbeitet habe"; `damages` is hidden for AppDev.
- Edge function changes go to the testing project (`bdbjimmmksjyqmvopklk`) only; live (`jbrvghmkftvnkjmyoigv`) only when the user asks.
- Work on branch `ccr-bc21f118-e8q1l3`; merging into `redesign` and `tools/publish.sh` only on the user's go.

## Review Focus
- Another user on the same phone finds a draft with action AppDev: the action falls back to `Aufbau`.
- A normal protocol (any other action, and Zusatzauftrag) renders and exports exactly as before.
- AppDev entry shorter than 3 h shows Netto below Abgerechnet; an entry over midnight (end < start) still counts.
- AppDev entry with no personnel row or without start/end: PDF still builds (no throw), shows "Keine Personaldaten."
- `mcPhaseOf('AppDev')` (Fehlmengen lookup) returns no phase and must not break the form.

---

### Task 1: Gate and Aktion option

**Files:**
- Modify: `js/protokoll.js` (near `PROT_ACTIONS`, line ~1370; `setProtAction`, `syncProtActionSeg`)
- Modify: `index.html` (Aktion segment and hidden select, lines ~180-196)
- Test: `tests/protokoll.test.js`

**Interfaces:**
- Produces: `PROT_APPDEV_USER_IDS` (array of the two ids), `protIsAppDev(action: string): boolean`, `protAppDevAllowed(userId: string|null): boolean`, `protApplyAppDevUi(): void` (shows or hides the AppDev button, resets an AppDev action to `Aufbau` when not allowed).

- [ ] **Step 1: Failing tests** `protIsAppDev('AppDev') === true`, `protIsAppDev('Aufbau') === false`; `protAppDevAllowed` true for both ids, false for `'x'` and `null`.
- [ ] **Step 2: Run** `node --test tests/protokoll.test.js`, expect FAIL (functions undefined).
- [ ] **Step 3: Implement** the helpers, add `<option value="AppDev" hidden>` and `<button data-value="AppDev" hidden onclick="setProtAction('AppDev')">AppDev</button>` in `index.html`; `protApplyAppDevUi` un-hides both for allowed `currentUser.id` and otherwise resets `#prot-action` to `Aufbau`. Call it from wherever the form is opened/loaded (same places that call `syncProtActionSeg()`).
- [ ] **Step 4: Run** the tests, expect PASS.
- [ ] **Step 5: Commit** `AppDev: Aktion nur fuer Patryk`.

### Task 2: Reduced form

**Files:**
- Modify: `js/protokoll.js` (`renderProtSectionNav`, `protCurrentStep`, `setProtAction`)
- Modify: `index.html` (ids on the notes labels, hide-able Mängel field)
- Test: `tests/protokoll.test.js`

**Interfaces:**
- Consumes: `protIsAppDev` (Task 1).
- Produces: `protVisibleSectionIds(action: string, side: boolean): string[]`, the one place that decides which of `PROT_SECTIONS` show (today duplicated in `renderProtSectionNav` and `protCurrentStep`).

- [ ] **Step 1: Failing tests** `protVisibleSectionIds('AppDev', false)` excludes `transport` and `equipment`, keeps `basis`, `personal`, `vorkommnisse`, `unterschrift`; `protVisibleSectionIds('Aufbau', false)` returns all; `protVisibleSectionIds('Aufbau', true)` equals today's side result (no `transport`, no `personal`).
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** `protVisibleSectionIds` and use it in both existing places. In `setProtAction` call `renderProtSectionNav()`. Add `protApplyAppDevLabels(on)` that, for AppDev, relabels the incidents field "Was ist neu in der App", the feedback field "Woran ich gearbeitet habe" and hides the damages field; restores the original labels otherwise. Call it from `setProtAction` and on form load.
- [ ] **Step 4: Run** `tools/test.sh`, expect green.
- [ ] **Step 5: Commit** `AppDev: reduziertes Formular`.

### Task 3: AppDev PDF

**Files:**
- Modify: `js/protokoll.js` (`buildProtPdfDoc`, line ~2636; add `protAppDevPdf`)
- Test: `tests/protokoll.test.js` (reuse `fakeDoc` as in the existing `buildProtPdfDoc` tests)

**Interfaces:**
- Consumes: `shiftNetHours`, `getAppVersion()` (`js/errors.js`), `entry.totalCost`.
- Produces: `protAppDevPdf(doc, data, entry, opts): jsPDF doc`, called from `buildProtPdfDoc` when `data.action === 'AppDev'`.

- [ ] **Step 1: Failing tests** with an AppDev entry (10:00-11:30, pause 0, notes set, totalCost '90,00 €'): texts contain `Entwicklungsprotokoll`, `Arbeitszeit`, `Was ist neu in der App`, `Woran ich gearbeitet habe`, `3,0 h` (Abgerechnet) and `1,5 h` (Netto), `Gesamtkosten`; texts do not contain `Ort:`, `Projekt-Nr.`, `Logistik`, `Equipment`. A second test: no personnel and no notes does not throw. A third: action `Aufbau` output is unchanged (still contains `Einsatzprotokoll` and `Logistik & Transport`).
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** `protAppDevPdf` per the spec's look: dark blue band (`setFillColor` 22,41,61) with teal stripe, logo, title, subline `Arbeit an der Lübbert App · Version <getAppVersion()>`; header fields Datum, Aktion, AL, PL; "Arbeitszeit" table (Pos, Name, Zeit, Pause, Netto, Abgerechnet) from `data.personnel`; the two notes as bullet lists (one bullet per non-empty line, skip `nein`/`—` placeholders); costs block only when `opts.costs !== false`, reusing the existing cost lines' total (`Gesamtkosten (geschätzt): <totalCost>`); AL signature as in the normal PDF. All strings through `pdfStr`.
- [ ] **Step 4: Run** the tests, expect PASS.
- [ ] **Step 5: Commit** `AppDev: PDF`.

### Task 4: AppDev mail wording

**Files:**
- Modify: `supabase/functions/send-protocol-mail/mail.mjs` (`sections`)
- Test: `supabase/functions/send-protocol-mail/mail.test.mjs`

**Interfaces:**
- Consumes: protocol row `p` with `p.action`, `p.notes_incidents`, `p.notes_feedback`.

- [ ] **Step 1: Failing tests** `buildBody({ action: 'AppDev', notes_incidents: 'A', notes_feedback: 'B', ... })` contains the headings `Was ist neu in der App` and `Woran ich gearbeitet habe`, and not `Besondere Vorkommnisse` or `Feedback Location`; a protocol with action `Aufbau` keeps the old headings.
- [ ] **Step 2: Run** `node --test supabase/functions/send-protocol-mail/mail.test.mjs`, expect FAIL.
- [ ] **Step 3: Implement** the branch in `sections(p)` for `p.action === 'AppDev'` (no gewerke, no Fehlmengen, no damages, no ratings).
- [ ] **Step 4: Run** the test, expect PASS.
- [ ] **Step 5: Deploy** the function to the testing project only; commit `AppDev: Mail-Text`.

### Task 5: Release prep

**Files:**
- Modify: `index.html`, `sw.js` (version bumps for every changed JS file and `CACHE`)

- [ ] **Step 1:** Bump `?v=` of `js/protokoll.js` in `index.html` and `CACHE` in `sw.js`.
- [ ] **Step 2:** Run `tools/test.sh`, expect one green line.
- [ ] **Step 3:** Run `node tools/ui-check.js Admin` steps for opening the protocol form with fake data (text output only); confirm no page errors.
- [ ] **Step 4:** `graphify update .`, commit, push to `ccr-bc21f118-e8q1l3`; then ask the user whether to merge into `redesign` and publish.
