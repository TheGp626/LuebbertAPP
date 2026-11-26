# Graph Report - LuebbertAPP  (2026-11-26)

## Corpus Check
- 132 files · ~198,345 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: .css 3, (none) 2)

## Summary
- 1906 nodes · 4210 edges · 104 communities (79 shown, 25 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 296 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a37d6083`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- planer.js
- Weekly Plan View
- Timesheet Shifts
- Project Folders
- Employee Management
- Plan Parsing Helpers
- PIN Authentication
- Material Checklist
- Product Catalog Media
- Job Orders Board
- Shared Utilities
- App Settings Schema
- App Shell Settings
- plSave
- Reminder Edge Function
- Protocol Form Helpers
- Push Subscriptions RLS
- Department Mail Routing
- PIN Login Functions
- Admin KPI Dashboard
- Monthly Billing Summary
- Error Logging Client
- saveProtDraft
- Dashboard Protocol Editing
- Push Reminder Setup
- Push Notification Functions
- Settings Tab
- renderProtSectionNav
- plan-ics.mjs
- Order Staffing Schema
- Today Overview
- Error Inbox Tab
- UI Menus Combobox
- Dashboard Worker Admin
- My Shifts View
- Post-Calculation Reports
- Cost Formulas
- App Navigation
- Order Slot Matching
- Error Reports Schema
- Worker List Management
- Plan Inbox Polling
- Shift Interest Cancellations
- Protocol History Sync
- ask-shift/index.ts
- buildProtPdfDoc
- planen.js
- On-Site Plans
- Protocols Schema
- Order Text Parser
- PWA Manifest
- Plan Shifts Checks Schema
- calcProtCosts
- Auth Display Names
- Worker Role Rates
- Monthly PDF Export
- View-As Role Switch
- Plan PDF Reader
- Protocol Shift Picker
- Problem Report Form
- Draft Plan Schema
- Service Worker Cache
- Changelog Popup
- loadProtDraft
- plPlace
- was drin ist
- Plan Inbox Schema
- plRender
- Role RLS Policies
- Protocol Waivers Schema
- Supabase Client Config
- Shift Role Backup
- plSaveSheet
- plToParsed
- pad
- Lübbert App
- 20261204_planung_ein_schalter.sql
- dashboard.js
- loadDashInsights
- Lübbert App
- public.ask_log
- frage.js
- public.shifts_self_entry_guard
- plOpenOther
- debug-input.mjs

## God Nodes (most connected - your core abstractions)
1. `saveProtDraft()` - 26 edges
2. `wpMe()` - 25 edges
3. `runDaily()` - 23 edges
4. `fetchShiftsNow()` - 21 edges
5. `saveProtokoll()` - 20 edges
6. `wpEsc()` - 18 edges
7. `calcProtCosts()` - 18 edges
8. `openMaterialCheck()` - 18 edges
9. `renderProtPersonnel()` - 17 edges
10. `plRender()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Task 7: Table view on wide screens` --references--> `pnTableHtml()`  [INFERRED]
  docs/superpowers/plans/2026-11-25-planen-flow.md → js/planen.js
- `Task 6: Publish inside PLANEN` --references--> `wpCommitPlan()`  [INFERRED]
  docs/superpowers/plans/2026-11-25-planen-flow.md → js/wochenplan.js
- `Task 2: Every Auftrag phase reaches PLANEN ("MA?")` --references--> `wpLoadSlots()`  [INFERRED]
  docs/superpowers/plans/2026-11-25-planen-flow.md → js/wochenplan.js
- `1. Every Auftrag phase reaches PLANEN` --references--> `wpLoadSlots()`  [INFERRED]
  docs/superpowers/specs/2026-11-25-planen-flow-design.md → js/wochenplan.js
- `Task 6: Publish inside PLANEN` --references--> `wpSaveImport()`  [INFERRED]
  docs/superpowers/plans/2026-11-25-planen-flow.md → js/wochenplan.js

## Import Cycles
- None detected.

## Communities (104 total, 25 thin omitted)

### Community 0 - "planer.js"
Cohesion: 0.15
Nodes (16): plAddDays(), plApplied(), plAppliedFor(), plBounds(), plDayShort(), plIso(), plMonday(), plNavHtml() (+8 more)

### Community 1 - "Weekly Plan View"
Cohesion: 0.05
Nodes (101): PLANEN flow Implementation Plan, 6. Publish inside PLANEN, initWochenplan(), wpAddDays(), wpAskVorbehalt(), wpAvailCalendarHtml(), wpAvailDayHtml(), wpAvailGrid() (+93 more)

### Community 2 - "Timesheet Shifts"
Cohesion: 0.06
Nodes (89): addShift(), buildDays(), buildWeekEntries(), calcDay(), calcTotal(), canEditSignedShifts(), clearShiftSig(), clearUnsyncedFlag() (+81 more)

### Community 3 - "Project Folders"
Cohesion: 0.06
Nodes (77): addEinsatzRow(), closeOrdnerDetail(), closeOrdnerForm(), collectOrdnerTreeIds(), createSubfolder(), deleteCurrentOrdner(), deleteOrdner(), deleteOrdnerFile() (+69 more)

### Community 4 - "Employee Management"
Cohesion: 0.07
Nodes (52): minorShiftIssues(), mitAddMonths(), mitAdminDeletePhoto(), mitAfterLogin(), mitAfterUserCreated(), mitAssign(), mitAssignTo(), mitAvatarInner() (+44 more)

### Community 5 - "Plan Parsing Helpers"
Cohesion: 0.07
Nodes (51): dashMergePlanPeople(), dashStartProtokollFromPlan(), RFC-5545, nextOwnShift(), planAliasKey(), planAlUserId(), planBandColor(), planBands() (+43 more)

### Community 6 - "PIN Authentication"
Cohesion: 0.09
Nodes (48): allUsers, authPinMode(), authSessionChanged(), authStartState(), cachedOwnProfile(), closePinSheet(), confirmPinReset(), enforceUI() (+40 more)

### Community 7 - "Material Checklist"
Cohesion: 0.11
Nodes (49): closeMaterialCheck(), mcBase(), mcButtonHtml(), mcCanOpen(), _mcCanWrite(), _mcEsc(), _mcFlush(), mcHasMaterial() (+41 more)

### Community 8 - "Product Catalog Media"
Cohesion: 0.10
Nodes (46): aufbauDateiBarHtml(), aufbauDateiInlineHtml(), aufbauFileKind(), aufbauPageScale(), closeLightbox(), closeProduktForm(), closeProduktViewer(), contentTypeFor() (+38 more)

### Community 9 - "Job Orders Board"
Cohesion: 0.08
Nodes (55): Anti-goals (would make this a failure even if it works), Approaches, Calls made while writing (check these), Constraints, Goals, Left to the builder, Non-goals, PLANEN: smooth flow from Auftrag to published week (+47 more)

### Community 10 - "Shared Utilities"
Cohesion: 0.09
Nodes (9): canSeeCosts(), escapeHtml(), jsAttrArg(), pdfPatch(), pdfText(), safeNote(), shiftNetHours(), timeToMins() (+1 more)

### Community 11 - "App Settings Schema"
Cohesion: 0.08
Nodes (26): public.apply_app_settings(), public.apply_app_settings(), public.folder_deletion_log, public.apply_app_settings(), public.sees_plan_interest(), public.sees_plan_interest(), public.app_role(), public.app_user_private (+18 more)

### Community 12 - "App Shell Settings"
Cohesion: 0.09
Nodes (34): addDepartment(), applyTheme(), closeSettingsModal(), closeSigModal(), cycleTheme(), deleteDepartment(), deptLabel(), exitToMenu() (+26 more)

### Community 13 - "plSave"
Cohesion: 0.15
Nodes (21): 1. Every Auftrag phase reaches PLANEN, 3. Quick Einsatz without Bestätigung, 4. Draft created on open, 5. Planung may set MA numbers, 7. Table view on wide screens, Design (decided), plAfterPublish(), plCanEdit() (+13 more)

### Community 14 - "Reminder Edge Function"
Cohesion: 0.13
Nodes (38): CORS, Db, Input, json(), runDaily(), runEvening(), runHoursCheck(), runTest() (+30 more)

### Community 15 - "Protocol Form Helpers"
Cohesion: 0.09
Nodes (28): onProtDriverName(), protAddPhotos(), protDriverBusyCount(), protDriverHint(), protDriverSame(), protFilterScope(), protGuessVehicleType(), protIsMine() (+20 more)

### Community 16 - "Push Subscriptions RLS"
Cohesion: 0.11
Nodes (18): public.auth_user_set_display_name(), app_users_pl_guard, public.app_users_pl_guard(), app_users_pl_guard, public.app_users_pl_guard(), public.register_push_subscription(), public.renew_calendar_token(), public.shifts_booking_guard() (+10 more)

### Community 17 - "Department Mail Routing"
Cohesion: 0.09
Nodes (37): AREA_LABELS, AREA_ORDER, buildDepartmentBody(), buildDepartmentSubject(), DEFAULT_ROUTES, DEPARTMENT_EMAIL_RE, departmentFeedback(), departmentRecipient() (+29 more)

### Community 18 - "PIN Login Functions"
Cohesion: 0.14
Nodes (24): CORS, json(), serverError(), CORS, json(), serverError(), CORS, json() (+16 more)

### Community 19 - "Admin KPI Dashboard"
Cohesion: 0.16
Nodes (26): adminBindChart(), adminDelta(), _adminDeltaHtml(), adminFmtNum(), adminFourthKpiHtml(), adminHashFor(), _adminIsAdmin(), adminIsPatryk() (+18 more)

### Community 20 - "Monthly Billing Summary"
Cohesion: 0.18
Nodes (21): dashBillingCutoff(), dashBillingRange(), dashBookMonth(), dashCloseKeys(), dashLoadMonthSummary(), dashMayApprove(), dashMayBook(), dashMonthSummary() (+13 more)

### Community 21 - "Error Logging Client"
Cohesion: 0.17
Nodes (23): breadcrumb(), deviceString(), _errEnqueue(), _errInit(), errorContextSnapshot(), errorFingerprint(), errQueuePut(), _errQueueRead() (+15 more)

### Community 22 - "saveProtDraft"
Cohesion: 0.16
Nodes (19): addProtPersonnel(), addProtTransport(), clearProtForm(), clearProtSig(), growProtText(), initProtokoll(), initProtSig(), onProtPersonnelName() (+11 more)

### Community 23 - "Dashboard Protocol Editing"
Cohesion: 0.09
Nodes (27): calcDashProtTotal(), closeDashProtEdit(), dashEditedHtml(), dashNkTransportCost(), dashPaintPhotos(), dashPeNewShortBreaks(), dashReplaceRows(), dashResolvePerson() (+19 more)

### Community 24 - "Push Reminder Setup"
Cohesion: 0.21
Nodes (22): enablePushReminders(), erFolderProjectNo(), erJobForShift(), erPickFolder(), erPickJob(), erPickShift(), erPlanLocation(), erPlanShifts() (+14 more)

### Community 25 - "Push Notification Functions"
Cohesion: 0.11
Nodes (19): chunk(), dueFolderTrees(), hasUpcomingJob(), pathsNotIn(), storagePaths(), CORS, CORS, buildFolderPushes() (+11 more)

### Community 26 - "Settings Tab"
Cohesion: 0.18
Nodes (25): addVehicleRateRow(), appSetting(), appSettingsFromCache(), changedSettings(), loadAppSettings(), _readSettingsForm(), readVehicleRates(), renderSettingsTab() (+17 more)

### Community 27 - "renderProtSectionNav"
Cohesion: 0.13
Nodes (21): protApplySide(), protApplyStep(), protBasisValues(), protCurrentStep(), protFindDuplicate(), protGoStep(), protIncompleteNames(), protLongerThanAl() (+13 more)

### Community 28 - "plan-ics.mjs"
Cohesion: 0.17
Nodes (16): dedupeShifts(), parseToken(), windowStart(), CORS, RFC-5545, PLAN_WHEN_LABELS, planEventName(), planIcs() (+8 more)

### Community 29 - "Order Staffing Schema"
Cohesion: 0.17
Nodes (12): public.order_parsed, public.order_staffing, order_applications_decided, public.order_applications, public.order_applications_decided(), public.order_plan_links, public.order_slots(), einsaetze_job_no_idx (+4 more)

### Community 30 - "Today Overview"
Cohesion: 0.23
Nodes (18): heuteAddDays(), heuteCount(), heuteDm(), heuteEuro(), heuteMissingHourDays(), heuteMonday(), heuteMonthModel(), heuteOpenSlotCount() (+10 more)

### Community 31 - "Error Inbox Tab"
Cohesion: 0.22
Nodes (18): autoResolveCandidates(), drawErrorsTab(), errorsBadgeCount(), fehlerAutoResolve(), _fehlerButtons(), _fehlerDate(), _fehlerErrorHtml(), fehlerJump() (+10 more)

### Community 32 - "UI Menus Combobox"
Cohesion: 0.18
Nodes (12): closeUiMenu(), openTopbarMenu(), openUiMenu(), topbarMenuItems(), uiArg(), uiComboHtml(), uiComboMatches(), uiComboRender() (+4 more)

### Community 33 - "Dashboard Worker Admin"
Cohesion: 0.16
Nodes (17): addDashboardUser(), approveShifts(), closeDashWorker(), closeEditWorker(), dashRefreshRateUsers(), dashWorkerHeadHtml(), deactivateWorker(), ensureRateUsers() (+9 more)

### Community 34 - "My Shifts View"
Cohesion: 0.27
Nodes (15): meineAddMonths(), meineCutoff(), meineDayLabel(), meineEsc(), meineHours(), meineLinkRows(), meineNetMins(), meinePdf() (+7 more)

### Community 35 - "Post-Calculation Reports"
Cohesion: 0.16
Nodes (15): dashMonthStats(), dashNachkalk(), dashNkEuro(), dashNkHours(), dashNkJobHtml(), dashNkRowHtml(), dashProtMatches(), dashProtToEntry() (+7 more)

### Community 36 - "Cost Formulas"
Cohesion: 0.20
Nodes (14): agencyRate(), autoInternalRate(), calcSplitShiftCosts(), addBucket(), calcTransportCost(), employerCharge(), personCostRate(), personnelRate() (+6 more)

### Community 37 - "App Navigation"
Cohesion: 0.25
Nodes (12): navActiveSection(), navActiveTab(), navCurrentView(), navGo(), navHubPaint(), navHubSections(), navIcon(), navOpen() (+4 more)

### Community 38 - "Order Slot Matching"
Cohesion: 0.25
Nodes (12): ordAssignedIds(), ordAttachSlots(), ordCanApply(), ordMatchSlot(), ordPhaseFits(), ordShiftRange(), ordSlotDate(), ordSlotVenue() (+4 more)

### Community 39 - "Error Reports Schema"
Cohesion: 0.23
Nodes (9): app_errors_last_seen_idx, bug_reports_created_idx, public.app_error_rate, public.app_error_rate_ok(), public.app_error_users, public.app_errors, public.bug_reports, public.log_error() (+1 more)

### Community 40 - "Worker List Management"
Cohesion: 0.20
Nodes (14): dashGroupLabel(), dashInactiveHtml(), dashIsFest(), dashMayManageStaff(), dashMayResetPin(), dashResetWorkerPin(), dashSelectedWorker(), dashWorkerList() (+6 more)

### Community 41 - "Plan Inbox Polling"
Cohesion: 0.22
Nodes (8): authPassed(), isPdf(), MAX_PDF_BYTES, parseAllowed(), pickPlanPdfs(), senderAllowed(), storagePath(), CORS

### Community 42 - "Shift Interest Cancellations"
Cohesion: 0.22
Nodes (10): plan_shift_interest_user_id_idx, public.plan_shift_interest, plan_shift_interest_decided, public.order_applications_decided(), plan_cancellations_decided, plan_cancellations_decided_by_idx, plan_cancellations_replacement_user_id_idx, plan_cancellations_user_id_idx (+2 more)

### Community 43 - "Protocol History Sync"
Cohesion: 0.24
Nodes (13): deleteProtHistory(), mailProtokoll(), markProtMailed(), mergeProtHistory(), protArchiveShrink(), protRowToEntry(), protSaveArchive(), renderProtHistory() (+5 more)

### Community 44 - "ask-shift/index.ts"
Cohesion: 0.36
Nodes (6): askLabel(), askPush(), askRef(), MAX_ASKS_PER_HOUR, mayAsk(), CORS

### Community 45 - "buildProtPdfDoc"
Cohesion: 0.27
Nodes (12): buildProtPdfDoc(), getEffectivePersonnelRate(), pdfStr(), protBasePos(), protCostLines(), protDriverCost(), protJobNo(), protJobNoValid() (+4 more)

### Community 46 - "planen.js"
Cohesion: 0.07
Nodes (54): Task 4: Quick Einsatz, duplicate, Woche vorbereiten, Task 5: Draft on open, Planung sets MA numbers, Task 6: Publish inside PLANEN, initPlanen(), pnAlertsHtml(), pnAsked(), pnAskRef(), pnAskTarget() (+46 more)

### Community 47 - "On-Site Plans"
Cohesion: 0.33
Nodes (10): voBlockHtml(), voEsc(), voFill(), voFind(), voFolderTree(), voOpenPlan(), voOpenPlans(), voPickFolder() (+2 more)

### Community 48 - "Protocols Schema"
Cohesion: 0.16
Nodes (9): protocols_job_no_idx, protocols_side_of_idx, public.shifts_side_guard(), shifts_side_guard, department_mail_log_protocol_idx, department_mail_log_sent_at_idx, public.department_mail_log, public.shifts_overlap_guard() (+1 more)

### Community 49 - "Order Text Parser"
Cohesion: 0.29
Nodes (5): orderDays(), orderIsBillingJob(), orderParse(), orderRange(), orderStripPhones()

### Community 50 - "PWA Manifest"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 51 - "Plan Shifts Checks Schema"
Cohesion: 0.27
Nodes (6): public.fits_plan_slot(), order_checks_plan_date_idx, order_checks_stamp, order_checks_updated_by_idx, public.order_check_mine(), public.order_checks

### Community 52 - "calcProtCosts"
Cohesion: 0.15
Nodes (24): calcProtCosts(), fetchAppUsers(), openProtCostSheet(), protApplyPlanPersonnel(), protApplyPlanTransports(), protAutoNight(), protClampPause(), protPauseHint() (+16 more)

### Community 53 - "Auth Display Names"
Cohesion: 0.27
Nodes (7): app_users_sync_display_name, auth_user_set_display_name, public.app_users_sync_display_name(), public.login_names(), public.pin_lockouts, public.pin_register_failure(), public.pin_reset_log

### Community 54 - "Worker Role Rates"
Cohesion: 0.32
Nodes (8): addRoleRateRow(), dashRoleOptions(), dashRoleRowAuto(), dashSyncInternal(), openEditWorker(), removeRoleRateRow(), renderRoleRatesList(), updateRoleRateRow()

### Community 55 - "Monthly PDF Export"
Cohesion: 0.28
Nodes (9): dashBuildMonthWeeks(), dashCompressSigs(), dashDe(), dashDownload(), dashDrawMonth(), dashMonthCsv(), exportDashboardMonthlyPDF(), exportDashboardMonthlyPDFRun() (+1 more)

### Community 56 - "View-As Role Switch"
Cohesion: 0.44
Nodes (8): openViewAsMenu(), setViewAs(), viewAsApply(), viewAsChip(), viewAsEffective(), viewAsIsAdmin(), viewAsReal(), viewAsStored()

### Community 57 - "Plan PDF Reader"
Cohesion: 0.43
Nodes (6): _planApply(), _planHex(), _planMul(), _planReadPages(), _planShapes(), readPlanPdf()

### Community 58 - "Protocol Shift Picker"
Cohesion: 0.31
Nodes (9): protIsBlank(), protPickManual(), protPickOrder(), protPickShift(), protPickWindow(), protRenderPick(), protRenderRestart(), protRestart() (+1 more)

### Community 59 - "Problem Report Form"
Cohesion: 0.52
Nodes (6): buildProblemPayload(), closeProblemForm(), openProblemForm(), _problemSnapshot(), sendProblemForm(), toggleProblemTech()

### Community 60 - "Draft Plan Schema"
Cohesion: 0.33
Nodes (5): app_users_plans_week_guard, plan_draft_shifts_touch, public.plan_draft_shifts, public.plan_draft_weeks, public.plans_week()

### Community 61 - "Service Worker Cache"
Cohesion: 0.50
Nodes (3): assetUrlsOf(), LAZY_ASSETS, precache()

### Community 62 - "Changelog Popup"
Cohesion: 0.67
Nodes (3): CHANGELOG, showChangelogIfNew(), unseenChangelog()

### Community 63 - "loadProtDraft"
Cohesion: 0.28
Nodes (9): loadProtDraft(), loadProtFromHistory(), populateAlPlSelects(), protDraftBelongsTo(), protPersonOptionsHtml(), protRemovePhoto(), renderProtPhotos(), renderProtShortages() (+1 more)

### Community 64 - "plPlace"
Cohesion: 0.17
Nodes (22): plAddPerson(), plCancelDone(), plCancelDrop(), plCandidates(), plDraftSync(), plMeldungSet(), plMeldungTargets(), plPickedRole() (+14 more)

### Community 65 - "was drin ist"
Cohesion: 0.17
Nodes (12): 🛡️ Admin-Seite (nur Admin), 🧩 Besetzungsplaner (testversion), 📊 Dashboard (AL, PL, Buchhaltung, Admin), 🔔 Erinnerungen, ⚙️ Optionen, 📦 Produktdatenbank, 📁 Projektordner, 📋 Protokoll (+4 more)

### Community 66 - "Plan Inbox Schema"
Cohesion: 0.83
Nodes (3): plan_inbox_handled_by_idx, plan_inbox_status_idx, public.plan_inbox

### Community 67 - "plRender"
Cohesion: 0.24
Nodes (11): Global Constraints, plActive(), plBox(), plForInsert(), plLoadPhases(), plPaint(), plRender(), plStartReplace() (+3 more)

### Community 74 - "plSaveSheet"
Cohesion: 0.16
Nodes (19): Review Focus, Task 1: Migration `20261205_planen_flow`, Task 2: Every Auftrag phase reaches PLANEN ("MA?"), Task 3: Auftrag sync with hand-edit protection, Task 7: Table view on wide screens, 2. Auftrag sync with hand-edit protection, plCloseSheet(), plKindOfColor() (+11 more)

### Community 88 - "plToParsed"
Cohesion: 0.24
Nodes (11): plExportPdf(), plKind(), plKindTag(), plLines(), plPdfTable(), plRowKeys(), plRowTime(), plSorted() (+3 more)

### Community 89 - "pad"
Cohesion: 0.22
Nodes (10): currentWeekVal(), fmtDate(), fmtDateFull(), getBillingKeyForDate(), getBillingPeriodLabel(), getMondayFromWeekVal(), getMonthKeyFromWeek(), localDateStr() (+2 more)

### Community 90 - "Lübbert App"
Cohesion: 0.22
Nodes (9): loadLib(), needLib(), showToast(), easter egg, für entwickler, login, Lübbert App, sicherheit (+1 more)

### Community 92 - "dashboard.js"
Cohesion: 0.10
Nodes (32): addDashPeShift(), addDashProtTransport(), closeShiftEditModal(), dashboardCurrentShifts, dashboardProtocols, dashboardWorkers, dashClampPause(), dashEditPause() (+24 more)

### Community 93 - "loadDashInsights"
Cohesion: 0.27
Nodes (11): dashBees(), dashEligible(), dashInactive(), dashIsNightShift(), dashNightRanking(), dashNoNight(), dashPersonBtn(), dashShiftDate() (+3 more)

### Community 94 - "Lübbert App"
Cohesion: 0.33
Nodes (5): Branches, builds, databases, Checking the UI (keep image tokens low), Database queries (keep answers small), graphify, Lübbert App

### Community 97 - "public.ask_log"
Cohesion: 0.33
Nodes (7): ask_log_asked_by_idx, protocols_mark_edited, public.ask_log, public.protocols_mark_edited(), public.answer_ask(), public.ask_answers(), public.my_open_asks()

### Community 98 - "frage.js"
Cohesion: 0.70
Nodes (4): frageAnswer(), frageCheck(), frageMeldung(), frageShow()

### Community 102 - "plOpenOther"
Cohesion: 0.33
Nodes (7): plFilled(), plIsDriver(), plOpenOther(), plOpenSlots(), plSetOpen(), plTakeOpen(), plWerLines()

### Community 103 - "debug-input.mjs"
Cohesion: 0.50
Nodes (3): DEBUG_KEYS, stripDebug(), wantsDebug()

## Knowledge Gaps
- **2 isolated node(s):** `RFC-5545`, `RFC-5545`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 253 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `planShiftFromDb()` connect `Plan Parsing Helpers` to `Weekly Plan View`, `planen.js`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `RFC-5545`, `RFC-5545` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `planer.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14624505928853754 - nodes in this community are weakly interconnected._
- **Why does `dashStartProtokollFromPlan()` connect `Plan Parsing Helpers` to `dashboard.js`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Weekly Plan View` be split into smaller, more focused modules?**
  _Cohesion score 0.0512287988923503 - nodes in this community are weakly interconnected._
- **Why does `wpCommitPlan()` connect `Weekly Plan View` to `Plan Parsing Helpers`, `planen.js`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Should `Timesheet Shifts` be split into smaller, more focused modules?**
  _Cohesion score 0.059574468085106386 - nodes in this community are weakly interconnected._