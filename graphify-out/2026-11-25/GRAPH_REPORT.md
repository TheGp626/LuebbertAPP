# Graph Report - luebbertapp  (2026-11-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1706 nodes · 3808 edges · 88 communities (67 shown, 21 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 234 edges (avg confidence: 0.85)
- Token cost: 52,108 input · 1,104 output

## Graph Freshness
- Built from commit: `b4278d54`
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
- Dashboard Shift Editing
- Reminder Edge Function
- Protocol Form Helpers
- Push Subscriptions RLS
- Department Mail Routing
- PIN Login Functions
- Admin KPI Dashboard
- Monthly Billing Summary
- Error Logging Client
- Protocol Personnel Costs
- Dashboard Protocol Editing
- Push Reminder Setup
- Push Notification Functions
- Settings Tab
- Protocol Draft Lifecycle
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
- Protocol Mail Builder
- Protocol PDF Sync
- Protocol Step Wizard
- On-Site Plans
- Protocols Schema
- Order Text Parser
- PWA Manifest
- Plan Shifts Checks Schema
- Folder Cleanup Function
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
- Protocol Shortages
- Plan Change Push
- Debug Input Handling
- Plan Inbox Schema
- Folder Deletion Log
- Role RLS Policies
- Protocol Waivers Schema
- Supabase Client Config
- Shift Role Backup

