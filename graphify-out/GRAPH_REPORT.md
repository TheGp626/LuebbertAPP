# Graph Report - LuebbertAPP  (2026-11-25)

## Corpus Check
- 123 files · ~185,461 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .css 2)

## Summary
- 1773 nodes · 3923 edges · 97 communities (70 shown, 27 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 270 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9f32a475`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- planer.js
- wochenplan.js
- stundenzettel.js
- ordner.js
- mitarbeiter.js
- plan-parser.js
- auth.js
- material.js
- produkte.js
- dashboard.js
- auftraege.js
- app.js
- send-reminders/index.ts
- public.app_users
- protokoll.js
- public
- send-protocol-mail/index.ts
- pin.mjs
- admin.js
- saveProtDraft
- errors.js
- utils.js
- erinnerung.js
- cleanup-folders/index.ts
- renderWorkerShifts
- plRender
- public.planner_order_phases
- dashRenderWorkerMonth
- settings.js
- ui.js
- saveProtokoll
- fehler.js
- dashLoadMonthSummary
- renderDashMissing
- formulas.js
- order-slots.js
- 20261126_app_errors.sql
- renderDashWorkerList
- poll-plan-inbox/index.ts
- public.plan_cancellations
- protSaveArchive
- planen.js
- loadProtFromHistory
- renderProtPersonnel
- was drin ist
- dashNkJobHtml
- 20261030_ordner_auto_loeschen.sql
- order-parser.js
- pad
- Lübbert App
- manifest.json
- 20261119_material_abhaken.sql
- Lübbert App – live branch
- renderRoleRatesList
- public.pin_register_failure
- plan-pdf.js
- problem.js
- 20261110_besetzungsplaner.sql
- plSave
- sw.js
- changelog.js
- plan-ics.mjs
- public.plan_inbox
- saveDashProtEdit
- plText
- public.protocol_waivers
- supabase-config.js
- 20261105_shift_roles_typed.sql
- frage.js
- ask-shift/index.ts
- public.ask_log
- 20261123_unter_18.sql
- plSaveSheet
- public.department_mail_log
- plEditRow
- plForInsert
- 20261104_role_rls.sql
- 20261204_planung_ein_schalter.sql

## God Nodes (most connected - your core abstractions)
1. `saveProtDraft()` - 25 edges
2. `wpMe()` - 25 edges
3. `runDaily()` - 23 edges
4. `fetchShiftsNow()` - 21 edges
5. `openMaterialCheck()` - 18 edges
6. `calcProtCosts()` - 18 edges
7. `wpEsc()` - 18 edges
8. `_mcRender()` - 17 edges
9. `plRender()` - 17 edges
10. `renderProtPersonnel()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Task 7: Table view on wide screens` --references--> `pnTableHtml()`  [INFERRED]
  docs/superpowers/plans/2026-11-25-planen-flow.md → js/planen.js
- `Non-goals` --references--> `ordParseNew()`  [INFERRED]
  docs/superpowers/specs/2026-11-25-planen-flow-design.md → js/auftraege.js
- `Task 6: Publish inside PLANEN` --references--> `planDiff()`  [INFERRED]
  docs/superpowers/plans/2026-11-25-planen-flow.md → js/plan-parser.js
- `6. Publish inside PLANEN` --references--> `planDiff()`  [INFERRED]
  docs/superpowers/specs/2026-11-25-planen-flow-design.md → js/plan-parser.js
- `für entwickler` --references--> `planDiff()`  [INFERRED]
  README.md → js/plan-parser.js

## Import Cycles
- None detected.

## Communities (97 total, 27 thin omitted)

### Community 0 - "planer.js"
Cohesion: 0.14
Nodes (17): plAddDays(), plApplied(), plAppliedFor(), plBounds(), plDayShort(), plExportPdf(), plIso(), plMonday() (+9 more)

### Community 1 - "wochenplan.js"
Cohesion: 0.05
Nodes (100): PLANEN flow Implementation Plan, 6. Publish inside PLANEN, initWochenplan(), wpAddDays(), wpAskVorbehalt(), wpAvailCalendarHtml(), wpAvailDayHtml(), wpAvailGrid() (+92 more)

### Community 2 - "stundenzettel.js"
Cohesion: 0.06
Nodes (86): addShift(), buildDays(), buildWeekEntries(), calcDay(), calcTotal(), canEditSignedShifts(), clearShiftSig(), clearUnsyncedFlag() (+78 more)

### Community 3 - "ordner.js"
Cohesion: 0.06
Nodes (71): addEinsatzRow(), closeOrdnerDetail(), closeOrdnerForm(), collectOrdnerTreeIds(), createSubfolder(), deleteCurrentOrdner(), deleteOrdner(), deleteOrdnerFile() (+63 more)

### Community 4 - "mitarbeiter.js"
Cohesion: 0.07
Nodes (52): minorShiftIssues(), mitAddMonths(), mitAdminDeletePhoto(), mitAfterLogin(), mitAfterUserCreated(), mitAssign(), mitAssignTo(), mitAvatarInner() (+44 more)

### Community 5 - "plan-parser.js"
Cohesion: 0.07
Nodes (51): dashMergePlanPeople(), dashStartProtokollFromPlan(), RFC-5545, nextOwnShift(), planAliasKey(), planAlUserId(), planBandColor(), planBands() (+43 more)

### Community 6 - "auth.js"
Cohesion: 0.09
Nodes (48): allUsers, authPinMode(), authSessionChanged(), authStartState(), cachedOwnProfile(), closePinSheet(), confirmPinReset(), enforceUI() (+40 more)

### Community 7 - "material.js"
Cohesion: 0.11
Nodes (49): closeMaterialCheck(), mcBase(), mcButtonHtml(), mcCanOpen(), _mcCanWrite(), _mcEsc(), _mcFlush(), mcHasMaterial() (+41 more)

### Community 8 - "produkte.js"
Cohesion: 0.10
Nodes (46): aufbauDateiBarHtml(), aufbauDateiInlineHtml(), aufbauFileKind(), aufbauPageScale(), closeLightbox(), closeProduktForm(), closeProduktViewer(), contentTypeFor() (+38 more)

### Community 9 - "dashboard.js"
Cohesion: 0.10
Nodes (31): addDashPeShift(), addDashProtTransport(), dashboardCurrentShifts, dashboardProtocols, dashboardWorkers, dashClampPause(), dashMonthStats(), dashPePauseHint() (+23 more)

### Community 10 - "auftraege.js"
Cohesion: 0.08
Nodes (55): Anti-goals (would make this a failure even if it works), Approaches, Calls made while writing (check these), Constraints, Goals, Left to the builder, Non-goals, PLANEN: smooth flow from Auftrag to published week (+47 more)

### Community 11 - "app.js"
Cohesion: 0.09
Nodes (34): addDepartment(), applyTheme(), closeSettingsModal(), closeSigModal(), cycleTheme(), deleteDepartment(), deptLabel(), exitToMenu() (+26 more)

### Community 12 - "send-reminders/index.ts"
Cohesion: 0.11
Nodes (41): CORS, Db, Input, json(), runDaily(), runEvening(), runHoursCheck(), runTest() (+33 more)

### Community 13 - "public.app_users"
Cohesion: 0.09
Nodes (23): public.apply_app_settings(), public.apply_app_settings(), public.sees_plan_interest(), public.sees_plan_interest(), public.app_role(), public.app_user_private, public.user_directory(), public.apply_app_settings() (+15 more)

### Community 14 - "protokoll.js"
Cohesion: 0.10
Nodes (26): fetchAppUsers(), populateAlPlSelects(), protAddPhotos(), protDriverBusyCount(), protDriverSame(), protFilterScope(), protGuessVehicleType(), protIsMine() (+18 more)

### Community 15 - "public"
Cohesion: 0.11
Nodes (19): public.auth_user_set_display_name(), app_users_pl_guard, public.app_users_pl_guard(), app_users_pl_guard, public.app_users_pl_guard(), public.register_push_subscription(), public.renew_calendar_token(), public.shifts_booking_guard() (+11 more)

### Community 16 - "send-protocol-mail/index.ts"
Cohesion: 0.11
Nodes (33): AREA_LABELS, AREA_ORDER, buildDepartmentBody(), buildDepartmentSubject(), DEFAULT_ROUTES, DEPARTMENT_EMAIL_RE, departmentFeedback(), departmentRecipient() (+25 more)

### Community 17 - "pin.mjs"
Cohesion: 0.14
Nodes (24): CORS, json(), serverError(), CORS, json(), serverError(), CORS, json() (+16 more)

### Community 18 - "admin.js"
Cohesion: 0.16
Nodes (26): adminBindChart(), adminDelta(), _adminDeltaHtml(), adminFmtNum(), adminFourthKpiHtml(), adminHashFor(), _adminIsAdmin(), adminIsPatryk() (+18 more)

### Community 19 - "saveProtDraft"
Cohesion: 0.13
Nodes (29): addProtPersonnel(), addProtTransport(), calcProtCosts(), clearProtForm(), clearProtSig(), growProtText(), initProtokoll(), initProtSig() (+21 more)

### Community 20 - "errors.js"
Cohesion: 0.17
Nodes (23): breadcrumb(), deviceString(), _errEnqueue(), _errInit(), errorContextSnapshot(), errorFingerprint(), errQueuePut(), _errQueueRead() (+15 more)

### Community 21 - "utils.js"
Cohesion: 0.09
Nodes (9): canSeeCosts(), escapeHtml(), jsAttrArg(), pdfPatch(), pdfText(), safeNote(), shiftNetHours(), timeToMins() (+1 more)

### Community 22 - "erinnerung.js"
Cohesion: 0.21
Nodes (22): enablePushReminders(), erFolderProjectNo(), erJobForShift(), erPickFolder(), erPickJob(), erPickShift(), erPlanLocation(), erPlanShifts() (+14 more)

### Community 23 - "cleanup-folders/index.ts"
Cohesion: 0.11
Nodes (19): chunk(), dueFolderTrees(), hasUpcomingJob(), pathsNotIn(), storagePaths(), CORS, CORS, buildFolderPushes() (+11 more)

### Community 24 - "renderWorkerShifts"
Cohesion: 0.13
Nodes (21): addDashboardUser(), closeDashWorker(), closeEditWorker(), closeShiftEditModal(), dashEditPause(), dashRefreshRateUsers(), dashShiftSaveRole(), dashWorkerHeadHtml() (+13 more)

### Community 25 - "plRender"
Cohesion: 0.17
Nodes (20): 4. Draft created on open, plActive(), plAfterPublish(), plBox(), plCanOpen(), plCanPublish(), plDeleteRow(), plDeleteWeek() (+12 more)

### Community 26 - "public.planner_order_phases"
Cohesion: 0.17
Nodes (12): public.order_parsed, public.order_staffing, order_applications_decided, public.order_applications, public.order_applications_decided(), public.order_plan_links, public.order_slots(), einsaetze_job_no_idx (+4 more)

### Community 27 - "dashRenderWorkerMonth"
Cohesion: 0.17
Nodes (20): dashBees(), dashBillingCutoff(), dashCloseKeys(), dashEligible(), dashInactive(), dashIsNightShift(), dashMayBook(), dashNightRanking() (+12 more)

### Community 28 - "settings.js"
Cohesion: 0.21
Nodes (20): addVehicleRateRow(), appSetting(), appSettingsFromCache(), changedSettings(), loadAppSettings(), _readSettingsForm(), readVehicleRates(), renderSettingsTab() (+12 more)

### Community 29 - "ui.js"
Cohesion: 0.18
Nodes (12): closeUiMenu(), openTopbarMenu(), openUiMenu(), topbarMenuItems(), uiArg(), uiComboHtml(), uiComboMatches(), uiComboRender() (+4 more)

### Community 30 - "saveProtokoll"
Cohesion: 0.16
Nodes (19): buildProtPdfDoc(), getEffectivePersonnelRate(), pdfStr(), protApplySide(), protBasePos(), protCostLines(), protDriverCost(), protIncompleteNames() (+11 more)

### Community 31 - "fehler.js"
Cohesion: 0.27
Nodes (15): drawErrorsTab(), errorsBadgeCount(), _fehlerButtons(), _fehlerDate(), _fehlerErrorHtml(), fehlerJump(), _fehlerReportHtml(), _fehlerSetBadge() (+7 more)

### Community 32 - "dashLoadMonthSummary"
Cohesion: 0.17
Nodes (15): dashBillingRange(), dashBuildMonthWeeks(), dashCompressSigs(), dashDe(), dashDownload(), dashDrawMonth(), dashLoadMonthSummary(), dashMonthCsv() (+7 more)

### Community 33 - "renderDashMissing"
Cohesion: 0.20
Nodes (11): dashMayWaive(), dashUnwaiveMissing(), dashUserName(), dashWaiveMissing(), initDashboardRealtime(), loadDashMissing(), refreshDashboard(), refreshDashboardOnce() (+3 more)

### Community 34 - "formulas.js"
Cohesion: 0.21
Nodes (10): calcSplitShiftCosts(), calcTransportCost(), personCostRate(), personnelRate(), personPayRate(), personRoleRate(), protVehicleRates(), protVehicleTypes() (+2 more)

### Community 35 - "order-slots.js"
Cohesion: 0.25
Nodes (12): ordAssignedIds(), ordAttachSlots(), ordCanApply(), ordMatchSlot(), ordPhaseFits(), ordShiftRange(), ordSlotDate(), ordSlotVenue() (+4 more)

### Community 36 - "20261126_app_errors.sql"
Cohesion: 0.23
Nodes (9): app_errors_last_seen_idx, bug_reports_created_idx, public.app_error_rate, public.app_error_rate_ok(), public.app_error_users, public.app_errors, public.bug_reports, public.log_error() (+1 more)

### Community 37 - "renderDashWorkerList"
Cohesion: 0.20
Nodes (14): dashGroupLabel(), dashInactiveHtml(), dashIsFest(), dashMayManageStaff(), dashMayResetPin(), dashResetWorkerPin(), dashSelectedWorker(), dashWorkerList() (+6 more)

### Community 38 - "poll-plan-inbox/index.ts"
Cohesion: 0.15
Nodes (12): authPassed(), isPdf(), MAX_PDF_BYTES, parseAllowed(), pickPlanPdfs(), senderAllowed(), storagePath(), CORS (+4 more)

### Community 39 - "public.plan_cancellations"
Cohesion: 0.22
Nodes (10): plan_shift_interest_user_id_idx, public.plan_shift_interest, plan_shift_interest_decided, public.order_applications_decided(), plan_cancellations_decided, plan_cancellations_decided_by_idx, plan_cancellations_replacement_user_id_idx, plan_cancellations_user_id_idx (+2 more)

### Community 40 - "protSaveArchive"
Cohesion: 0.20
Nodes (15): deleteProtHistory(), mailProtokoll(), markProtMailed(), mergeProtHistory(), protArchiveShrink(), protKeepOnLogout(), protLogoutCleanup(), protRowToEntry() (+7 more)

### Community 41 - "planen.js"
Cohesion: 0.07
Nodes (54): Task 4: Quick Einsatz, duplicate, Woche vorbereiten, Task 5: Draft on open, Planung sets MA numbers, Task 6: Publish inside PLANEN, initPlanen(), pnAlertsHtml(), pnAsked(), pnAskRef(), pnAskTarget() (+46 more)

### Community 42 - "loadProtFromHistory"
Cohesion: 0.18
Nodes (15): loadProtDraft(), loadProtFromHistory(), protBasisValues(), protDraftBelongsTo(), protRemovePhoto(), protSectionStatus(), protSideOn(), renderProtPhotos() (+7 more)

### Community 43 - "renderProtPersonnel"
Cohesion: 0.21
Nodes (15): protAutoNight(), protClampPause(), protMinor(), protMinorWarnings(), protPauseHint(), protPauseHintText(), protPauseMin(), protPersonSummary() (+7 more)

### Community 44 - "was drin ist"
Cohesion: 0.17
Nodes (12): 🛡️ Admin-Seite (nur Admin), 🧩 Besetzungsplaner (testversion), 📊 Dashboard (AL, PL, Buchhaltung, Admin), 🔔 Erinnerungen, ⚙️ Optionen, 📦 Produktdatenbank, 📁 Projektordner, 📋 Protokoll (+4 more)

### Community 45 - "dashNkJobHtml"
Cohesion: 0.38
Nodes (7): dashNachkalk(), dashNkEuro(), dashNkHours(), dashNkJobHtml(), dashNkRowHtml(), dashNkTransportCost(), renderDashNachkalk()

### Community 47 - "order-parser.js"
Cohesion: 0.29
Nodes (5): orderDays(), orderIsBillingJob(), orderParse(), orderRange(), orderStripPhones()

### Community 48 - "pad"
Cohesion: 0.22
Nodes (10): currentWeekVal(), fmtDate(), fmtDateFull(), getBillingKeyForDate(), getBillingPeriodLabel(), getMondayFromWeekVal(), getMonthKeyFromWeek(), localDateStr() (+2 more)

### Community 49 - "Lübbert App"
Cohesion: 0.22
Nodes (9): loadLib(), needLib(), showToast(), easter egg, für entwickler, login, Lübbert App, sicherheit (+1 more)

### Community 50 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 51 - "20261119_material_abhaken.sql"
Cohesion: 0.27
Nodes (6): public.fits_plan_slot(), order_checks_plan_date_idx, order_checks_stamp, order_checks_updated_by_idx, public.order_check_mine(), public.order_checks

### Community 53 - "renderRoleRatesList"
Cohesion: 0.32
Nodes (8): addRoleRateRow(), dashRoleOptions(), dashRoleRowAuto(), dashSyncInternal(), openEditWorker(), removeRoleRateRow(), renderRoleRatesList(), updateRoleRateRow()

### Community 54 - "public.pin_register_failure"
Cohesion: 0.27
Nodes (7): app_users_sync_display_name, auth_user_set_display_name, public.app_users_sync_display_name(), public.login_names(), public.pin_lockouts, public.pin_register_failure(), public.pin_reset_log

### Community 55 - "plan-pdf.js"
Cohesion: 0.43
Nodes (6): _planApply(), _planHex(), _planMul(), _planReadPages(), _planShapes(), readPlanPdf()

### Community 56 - "problem.js"
Cohesion: 0.52
Nodes (6): buildProblemPayload(), closeProblemForm(), openProblemForm(), _problemSnapshot(), sendProblemForm(), toggleProblemTech()

### Community 58 - "20261110_besetzungsplaner.sql"
Cohesion: 0.33
Nodes (5): app_users_plans_week_guard, plan_draft_shifts_touch, public.plan_draft_shifts, public.plan_draft_weeks, public.plans_week()

### Community 59 - "plSave"
Cohesion: 0.17
Nodes (22): plAddPerson(), plCancelDone(), plCancelDrop(), plCandidates(), plDraftSync(), plMeldungSet(), plMeldungTargets(), plPickedRole() (+14 more)

### Community 60 - "sw.js"
Cohesion: 0.50
Nodes (3): assetUrlsOf(), LAZY_ASSETS, precache()

### Community 61 - "changelog.js"
Cohesion: 0.67
Nodes (3): CHANGELOG, showChangelogIfNew(), unseenChangelog()

### Community 62 - "plan-ics.mjs"
Cohesion: 0.17
Nodes (16): dedupeShifts(), parseToken(), windowStart(), CORS, RFC-5545, PLAN_WHEN_LABELS, planEventName(), planIcs() (+8 more)

### Community 64 - "public.plan_inbox"
Cohesion: 0.83
Nodes (3): plan_inbox_handled_by_idx, plan_inbox_status_idx, public.plan_inbox

### Community 65 - "saveDashProtEdit"
Cohesion: 0.11
Nodes (22): calcDashProtTotal(), closeDashProtEdit(), dashEditedHtml(), dashPaintPhotos(), dashPeNewShortBreaks(), dashReplaceRows(), dashResolvePerson(), dashShiftChanges() (+14 more)

### Community 66 - "plText"
Cohesion: 0.20
Nodes (15): Review Focus, Task 1: Migration `20261205_planen_flow`, Task 2: Every Auftrag phase reaches PLANEN ("MA?"), Task 3: Auftrag sync with hand-edit protection, Task 7: Table view on wide screens, 2. Auftrag sync with hand-edit protection, plKindOfColor(), plMergeSlots() (+7 more)

### Community 73 - "frage.js"
Cohesion: 0.70
Nodes (4): frageAnswer(), frageCheck(), frageMeldung(), frageShow()

### Community 87 - "ask-shift/index.ts"
Cohesion: 0.36
Nodes (6): askLabel(), askPush(), askRef(), MAX_ASKS_PER_HOUR, mayAsk(), CORS

### Community 88 - "public.ask_log"
Cohesion: 0.33
Nodes (7): ask_log_asked_by_idx, protocols_mark_edited, public.ask_log, public.protocols_mark_edited(), public.answer_ask(), public.ask_answers(), public.my_open_asks()

### Community 90 - "plSaveSheet"
Cohesion: 0.16
Nodes (18): plFilled(), plIsDriver(), plKind(), plKindTag(), plLines(), plManualAfter(), plOpenOther(), plOpenSlots() (+10 more)

### Community 91 - "public.department_mail_log"
Cohesion: 0.83
Nodes (3): department_mail_log_protocol_idx, department_mail_log_sent_at_idx, public.department_mail_log

### Community 92 - "plEditRow"
Cohesion: 0.20
Nodes (10): 1. Every Auftrag phase reaches PLANEN, 3. Quick Einsatz without Bestätigung, 5. Planung may set MA numbers, 7. Table view on wide screens, Design (decided), plCanEdit(), plCloseSheet(), plE() (+2 more)

### Community 93 - "plForInsert"
Cohesion: 0.67
Nodes (4): Global Constraints, plForInsert(), plWithout(), plWithoutKind()

## Knowledge Gaps
- **2 isolated node(s):** `RFC-5545`, `RFC-5545`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 240 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **27 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `planShiftFromDb()` connect `plan-parser.js` to `planen.js`, `wochenplan.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `RFC-5545`, `RFC-5545` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `planer.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14130434782608695 - nodes in this community are weakly interconnected._
- **Why does `dashStartProtokollFromPlan()` connect `plan-parser.js` to `dashboard.js`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Should `wochenplan.js` be split into smaller, more focused modules?**
  _Cohesion score 0.052650494159928125 - nodes in this community are weakly interconnected._
- **Why does `wpCommitPlan()` connect `wochenplan.js` to `planen.js`, `plan-parser.js`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Should `stundenzettel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06163401815575729 - nodes in this community are weakly interconnected._