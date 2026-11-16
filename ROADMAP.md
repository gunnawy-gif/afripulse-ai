# AFRIPULSE AI — Development Roadmap

Prepared 2026-11-16 per the Master Project Development Instruction.
Basis: full inspection of the live codebase (`webserver/`) on 2026-11-16.

---

## 1. Current state (inspection result)

**Working in production today (do not remove):**

| Module | Status |
|---|---|
| B. Community Problem Reporting | ✅ Complete: bilingual EN/HA form, categories (infrastructure, water_sanitation, education, healthcare, agriculture, security, environment, unemployment, electricity, other), state/LGA/ward/community/location, photo + GPS, tracking by reference, status workflow (submitted → under_review → verified → assigned → in_progress → resolved/rejected), rate limiting |
| D. AI Intelligence & Analytics | ✅ Complete: real AI via chat-completions (classification, priority, summary, suggested actions, similar-report detection, bilingual analysis), weekly/monthly/thematic briefs, PDF + CSV export. All AI output labelled "suggestion pending human review" |
| G. Administration | ✅ Complete: 4-role RBAC (super_admin, lga_admin, reviewer, analyst), session auth (scrypt + HttpOnly cookies), dashboard KPIs + 4 charts, verification/moderation, comments, audit log of every action, user management for staff |
| Offline-first | ✅ Service worker shell cache + on-device report queue with auto-replay (tested end-to-end) |
| PWA | ✅ Installable (manifest, icons, Add to Home Screen) |
| Community map | ✅ Leaflet + OSM, filters, verified-coordinate pins |
| Bilingual EN/HA | ✅ Full dictionary, client-side language switch |

**Architecture:** Node 24 native-TypeScript server (`index.ts` + `lib/`), PostgreSQL (Neon) over HTTPS driver, no framework — plain HTML rendering server-side. GitHub mirror at `gunnawy-gif/afripulse-ai`.

**Not yet built (the gap):**

| Module | Gap |
|---|---|
| A. AI Governance | Not built — needs new tables + public pages + admin flow |
| C. Civic Engagement | Not built — surveys, polls, petitions, feedback |
| E. Community Development | Not built — project tracking, needs assessment |
| F. African Innovation Hub | Not built — showcase, startup profiles, grants |
| 3. User accounts for citizens | **Only staff accounts exist.** No public registration/login/profile/password recovery. Reports are anonymous (optional contact fields) |
| Password recovery | Requires email service integration (none connected yet — honest gap) |

## 2. Phased plan (aligned with the master instruction)

### PHASE 1 — Core platform + dashboard improvement ✅ (already shipped)
Live platform, dashboard, audit, map, tracking, offline-first, PWA. Status: done; ongoing hardening continues via uptime watch.

### PHASE 2 — User accounts & reporting upgrade (CORE SHIPPED 2026-11-16)
**Shipped and tested end-to-end:** public /register (role choice: citizen active instantly; community_rep/government pending admin activation), public /login with role-aware redirect, /account profile with change-password and "my reports" list, admin user management extended (all 7 roles, activate/deactivate, one-time temporary password reset), reports linked to accounts (reports.user_id), audit-logged, rate-limited, bilingual. Remaining in Phase 2: email-verified password recovery (blocked on email integration), optional email confirmation.
1. **Public registration** (`/register`): name, email, password, role choice.
   - `citizen` — active immediately.
   - `community_rep`, `government` — created inactive, **activated by an admin** (verification before elevated roles; honest security).
2. **Public login** (`/login`) — same secure session system as staff; admins land on /admin, citizens on /account.
3. **Profile page** (`/account`): profile info, change password, "my reports" list (reports get a nullable `user_id`).
4. **Admin user management** extends to all roles: activate/deactivate, password reset (admin-generated temporary password shown once), role list.
5. Password self-service recovery via email: **blocked on email integration** (no inbox connected). Interim: admin-assisted reset. Will complete when an email provider is connected.
6. All screens bilingual (EN/HA), validated, rate-limited, audit-logged.

