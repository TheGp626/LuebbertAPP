# Graph Report - LuebbertAPP  (2026-11-25)

## Corpus Check
- 129 files · ~195,521 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: .css 3, (none) 2)

## Summary
- 1839 nodes · 4048 edges · 99 communities (77 shown, 22 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 248 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2e46d173`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Staffing Planner UI
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
- openDashProtEdit
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
- Calendar Feed Export
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
- saveProtokoll
- planen.js
- On-Site Plans
- Protocols Schema
- Order Text Parser
- PWA Manifest
- Plan Shifts Checks Schema
- renderProtPersonnel
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
- Plan Change Push
- was drin ist
- Plan Inbox Schema
- Folder Deletion Log
- Role RLS Policies
- Protocol Waivers Schema
- Supabase Client Config
- Shift Role Backup
- loadDashInsights
- pad
- Lübbert App
- buildProtPdfDoc
- renderDashMissing
- public.staff_minors
- Lübbert App
- public.save_app_settings
- dashStartProtokollFromPlan
- public.ask_log
- frage.js

## God Nodes (most connected - your core abstractions)
1. `saveProtDraft()` - 26 edges
2. `wpMe()` - 25 edges
3. `runDaily()` - 23 edges
4. `fetchShiftsNow()` - 21 edges
5. `saveProtokoll()` - 19 edges
6. `wpEsc()` - 18 edges
7. `calcProtCosts()` - 18 edges
8. `openMaterialCheck()` - 18 edges
9. `renderProtPersonnel()` - 17 edges
10. `_mcRender()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `für entwickler` --references--> `planDiff()`  [INFERRED]
  README.md → js/plan-parser.js
- `für entwickler` --references--> `loadLib()`  [INFERRED]
  README.md → js/utils.js
- `für entwickler` --references--> `needLib()`  [INFERRED]
  README.md → js/utils.js
- `ordLoadNachkalk()` --indirect_call--> `dashNkTransportCost()`  [INFERRED]
  js/auftraege.js → js/dashboard.js
- `navPaint()` --indirect_call--> `moduleAllowedForRole()`  [INFERRED]
  js/nav.js → js/auth.js

## Import Cycles
- None detected.

## Communities (99 total, 22 thin omitted)

### Community 0 - "Staffing Planner UI"
Cohesion: 0.05
Nodes (94): plActive(), plAddDays(), plAddPerson(), plAfterPublish(), plApplied(), plAppliedFor(), plBounds(), plBox() (+86 more)

### Community 1 - "Weekly Plan View"
Cohesion: 0.05
Nodes (100): planShiftFromDb(), initWochenplan(), wpAddDays(), wpAskVorbehalt(), wpAvailCalendarHtml(), wpAvailDayHtml(), wpAvailGrid(), wpAvailGridBounds() (+92 more)

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
Nodes (47): RFC-5545, nextOwnShift(), planAliasKey(), planBandColor(), planBands(), planCellLines(), planChangedFields(), planChecks() (+39 more)

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
Cohesion: 0.11
Nodes (46): initAuftraege(), ordAcceptAvailable(), ordAsk(), ordAskPick(), ordAskPicked(), ordAvailable(), ordByShare(), ordCanDecide() (+38 more)

### Community 10 - "Shared Utilities"
Cohesion: 0.09
Nodes (9): canSeeCosts(), escapeHtml(), jsAttrArg(), pdfPatch(), pdfText(), safeNote(), shiftNetHours(), timeToMins() (+1 more)

### Community 11 - "App Settings Schema"
Cohesion: 0.10
Nodes (19): public.apply_app_settings(), public.apply_app_settings(), public.sees_plan_interest(), public.sees_plan_interest(), public.app_role(), public.app_user_private, public.user_directory(), public.apply_app_settings() (+11 more)

### Community 12 - "App Shell Settings"
Cohesion: 0.09
Nodes (34): addDepartment(), applyTheme(), closeSettingsModal(), closeSigModal(), cycleTheme(), deleteDepartment(), deptLabel(), exitToMenu() (+26 more)

### Community 13 - "openDashProtEdit"
Cohesion: 0.20
Nodes (10): addDashPeShift(), addDashProtTransport(), dashShiftToRow(), openDashProtEdit(), removeDashPeShift(), renderDashPeActionSeg(), renderDashPeShifts(), renderDashProtEquipment() (+2 more)

### Community 14 - "Reminder Edge Function"
Cohesion: 0.11
Nodes (38): CORS, Db, Input, json(), runDaily(), runEvening(), runTest(), shiftDate() (+30 more)

### Community 15 - "Protocol Form Helpers"
Cohesion: 0.11
Nodes (22): fetchAppUsers(), populateAlPlSelects(), protDriverBusyCount(), protDriverSame(), protFilterScope(), protGuessVehicleType(), protIsMine(), protKeepOnLogout() (+14 more)

### Community 16 - "Push Subscriptions RLS"
Cohesion: 0.12
Nodes (16): public.auth_user_set_display_name(), public.pin_register_failure(), app_users_pl_guard, public.app_users_pl_guard(), app_users_pl_guard, public.app_users_pl_guard(), public.register_push_subscription(), public.renew_calendar_token() (+8 more)

### Community 17 - "Department Mail Routing"
Cohesion: 0.11
Nodes (33): AREA_LABELS, AREA_ORDER, buildDepartmentBody(), buildDepartmentSubject(), DEFAULT_ROUTES, departmentFeedback(), departmentRecipient(), DEPARTMENTS (+25 more)

### Community 18 - "PIN Login Functions"
Cohesion: 0.14
Nodes (24): CORS, json(), serverError(), CORS, json(), serverError(), CORS, json() (+16 more)

### Community 19 - "Admin KPI Dashboard"
Cohesion: 0.16
Nodes (26): adminBindChart(), adminDelta(), _adminDeltaHtml(), adminFmtNum(), adminFourthKpiHtml(), adminHashFor(), _adminIsAdmin(), adminIsPatryk() (+18 more)

### Community 20 - "Monthly Billing Summary"
Cohesion: 0.18
Nodes (18): dashBillingCutoff(), dashBillingRange(), dashBookMonth(), dashCloseKeys(), dashLoadMonthSummary(), dashMayBook(), dashMonthSummary(), dashRenderWorkerMonth() (+10 more)

### Community 21 - "Error Logging Client"
Cohesion: 0.17
Nodes (23): breadcrumb(), deviceString(), _errEnqueue(), _errInit(), errorContextSnapshot(), errorFingerprint(), errQueuePut(), _errQueueRead() (+15 more)

### Community 22 - "saveProtDraft"
Cohesion: 0.13
Nodes (31): addProtPersonnel(), addProtTransport(), calcProtCosts(), clearProtForm(), clearProtSig(), growProtText(), initProtokoll(), initProtSig() (+23 more)

### Community 23 - "Dashboard Protocol Editing"
Cohesion: 0.11
Nodes (34): calcDashProtTotal(), closeDashProtEdit(), dashboardCurrentShifts, dashboardProtocols, dashboardWorkers, dashClampPause(), dashEditedHtml(), dashNkTransportCost() (+26 more)

### Community 24 - "Push Reminder Setup"
Cohesion: 0.21
Nodes (22): enablePushReminders(), erFolderProjectNo(), erJobForShift(), erPickFolder(), erPickJob(), erPickShift(), erPlanLocation(), erPlanShifts() (+14 more)

### Community 25 - "Push Notification Functions"
Cohesion: 0.12
Nodes (16): chunk(), dueFolderTrees(), hasUpcomingJob(), pathsNotIn(), storagePaths(), CORS, CORS, buildFolderPushes() (+8 more)

### Community 26 - "Settings Tab"
Cohesion: 0.18
Nodes (23): addVehicleRateRow(), appSetting(), appSettingsFromCache(), changedSettings(), loadAppSettings(), _readSettingsForm(), readVehicleRates(), renderSettingsTab() (+15 more)

### Community 27 - "renderProtSectionNav"
Cohesion: 0.19
Nodes (14): protApplyStep(), protBasisValues(), protCurrentStep(), protGoStep(), protNextOrSend(), protSectionStatus(), protSideOn(), protStepBack() (+6 more)

### Community 28 - "Calendar Feed Export"
Cohesion: 0.17
Nodes (16): dedupeShifts(), parseToken(), windowStart(), CORS, RFC-5545, PLAN_WHEN_LABELS, planEventName(), planIcs() (+8 more)

### Community 29 - "Order Staffing Schema"
Cohesion: 0.17
Nodes (11): public.order_parsed, public.order_staffing, order_applications_decided, public.order_applications, public.order_applications_decided(), public.order_plan_links, public.order_slots(), einsaetze_job_no_idx (+3 more)

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
Cohesion: 0.13
Nodes (21): addDashboardUser(), closeDashWorker(), closeEditWorker(), closeShiftEditModal(), dashEditPause(), dashRefreshRateUsers(), dashShiftSaveRole(), dashWorkerHeadHtml() (+13 more)

### Community 34 - "My Shifts View"
Cohesion: 0.27
Nodes (15): meineAddMonths(), meineCutoff(), meineDayLabel(), meineEsc(), meineHours(), meineLinkRows(), meineNetMins(), meinePdf() (+7 more)

### Community 35 - "Post-Calculation Reports"
Cohesion: 0.14
Nodes (18): dashMonthStats(), dashNachkalk(), dashNkEuro(), dashNkHours(), dashNkJobHtml(), dashNkRowHtml(), dashProtMatches(), dashProtToEntry() (+10 more)

### Community 36 - "Cost Formulas"
Cohesion: 0.23
Nodes (10): calcSplitShiftCosts(), calcTransportCost(), personCostRate(), personnelRate(), personPayRate(), personRoleRate(), protVehicleRates(), protVehicleTypes() (+2 more)

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
Cohesion: 0.23
Nodes (9): askLabel(), askPush(), askRef(), MAX_ASKS_PER_HOUR, mayAsk(), CORS, runHoursCheck(), pushTo() (+1 more)

### Community 45 - "saveProtokoll"
Cohesion: 0.19
Nodes (14): protApplySide(), protIncompleteNames(), protJobNo(), protJobNoValid(), protLongerThanAl(), protProjectNo(), protSelectedId(), protShiftChanges() (+6 more)

### Community 46 - "planen.js"
Cohesion: 0.08
Nodes (51): initPlanen(), pnAlertsHtml(), pnAsked(), pnAskRef(), pnAskTarget(), pnAvatar(), pnChangeLines(), pnChangesHtml() (+43 more)

### Community 47 - "On-Site Plans"
Cohesion: 0.33
Nodes (10): voBlockHtml(), voEsc(), voFill(), voFind(), voFolderTree(), voOpenPlan(), voOpenPlans(), voPickFolder() (+2 more)

### Community 48 - "Protocols Schema"
Cohesion: 0.25
Nodes (7): protocols_job_no_idx, protocols_side_of_idx, public.shifts_side_guard(), shifts_side_guard, department_mail_log_protocol_idx, department_mail_log_sent_at_idx, public.department_mail_log

### Community 49 - "Order Text Parser"
Cohesion: 0.29
Nodes (5): orderDays(), orderIsBillingJob(), orderParse(), orderRange(), orderStripPhones()

### Community 50 - "PWA Manifest"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 51 - "Plan Shifts Checks Schema"
Cohesion: 0.27
Nodes (6): public.fits_plan_slot(), order_checks_plan_date_idx, order_checks_stamp, order_checks_updated_by_idx, public.order_check_mine(), public.order_checks

### Community 52 - "renderProtPersonnel"
Cohesion: 0.26
Nodes (13): protClampPause(), protMinor(), protMinorWarnings(), protPauseHint(), protPauseHintText(), protPauseMin(), protPersonSummary(), protRatingButtons() (+5 more)

### Community 53 - "Auth Display Names"
Cohesion: 0.28
Nodes (6): app_users_sync_display_name, auth_user_set_display_name, public.app_users_sync_display_name(), public.login_names(), public.pin_lockouts, public.pin_reset_log

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
Cohesion: 0.25
Nodes (9): loadProtDraft(), protAddPhotos(), protDraftBelongsTo(), protPhotoPath(), protRemovePhoto(), protResizePhoto(), renderProtPhotos(), renderProtShortages() (+1 more)

### Community 64 - "Plan Change Push"
Cohesion: 0.83
Nodes (3): buildPlanPushes(), ddmm(), planPushText()

### Community 65 - "was drin ist"
Cohesion: 0.17
Nodes (12): 🛡️ Admin-Seite (nur Admin), 🧩 Besetzungsplaner (testversion), 📊 Dashboard (AL, PL, Buchhaltung, Admin), 🔔 Erinnerungen, ⚙️ Optionen, 📦 Produktdatenbank, 📁 Projektordner, 📋 Protokoll (+4 more)

### Community 66 - "Plan Inbox Schema"
Cohesion: 0.83
Nodes (3): plan_inbox_handled_by_idx, plan_inbox_status_idx, public.plan_inbox

### Community 88 - "loadDashInsights"
Cohesion: 0.27
Nodes (11): dashBees(), dashEligible(), dashInactive(), dashIsNightShift(), dashNightRanking(), dashNoNight(), dashPersonBtn(), dashShiftDate() (+3 more)

### Community 89 - "pad"
Cohesion: 0.22
Nodes (10): currentWeekVal(), fmtDate(), fmtDateFull(), getBillingKeyForDate(), getBillingPeriodLabel(), getMondayFromWeekVal(), getMonthKeyFromWeek(), localDateStr() (+2 more)

### Community 90 - "Lübbert App"
Cohesion: 0.22
Nodes (9): loadLib(), needLib(), showToast(), easter egg, für entwickler, login, Lübbert App, sicherheit (+1 more)

### Community 91 - "buildProtPdfDoc"
Cohesion: 0.33
Nodes (9): buildProtPdfDoc(), getEffectivePersonnelRate(), pdfStr(), protBasePos(), protCostLines(), protDriverCost(), protPdfFileName(), protServerSignature() (+1 more)

### Community 92 - "renderDashMissing"
Cohesion: 0.33
Nodes (7): dashMayWaive(), dashUnwaiveMissing(), dashUserName(), dashWaiveMissing(), renderDashMissing(), toggleDashMissing(), toggleDashWaived()

### Community 93 - "public.staff_minors"
Cohesion: 0.33
Nodes (5): public.i_am_minor(), public.minors_among(), public.staff_minors, public.i_am_minor(), public.minors_among()

### Community 94 - "Lübbert App"
Cohesion: 0.33
Nodes (5): Branches, builds, databases, Checking the UI (keep image tokens low), Database queries (keep answers small), graphify, Lübbert App

### Community 96 - "dashStartProtokollFromPlan"
Cohesion: 0.67
Nodes (3): dashMergePlanPeople(), dashStartProtokollFromPlan(), planAlUserId()

### Community 97 - "public.ask_log"
Cohesion: 0.47
Nodes (3): public.answer_ask(), public.ask_answers(), public.my_open_asks()

### Community 98 - "frage.js"
Cohesion: 0.70
Nodes (4): frageAnswer(), frageCheck(), frageMeldung(), frageShow()

## Knowledge Gaps
- **2 isolated node(s):** `RFC-5545`, `RFC-5545`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 233 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `planShiftFromDb()` connect `Weekly Plan View` to `dashStartProtokollFromPlan`, `Plan Parsing Helpers`, `planen.js`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `RFC-5545`, `RFC-5545` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Staffing Planner UI` be split into smaller, more focused modules?**
  _Cohesion score 0.054455445544554455 - nodes in this community are weakly interconnected._
- **Why does `dashStartProtokollFromPlan()` connect `dashStartProtokollFromPlan` to `Weekly Plan View`, `Dashboard Protocol Editing`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Should `Weekly Plan View` be split into smaller, more focused modules?**
  _Cohesion score 0.052650494159928125 - nodes in this community are weakly interconnected._
- **Why does `planStripPhones()` connect `Plan Parsing Helpers` to `Staffing Planner UI`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `Timesheet Shifts` be split into smaller, more focused modules?**
  _Cohesion score 0.059574468085106386 - nodes in this community are weakly interconnected._