## God Nodes (most connected - your core abstractions)
1. `plPaint()` - 26 edges
2. `wpMe()` - 25 edges
3. `saveProtDraft()` - 24 edges
4. `runDaily()` - 22 edges
5. `fetchShiftsNow()` - 21 edges
6. `saveProtokoll()` - 18 edges
7. `openMaterialCheck()` - 18 edges
8. `wpEsc()` - 17 edges
9. `calcProtCosts()` - 17 edges
10. `_mcRender()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `plSaveSheet()` --indirect_call--> `planStripPhones()`  [INFERRED]
  js/planer.js → js/plan-parser.js
- `dashStartProtokollFromPlan()` --indirect_call--> `planShiftFromDb()`  [INFERRED]
  js/dashboard.js → js/plan-parser.js
- `loadDashboardWorkers()` --indirect_call--> `flattenPrivate()`  [INFERRED]
  js/dashboard.js → js/utils.js
- `ordLoadNachkalk()` --indirect_call--> `dashNkTransportCost()`  [INFERRED]
  js/auftraege.js → js/dashboard.js
- `navPaint()` --indirect_call--> `moduleAllowedForRole()`  [INFERRED]
  js/nav.js → js/auth.js

## Import Cycles
- None detected.

## Communities (88 total, 21 thin omitted)

### Community 0 - "Staffing Planner UI"
Cohesion: 0.06
Nodes (100): plAddDays(), plAddPerson(), plAfterPublish(), plApplied(), plAppliedFor(), plBounds(), plBox(), plCancelCount() (+92 more)

### Community 1 - "Weekly Plan View"
Cohesion: 0.06
Nodes (96): planShiftFromDb(), initWochenplan(), wpAddDays(), wpAvailCalendarHtml(), wpAvailDayHtml(), wpAvailGrid(), wpAvailGridBounds(), wpAvailGridStep() (+88 more)

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
Cohesion: 0.12
Nodes (42): initAuftraege(), ordAcceptAvailable(), ordAvailable(), ordByShare(), ordCanDecide(), ordCanEdit(), ordCardHtml(), ordCardSlot() (+34 more)

### Community 10 - "Shared Utilities"
Cohesion: 0.07
Nodes (22): canSeeCosts(), currentWeekVal(), escapeHtml(), fmtDate(), fmtDateFull(), getBillingKeyForDate(), getBillingPeriodLabel(), getMondayFromWeekVal() (+14 more)

### Community 11 - "App Settings Schema"
Cohesion: 0.08
Nodes (24): public.apply_app_settings(), public.apply_app_settings(), public.sees_plan_interest(), public.sees_plan_interest(), public.app_role(), public.app_user_private, public.user_directory(), public.apply_app_settings() (+16 more)

### Community 12 - "App Shell Settings"
Cohesion: 0.09
Nodes (32): addDepartment(), applyTheme(), closeSettingsModal(), closeSigModal(), cycleTheme(), deleteDepartment(), deptLabel(), exitToMenu() (+24 more)

### Community 13 - "Dashboard Shift Editing"
Cohesion: 0.09
Nodes (33): addDashPeShift(), addDashProtTransport(), closeShiftEditModal(), dashboardCurrentShifts, dashboardProtocols, dashboardWorkers, dashEditPause(), dashMayWaive() (+25 more)

### Community 14 - "Reminder Edge Function"
Cohesion: 0.15
Nodes (33): CORS, Db, Input, json(), runDaily(), runEvening(), runTest(), shiftDate() (+25 more)

### Community 15 - "Protocol Form Helpers"
Cohesion: 0.09
Nodes (29): growProtText(), initProtSig(), protBasisValues(), protDraftBelongsTo(), protDraftOwner(), protDriverBusyCount(), protDriverSame(), protFilterScope() (+21 more)

### Community 16 - "Push Subscriptions RLS"
Cohesion: 0.11
Nodes (16): public.auth_user_set_display_name(), app_users_pl_guard, public.app_users_pl_guard(), app_users_pl_guard, public.app_users_pl_guard(), public.register_push_subscription(), public.renew_calendar_token(), public.shifts_booking_guard() (+8 more)

### Community 17 - "Department Mail Routing"
Cohesion: 0.13
Nodes (23): AREA_LABELS, AREA_ORDER, buildDepartmentBody(), buildDepartmentSubject(), DEFAULT_ROUTES, departmentFeedback(), departmentRecipient(), DEPARTMENTS (+15 more)

### Community 18 - "PIN Login Functions"
Cohesion: 0.14
Nodes (24): CORS, json(), serverError(), CORS, json(), serverError(), CORS, json() (+16 more)

### Community 19 - "Admin KPI Dashboard"
Cohesion: 0.16
Nodes (26): adminBindChart(), adminDelta(), _adminDeltaHtml(), adminFmtNum(), adminFourthKpiHtml(), adminHashFor(), _adminIsAdmin(), adminIsPatryk() (+18 more)

### Community 20 - "Monthly Billing Summary"
Cohesion: 0.13
Nodes (28): dashBees(), dashBillingCutoff(), dashBillingRange(), dashBookMonth(), dashCloseKeys(), dashEligible(), dashInactive(), dashIsNightShift() (+20 more)

### Community 21 - "Error Logging Client"
Cohesion: 0.16
Nodes (23): breadcrumb(), deviceString(), _errEnqueue(), _errInit(), errorContextSnapshot(), errorFingerprint(), errQueuePut(), _errQueueRead() (+15 more)

### Community 22 - "Protocol Personnel Costs"
Cohesion: 0.12
Nodes (25): calcProtCosts(), fetchAppUsers(), onProtDriverName(), onProtPersonnelName(), openProtCostSheet(), populateAlPlSelects(), protApplyPlanPersonnel(), protApplyPlanTransports() (+17 more)

### Community 23 - "Dashboard Protocol Editing"
Cohesion: 0.11
Nodes (24): calcDashProtTotal(), closeDashProtEdit(), dashNkTransportCost(), dashReplaceRows(), dashResolvePerson(), dashShiftChanges(), dashShiftCosts(), dashShiftRowToDb() (+16 more)

### Community 24 - "Push Reminder Setup"
Cohesion: 0.21
Nodes (22): enablePushReminders(), erFolderProjectNo(), erJobForShift(), erPickFolder(), erPickJob(), erPickShift(), erPlanLocation(), erPlanShifts() (+14 more)

### Community 25 - "Push Notification Functions"
Cohesion: 0.15
Nodes (12): CORS, buildFolderPushes(), ddmm(), pgUuidArray(), CORS, callerRole(), isAdminRole(), pushTo() (+4 more)

### Community 26 - "Settings Tab"
Cohesion: 0.20
Nodes (21): addVehicleRateRow(), appSetting(), appSettingsFromCache(), changedSettings(), loadAppSettings(), _readSettingsForm(), readVehicleRates(), renderSettingsTab() (+13 more)

### Community 27 - "Protocol Draft Lifecycle"
Cohesion: 0.19
Nodes (21): addProtPersonnel(), addProtTransport(), clearProtForm(), clearProtSig(), initProtokoll(), loadProtDraft(), loadProtFromHistory(), protApplyStep() (+13 more)

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
Cohesion: 0.16
Nodes (17): addDashboardUser(), closeDashWorker(), closeEditWorker(), dashPlansWeekChange(), dashRefreshRateUsers(), dashWorkerHeadHtml(), deactivateWorker(), ensureRateUsers() (+9 more)

### Community 34 - "My Shifts View"
Cohesion: 0.27
Nodes (15): meineAddMonths(), meineCutoff(), meineDayLabel(), meineEsc(), meineHours(), meineLinkRows(), meineNetMins(), meinePdf() (+7 more)

### Community 35 - "Post-Calculation Reports"
Cohesion: 0.16
Nodes (15): dashMonthStats(), dashNachkalk(), dashNkEuro(), dashNkHours(), dashNkJobHtml(), dashNkRowHtml(), dashProtMatches(), dashProtToEntry() (+7 more)

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

### Community 44 - "Protocol Mail Builder"
Cohesion: 0.31
Nodes (12): actionText(), attachmentName(), buildBody(), buildSubject(), escapeHtml(), formatDateDE(), GEWERKE_LABELS, isEmptyNote() (+4 more)

### Community 45 - "Protocol PDF Sync"
Cohesion: 0.27
Nodes (12): buildProtPdfDoc(), getEffectivePersonnelRate(), pdfStr(), protBasePos(), protCostLines(), protDriverCost(), protJobNo(), protJobNoValid() (+4 more)

### Community 46 - "Protocol Step Wizard"
Cohesion: 0.24
Nodes (11): protApplySide(), protCurrentStep(), protGoStep(), protIncompleteNames(), protLongerThanAl(), protNextOrSend(), protSelectedId(), protStepBack() (+3 more)

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

### Community 52 - "Folder Cleanup Function"
Cohesion: 0.31
Nodes (6): chunk(), dueFolderTrees(), hasUpcomingJob(), pathsNotIn(), storagePaths(), CORS

### Community 53 - "Auth Display Names"
Cohesion: 0.27
Nodes (7): app_users_sync_display_name, auth_user_set_display_name, public.app_users_sync_display_name(), public.login_names(), public.pin_lockouts, public.pin_register_failure(), public.pin_reset_log

### Community 54 - "Worker Role Rates"
Cohesion: 0.28
Nodes (9): addRoleRateRow(), dashRoleOptions(), dashRoleRowAuto(), dashSyncInternal(), loadEditWorkerPlansWeek(), openEditWorker(), removeRoleRateRow(), renderRoleRatesList() (+1 more)

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
Cohesion: 0.32
Nodes (8): protIsBlank(), protPickManual(), protPickOrder(), protPickShift(), protPickWindow(), protRenderPick(), protRenderRestart(), protSetPicking()

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

### Community 63 - "Protocol Shortages"
Cohesion: 0.50
Nodes (4): refreshProtShortages(), renderProtShortages(), resetProtFormState(), setProtAction()

### Community 64 - "Plan Change Push"
Cohesion: 0.83
Nodes (3): buildPlanPushes(), ddmm(), planPushText()

### Community 65 - "Debug Input Handling"
Cohesion: 0.50
Nodes (3): DEBUG_KEYS, stripDebug(), wantsDebug()

### Community 66 - "Plan Inbox Schema"
Cohesion: 0.83
Nodes (3): plan_inbox_handled_by_idx, plan_inbox_status_idx, public.plan_inbox

## Knowledge Gaps
- **2 isolated node(s):** `RFC-5545`, `RFC-5545`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 195 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `planShiftFromDb()` connect `Weekly Plan View` to `Plan Parsing Helpers`, `Dashboard Shift Editing`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `RFC-5545`, `RFC-5545` to the rest of the system?**
  _2 weakly-connected nodes found - possible missing edges._
- **Should `Staffing Planner UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05825242718446602 - nodes in this community are weakly interconnected._
- **Why does `dashStartProtokollFromPlan()` connect `Dashboard Shift Editing` to `Weekly Plan View`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `Weekly Plan View` be split into smaller, more focused modules?**
  _Cohesion score 0.055134925257231605 - nodes in this community are weakly interconnected._
- **Why does `planStripPhones()` connect `Plan Parsing Helpers` to `Staffing Planner UI`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Timesheet Shifts` be split into smaller, more focused modules?**
  _Cohesion score 0.059574468085106386 - nodes in this community are weakly interconnected._