### PHASE 3 — Civic Engagement + Community Development (SHIPPED 2026-11-16)
**Shipped and tested end-to-end:** /civic (bilingual polls with one-vote-per-device integrity via voter_key, petitions with signature counter + target progress bar, feedback/suggestions with admin moderation), /development (project cards with status badges + progress bars + update timelines), /admin/civic management (create polls/petitions/projects, add progress updates, close/reopen, publish/hide feedback). Tables: polls, poll_options, poll_votes, petitions, petition_signatures, feedback, projects, project_updates. All audit-logged and rate-limited where appropriate. No fabricated content: platform starts empty until Usman/admins add real entries.
- Tables: `surveys`, `survey_questions`, `survey_responses`, `polls`, `poll_votes`, `petitions`, `petition_signatures`, `feedback`, `projects`, `project_updates`, `needs_assessments`.
- Public pages (bilingual): active surveys/polls (one-response integrity per user), petition browse/sign, feedback submission with moderation, project tracker with status/timeline, needs-assessment summaries from AI analysis of reports.
- Admin: create/manage surveys, polls, petitions, projects; moderate feedback; role-gated.

### PHASE 4 — AI Intelligence & Analytics upgrade (SHIPPED 2026-11-16)
**Shipped:** intelligence briefs now ingest civic engagement signals (active polls + vote counts, open petitions with signature counts, pending feedback, top poll question) alongside report data — real AI, no simulation; the brief pipeline was verified generating a real 2,400-char weekly brief with the civic block present. Existing features (classification, similarity, thematic briefs, PDF/CSV export) unchanged.

### PHASE 4 — AI Intelligence & Analytics upgrade (original plan)
- Trend detection across reports + civic engagement data (recurring problems over time, ward heat ranking).
- Community needs analysis combining reports, surveys, petitions.
- Scheduled AI briefs already exist; extend to cover new data sources. Same rule: AI output labelled pending human review. Real API only (no simulation).

### PHASE 5 — African Innovation Hub (SHIPPED 2026-11-16)
**Shipped:** /hub public page (innovation showcase + opportunities listings + submission form), /admin/hub (publish/hide innovation submissions, create opportunities with kind/deadline/provider/link validation, mark expired). Tables: innovations, opportunities. Submissions start pending — admin reviews before publication (anti-spam). Link validation rejects non-http(s) URLs. Platform starts empty — no fabricated listings.

### PHASE 5 — African Innovation Hub (original plan)
- Tables: `innovations`, `startups`, `opportunities` (grants/funding), `resources`.
- Public showcase with admin-curated entries (submission → admin review → publish; protects against spam/fabrication).
- Youth opportunities listings maintained by admins. No fabricated listings — empty until real entries exist.

### PHASE 6 — Administration, security, testing, deployment (EXECUTED 2026-11-16)
**Security pass results:** swept every /api/admin/* endpoint for auth — found and fixed 2 unprotected endpoints (apiStats, apiWards now require staff auth); re-sweep clean. XSS render test: script-tag input stored but escaped on render (0 raw tags in HTML). RBAC verified: citizen blocked from all admin APIs (401), pending community_rep/government blocked at login (403). Rate limiting verified on register (5/h), feedback (5/h), reports (12/day). Full route matrix: 14 public pages + 7 admin pages + APIs all 200 through the public URL. Navigation redesigned to single-line with bilingual short labels (fixing overflow from the new modules). Remaining for later: email integration (password recovery, notifications) when Usman connects a provider.

### PHASE 6 — Administration, security, testing, deployment (original plan)
- Full RBAC matrix across all new modules.
- Security pass: rate limits everywhere, input validation, session expiry, audit coverage of every mutation.
- End-to-end test of every form and button; screenshot verification of every page through the public URL.
- Repo organisation final pass; production migration notes (documented in TECHNICAL-DOCUMENTATION.md).

## 3. External dependencies (honest list)

| Need | Status |
|---|---|
| AI API | ✅ Working via platform gateway (chat-completions only) |
| Maps | ✅ OSM tiles (no key needed) |
| Email (registration confirmation, password recovery, notifications) | ❌ Not connected — architecture ready; needs an email integration decision |
| SMS fallback | ❌ Needs a paid provider account (e.g. Africa's Talking) — decision with owner |
| Analytics | Platform logs + DB queries now; external analytics optional later |

## 4. Standing rules (from the master instruction)

- No removal of working features.
- No UI without working backend behind it.
- No fake statistics or fabricated reports; demo data stays clearly marked.
- Every feature tested before being declared complete; every page screenshot-verified through the public URL.
- GitHub mirror kept in sync after every change.
