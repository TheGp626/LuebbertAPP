# Graph Report - LuebbertAPP  (2026-11-25)

## Corpus Check
- 113 files · ~170,617 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .css 2)

## Summary
- 1644 nodes · 3653 edges · 87 communities (62 shown, 25 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 215 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8819b81d`
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
- cleanup-folders/index.ts
- public.order_slots
- dashRenderWorkerMonth
- settings.js
- ui.js
- saveProtokoll
- fehler.js
- dashLoadMonthSummary
- renderDashboardTable
- formulas.js
- order-slots.js
- 20261126_app_errors.sql
- renderDashWorkerList
- poll-plan-inbox/index.ts
- public.plan_cancellations
- protSaveArchive
- debug-input.mjs
- loadProtFromHistory
- renderProtPersonnel
- was drin ist
- renderDashMissing
- public.protocols
- order-parser.js
- pad
- Lübbert App
- manifest.json
- 20261119_material_abhaken.sql
- Lübbert App – live branch
- renderRoleRatesList
- 20261104_auth_display_name.sql
- plan-pdf.js
- problem.js
- 20261110_besetzungsplaner.sql
- public.staff_minors
- sw.js
- changelog.js
- plan-ics.mjs
- public.plan_inbox
- 20261030_ordner_auto_loeschen.sql
- 20261104_role_rls.sql
- public.protocol_waivers
- supabase-config.js
- 20261105_shift_roles_typed.sql

## God Nodes (most connected - your core abstractions)
1. `plPaint()` - 26 edges
2. `wpMe()` - 25 edges
3. `runDaily()` - 23 edges
4. `saveProtDraft()` - 23 edges
5. `fetchShiftsNow()` - 21 edges
6. `wpEsc()` - 18 edges
7. `openMaterialCheck()` - 18 edges
8. `calcProtCosts()` - 17 edges
9. `renderProtPersonnel()` - 17 edges
10. `_mcRender()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `für entwickler` --references--> `planDiff()`  [INFERRED]
  README.md → js/plan-parser.js
- `für entwickler` --references--> `loadLib()`  [INFERRED]
  README.md → js/utils.js
- `für entwickler` --references--> `needLib()`  [INFERRED]
  README.md → js/utils.js
- `plSaveSheet()` --indirect_call--> `planStripPhones()`  [INFERRED]
  js/planer.js → js/plan-parser.js
- `dashStartProtokollFromPlan()` --indirect_call--> `planShiftFromDb()`  [INFERRED]
  js/dashboard.js → js/plan-parser.js

## Import Cycles
- None detected.

## Communities (87 total, 25 thin omitted)

### Community 0 - "planer.js"
Cohesion: 0.06
Nodes (101): plAddDays(), plAddPerson(), plAfterPublish(), plApplied(), plAppliedFor(), plBounds(), plBox(), plCancelCount() (+93 more)

### Community 1 - "wochenplan.js"
Cohesion: 0.05
Nodes (98): planShiftFromDb(), initWochenplan(), wpAddDays(), wpAskVorbehalt(), wpAvailCalendarHtml(), wpAvailDayHtml(), wpAvailGrid(), wpAvailGridBounds() (+90 more)

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
Nodes (47): RFC-5545, nextOwnShift(), planAliasKey(), planBandColor(), planBands(), planCellLines(), planChangedFields(), planChecks() (+39 more)

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
Cohesion: 0.08
Nodes (44): addDashPeShift(), addDashProtTransport(), calcDashProtTotal(), closeDashProtEdit(), dashboardCurrentShifts, dashboardProtocols, dashboardWorkers, dashMergePlanPeople() (+36 more)

### Community 10 - "auftraege.js"
Cohesion: 0.12
Nodes (42): initAuftraege(), ordAcceptAvailable(), ordAvailable(), ordByShare(), ordCanDecide(), ordCanEdit(), ordCardHtml(), ordCardSlot() (+34 more)

### Community 11 - "app.js"
Cohesion: 0.09
Nodes (34): addDepartment(), applyTheme(), closeSettingsModal(), closeSigModal(), cycleTheme(), deleteDepartment(), deptLabel(), exitToMenu() (+26 more)

### Community 12 - "send-reminders/index.ts"
Cohesion: 0.13
Nodes (37): CORS, Db, Input, json(), runDaily(), runEvening(), runHoursCheck(), runTest() (+29 more)

### Community 13 - "public.app_users"
Cohesion: 0.10
Nodes (19): public.apply_app_settings(), public.apply_app_settings(), public.sees_plan_interest(), public.sees_plan_interest(), public.app_role(), public.app_user_private, public.user_directory(), public.apply_app_settings() (+11 more)

### Community 14 - "protokoll.js"
Cohesion: 0.11
Nodes (22): fetchAppUsers(), populateAlPlSelects(), protDriverBusyCount(), protDriverSame(), protFilterScope(), protGuessVehicleType(), protIsMine(), protKeepOnLogout() (+14 more)

### Community 15 - "public"
Cohesion: 0.12
Nodes (16): public.auth_user_set_display_name(), public.pin_register_failure(), app_users_pl_guard, public.app_users_pl_guard(), app_users_pl_guard, public.app_users_pl_guard(), public.register_push_subscription(), public.renew_calendar_token() (+8 more)

### Community 16 - "send-protocol-mail/index.ts"
Cohesion: 0.10
Nodes (36): AREA_LABELS, AREA_ORDER, buildDepartmentBody(), buildDepartmentSubject(), DEFAULT_ROUTES, DEPARTMENT_EMAIL_RE, departmentFeedback(), departmentRecipient() (+28 more)

### Community 17 - "pin.mjs"
Cohesion: 0.14
Nodes (24): CORS, json(), serverError(), CORS, json(), serverError(), CORS, json() (+16 more)

### Community 18 - "admin.js"
Cohesion: 0.16
Nodes (26): adminBindChart(), adminDelta(), _adminDeltaHtml(), adminFmtNum(), adminFourthKpiHtml(), adminHashFor(), _adminIsAdmin(), adminIsPatryk() (+18 more)

### Community 19 - "saveProtDraft"
Cohesion: 0.12
Nodes (30): addProtPersonnel(), addProtTransport(), calcProtCosts(), clearProtForm(), clearProtSig(), growProtText(), initProtokoll(), initProtSig() (+22 more)

### Community 20 - "errors.js"
Cohesion: 0.16
Nodes (23): breadcrumb(), deviceString(), _errEnqueue(), _errInit(), errorContextSnapshot(), errorFingerprint(), errQueuePut(), _errQueueRead() (+15 more)

### Community 21 - "utils.js"
Cohesion: 0.09
Nodes (9): canSeeCosts(), escapeHtml(), jsAttrArg(), pdfPatch(), pdfText(), safeNote(), shiftNetHours(), timeToMins() (+1 more)

### Community 22 - "erinnerung.js"
Cohesion: 0.21
Nodes (22): enablePushReminders(), erFolderProjectNo(), erJobForShift(), erPickFolder(), erPickJob(), erPickShift(), erPlanLocation(), erPlanShifts() (+14 more)

### Community 23 - "cleanup-folders/index.ts"
Cohesion: 0.13
Nodes (14): CORS, buildFolderPushes(), ddmm(), pgUuidArray(), CORS, buildPlanPushes(), ddmm(), planPushText() (+6 more)

### Community 24 - "renderWorkerShifts"
Cohesion: 0.12
Nodes (22): addDashboardUser(), closeDashWorker(), closeEditWorker(), closeShiftEditModal(), dashEditPause(), dashPlansWeekChange(), dashRefreshRateUsers(), dashShiftSaveRole() (+14 more)

### Community 25 - "cleanup-folders/index.ts"
Cohesion: 0.31
Nodes (6): chunk(), dueFolderTrees(), hasUpcomingJob(), pathsNotIn(), storagePaths(), CORS

### Community 26 - "public.order_slots"
Cohesion: 0.17
Nodes (11): public.order_parsed, public.order_staffing, order_applications_decided, public.order_applications, public.order_applications_decided(), public.order_plan_links, public.order_slots(), einsaetze_job_no_idx (+3 more)

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
Cohesion: 0.18
Nodes (17): buildProtPdfDoc(), getEffectivePersonnelRate(), pdfStr(), protApplySide(), protBasePos(), protCostLines(), protDriverCost(), protIncompleteNames() (+9 more)

### Community 31 - "fehler.js"
Cohesion: 0.27
Nodes (15): drawErrorsTab(), errorsBadgeCount(), _fehlerButtons(), _fehlerDate(), _fehlerErrorHtml(), fehlerJump(), _fehlerReportHtml(), _fehlerSetBadge() (+7 more)

### Community 32 - "dashLoadMonthSummary"
Cohesion: 0.17
Nodes (15): dashBillingRange(), dashBuildMonthWeeks(), dashCompressSigs(), dashDe(), dashDownload(), dashDrawMonth(), dashLoadMonthSummary(), dashMonthCsv() (+7 more)

### Community 33 - "renderDashboardTable"
Cohesion: 0.16
Nodes (15): dashMonthStats(), dashNachkalk(), dashNkEuro(), dashNkHours(), dashNkJobHtml(), dashNkRowHtml(), dashProtMatches(), dashProtToEntry() (+7 more)

### Community 34 - "formulas.js"
Cohesion: 0.23
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
Cohesion: 0.22
Nodes (8): authPassed(), isPdf(), MAX_PDF_BYTES, parseAllowed(), pickPlanPdfs(), senderAllowed(), storagePath(), CORS

### Community 39 - "public.plan_cancellations"
Cohesion: 0.22
Nodes (10): plan_shift_interest_user_id_idx, public.plan_shift_interest, plan_shift_interest_decided, public.order_applications_decided(), plan_cancellations_decided, plan_cancellations_decided_by_idx, plan_cancellations_replacement_user_id_idx, plan_cancellations_user_id_idx (+2 more)

### Community 40 - "protSaveArchive"
Cohesion: 0.24
Nodes (13): deleteProtHistory(), mailProtokoll(), markProtMailed(), mergeProtHistory(), protArchiveShrink(), protRowToEntry(), protSaveArchive(), renderProtHistory() (+5 more)

### Community 41 - "debug-input.mjs"
Cohesion: 0.50
Nodes (3): DEBUG_KEYS, stripDebug(), wantsDebug()

### Community 42 - "loadProtFromHistory"
Cohesion: 0.13
Nodes (18): loadProtDraft(), loadProtFromHistory(), protBasisValues(), protDraftBelongsTo(), protPdfFileName(), protSectionStatus(), protServerSignature(), protSideOn() (+10 more)

### Community 43 - "renderProtPersonnel"
Cohesion: 0.26
Nodes (13): protClampPause(), protMinor(), protMinorWarnings(), protPauseHint(), protPauseHintText(), protPauseMin(), protPersonSummary(), protRatingButtons() (+5 more)

### Community 44 - "was drin ist"
Cohesion: 0.17
Nodes (12): 🛡️ Admin-Seite (nur Admin), 🧩 Besetzungsplaner (testversion), 📊 Dashboard (AL, PL, Buchhaltung, Admin), 🔔 Erinnerungen, ⚙️ Optionen, 📦 Produktdatenbank, 📁 Projektordner, 📋 Protokoll (+4 more)

### Community 45 - "renderDashMissing"
Cohesion: 0.20
Nodes (11): dashMayWaive(), dashUnwaiveMissing(), dashUserName(), dashWaiveMissing(), initDashboardRealtime(), loadDashMissing(), refreshDashboard(), refreshDashboardOnce() (+3 more)

### Community 46 - "public.protocols"
Cohesion: 0.25
Nodes (7): protocols_job_no_idx, protocols_side_of_idx, public.shifts_side_guard(), shifts_side_guard, department_mail_log_protocol_idx, department_mail_log_sent_at_idx, public.department_mail_log

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
Cohesion: 0.28
Nodes (9): addRoleRateRow(), dashRoleOptions(), dashRoleRowAuto(), dashSyncInternal(), loadEditWorkerPlansWeek(), openEditWorker(), removeRoleRateRow(), renderRoleRatesList() (+1 more)

### Community 54 - "20261104_auth_display_name.sql"
Cohesion: 0.28
Nodes (6): app_users_sync_display_name, auth_user_set_display_name, public.app_users_sync_display_name(), public.login_names(), public.pin_lockouts, public.pin_reset_log

### Community 55 - "plan-pdf.js"
Cohesion: 0.43
Nodes (6): _planApply(), _planHex(), _planMul(), _planReadPages(), _planShapes(), readPlanPdf()

### Community 56 - "problem.js"
Cohesion: 0.52
Nodes (6): buildProblemPayload(), closeProblemForm(), openProblemForm(), _problemSnapshot(), sendProblemForm(), toggleProblemTech()

### Community 58 - "20261110_besetzungsplaner.sql"
Cohesion: 0.33
Nodes (5): app_users_plans_week_guard, plan_draft_shifts_touch, public.plan_draft_shifts, public.plan_draft_weeks, public.plans_week()

### Community 59 - "public.staff_minors"
Cohesion: 0.33
Nodes (5): public.i_am_minor(), public.minors_among(), public.staff_minors, public.i_am_minor(), public.minors_among()

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

## Knowledge Gaps
- **2 isolated node(s):** `RFC-5545`, `RFC-5545`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 212 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `planShiftFromDb()` connect `wochenplan.js` to `dashboard.js`, `plan-parser.js`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **What connects `RFC-5545`, `RFC-5545` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `planer.js` be split into smaller, more focused modules?**
  _Cohesion score 0.057692307692307696 - nodes in this community are weakly interconnected._
- **Why does `dashStartProtokollFromPlan()` connect `dashboard.js` to `wochenplan.js`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `wochenplan.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0548258138206739 - nodes in this community are weakly interconnected._
- **Why does `planStripPhones()` connect `plan-parser.js` to `planer.js`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `stundenzettel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06163401815575729 - nodes in this community are weakly interconnected._