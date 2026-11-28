# AppDev protocol (short design)

## Intent and why
Jenni asked (19.11.) for a protocol for every bit of app work, even half an hour, so the team has an overview.
Patryk's hours are billed as AL and must reach his Stundenzettel. Today that needs a normal crew protocol with all
the furniture/transport fields that do not apply. Goal: the normal protocol, with one extra Aktion "AppDev" that only
Patryk can choose, showing only what an app-work note needs. "Might change to something better" later: keep it small.

## Goals
- "AppDev" appears in the Aktion control only for Patryk's account.
- With AppDev chosen the form hides Logistik & Transport, Equipment & Gewerke, Fehlmengen and the ratings/attendance
  parts; the notes are relabelled "Was ist neu" / "Woran gearbeitet"; Personal stays (his own row: start, end, pause).
- Saving works as for every protocol: shift in his Stundenzettel (role AL), PL mail, change history, PDF.
- PDF for AppDev (look approved by Patryk via mockup, 28.11.): dark blue header band with teal stripe, logo, title
  "Entwicklungsprotokoll", subline "Arbeit an der Lübbert App · Version <short build id>". Header fields: Datum, Aktion,
  AL, PL only (no Ort, no Projekt-Nr.). Sections: "Arbeitszeit" table with columns Pos, Name, Zeit, Pause, Netto,
  Abgerechnet (the existing 3 h minimum shows in "Abgerechnet", no explanatory line), "Was ist neu in der App",
  "Woran ich gearbeitet habe" (plain bullet lists), then costs and the AL signature box. No Transport/Equipment sections.
  Mockup: https://claude.ai/artifact/CUrV21U8EAEfBPU3w4RnpJ (the real PDF uses jsPDF's built-in fonts, same layout).

## Non-goals
- No new table, no migration, no new edge function (`protocols.action` is free text).
- No Dashboard filtering of AppDev entries now; added only if Jenni finds them noisy.
- Nothing for other users or roles.

## Anti-goals (failure even if it "works")
- The crew protocol flow for everyone else changes in any way.
- An AppDev mail or PDF that talks about Aufbau, Material or Lieferung.

## Constraints
- `js/protokoll.js` (~2,800 lines) is wired into Dashboard, costs and mail; keep changes to a few guarded branches,
  as the existing Zusatzauftrag (`data.side`) branch does.
- Gating is UI-only (account id check): the database does not stop another account from saving that action text;
  accepted, as nothing secret is exposed by it.
- Bump `?v=` in `index.html` and `CACHE` in `sw.js`; tests via `tools/test.sh`; testing database first.

## Approaches considered
- A (chosen): normal protocol + AppDev action. Smallest; sync, mail, history, PDF come for free.
- B (rejected): separate "Entwicklung" table, screen and mail function. Isolated but duplicates mail and history code.
- C (rejected): plain protocol with a project "App-Entwicklung", no code. Shows all unwanted fields and a wrong PDF.

## Decisions made together
- Use the standard protocol with an Aktion "AppDev" for Patryk only (Patryk's idea).
- PDF keeps signature and costs.

## My calls (change if wrong)
- Gate by Patryk's `app_users.id` as a constant, not a new role/flag.
- Mail: only the Aktion text appears in subject and summary; the two notes show under the AppDev labels. Mail text otherwise unchanged.
- Hours still go through the normal AL rate; nothing special for billing.
- Tests: PDF/section-hiding branch tested like the existing `side` cases; mail wording unchanged so no new mail test beyond the label.

## Left to the builder
- Exact hiding mechanism for the sections (CSS class on the form vs. skipping render).
- Wording of the labels and PDF title.
- Whether the notes fields are reused (`prot-incidents`/`prot-feedback`) or a single text; reuse unless it breaks the mail.
