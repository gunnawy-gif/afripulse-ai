# AFRIPULSE AI — Technical Documentation

**Version 1.0 (Functional MVP)** · Pilot: Rafi Local Government Area, Niger State, Nigeria
**Founder:** Usman Musa
**Tagline:** *Turning Africa's Community Challenges into Intelligent Solutions.*

---

## 1. What was built

A complete, working AI-powered community intelligence and smart-governance web application:

| Module | Status | Where |
|---|---|---|
| A. Public homepage (brand, mission, how-it-works, stats, CTA) | Done | `/` |
| B. Community reporting system (10 categories, reference numbers, photo upload, GPS) | Done | `/report` |
| C. AI Intelligence Engine (real LLM, bilingual) | Done | server-side, shown in admin |
| D. Smart Governance Dashboard (KPIs + 4 interactive charts) | Done | `/admin` |
| E. Community Intelligence Map (verified coordinates only) | Done | `/map` |
| F. Report tracking with full status history | Done | `/track` |
| G. Administration (4 roles, review workflow, user management, audit log) | Done | `/admin/*` |
| H. AI Report Generator (weekly / monthly / thematic, PDF + CSV export) | Done | `/admin/intelligence` |

**Live URL:** `https://blanket-at-usman-s-works-ezen0.skydive.app/`

## 2. Demo accounts

All accounts share the password `AfriPulse#2026`. **These are demonstration accounts — delete or rotate them before any real rollout.**

| Email | Role | Can do |
|---|---|---|
| `super@afripulse.ai` | Super Administrator | Everything incl. user management |
| `lga@afripulse.ai` | Local Government Administrator (Rafi) | Review + set priority + assign departments + generate intelligence |
| `reviewer@afripulse.ai` | Community Reviewer | Review, verify, change status, comment |
| `analyst@afripulse.ai` | Data Analyst | View dashboards/reports, exports only |

## 3. Technology stack

- **Server:** Node.js 24 (native TypeScript), single-process HTTP server on port 3001, modular libraries under `webserver/lib/`
- **Database:** Managed PostgreSQL (Neon) over its HTTPS serverless driver — no raw TCP needed. Schema in `webserver/schema.sql`.
- **AI:** OpenAI `gpt-4o-mini` (classification, urgency rating, summaries, recommendations, duplicate detection, report writing) via the platform egress gateway. API keys never appear in any frontend code — the gateway injects credentials server-side.
- **Map:** Leaflet + OpenStreetMap tiles (free, no API key). Only citizen-supplied or admin-verified coordinates are ever plotted.
- **Charts:** Chart.js (CDN, client-side).
- **PDF:** WeasyPrint server-side. **CSV:** native.
- **Auth:** scrypt password hashing, HTTP-only session cookies, role-based access control.
- **Uploads:** validated by MIME type (PNG/JPEG only), 4 MB cap, stored as binary in Postgres, served with `nosniff`.

## 4. The AI Intelligence Engine (Module C) — how it really works

This is a genuine model integration, not keyword matching:

1. **Analysis** — every submitted report is sent to the LLM, which returns JSON: category (one of the 10), priority (critical/high/medium/low) with an urgency rationale, a 2–3 sentence neutral summary, 2–4 recommended actions for local authorities, detected language (English / Hausa / mixed code-switching), and a confidence score.
2. **Duplicate detection** — the new report is compared by the LLM against the 25 most recent reports; matches above 0.7 similarity are listed for reviewers, and ≥0.87 flags a probable duplicate link. The engine distinguishes "same underlying problem" from "merely same category".
3. **Intelligence briefs** — aggregate statistics for the period (status/priority/category/ward breakdowns, top critical issues) are passed to the LLM, which writes a Markdown governance briefing strictly from the supplied numbers.
4. **Human oversight** — every AI output is displayed as *"AI Assessment — suggestion only, not a verified fact"*; admins can override category and priority (recorded as `ai_overridden`), re-run analysis, and all actions are audit-logged. If the AI is unreachable, reports are stored anyway and queued for manual review — AI failure never loses a citizen's report.

## 5. Language support

Full English/Hausa interface via a server-side dictionary (`webserver/lib/i18n.ts`) with a visible switcher (cookie-based, survives proxies). Citizens may submit in English, Hausa, or mixed; the AI detects and handles all three. Adding a language = adding one dictionary object and one entry in `LANGS`.

## 6. Geographic data — verified, not fabricated

The 11 wards of Rafi LGA were seeded from two independent sources (nigeria2.com and eduweb.com.ng ward/polling-unit lists, identical results):
Kagara Gari, Kakuri, Kongoma Central, Kongoma West, Kusherki North, Kusherki South, Kundu, Sabon Gari, Tegina Gari, Tegina West, Yakila.
"Community/town" is free text — no invented community names. Demonstration reports are flagged `is_demo` and labelled **DEMO** throughout the admin interface.

## 7. Data model (summary)

`reports` (core table incl. AI fields `ai_category/ai_priority/ai_summary/ai_actions/ai_language_detected/ai_confidence/ai_similar/duplicate_of`), `status_history`, `admin_comments`, `users`, `sessions`, `wards`, `attachments`, `audit_logs`, `intelligence_reports`. Reference numbers: `AFR-<year>-<sequence>`.

## 8. Security measures implemented

- Role-based access enforced server-side on every admin API (verified by test: a Reviewer account is refused priority changes).
- scrypt password hashing; HTTP-only, SameSite session cookies; 7-day expiry.
- Input validation with explicit field specs; HTML-escaping on all server-rendered output.
- Upload validation (MIME allow-list + size cap); images served with nosniff.
- Rate limiting on submissions (12/hour/IP) and logins (10/10min/IP).
- Citizens' phone numbers and contact details are never exposed publicly (tracking shows status only; GPS not exposed in public tracking).
- Full audit log of administrative actions (login, status changes, priority overrides, assignments, exports, user changes) with actor, IP, and details.

## 9. Test results (all executed and passing)

- Homepage navigation and all public pages return 200 ✓
- English ↔ Hausa switching (verified in-browser) ✓
- Form validation (empty submit shows per-field errors) ✓
- Live submission from the browser UI → reference `AFR-2026-00016` issued ✓
- AI classification on English, Hausa and mixed-language reports ✓ (e.g. Hausa security report → critical; mixed-language education report → high)
- Duplicate similarity flagging ✓ (0.80 match correctly flagged but not auto-merged)
- Report tracking by reference with status history ✓
- Admin login for all four roles; wrong password rejected ✓
- Role permission enforcement (reviewer blocked from priority change) ✓
- Status changes, department assignment, comments, priority override ✓
- Dashboard KPIs and all four charts render with live data ✓
- Map filters + verified-coordinate pins (OSM tiles) ✓
- CSV export ✓ · PDF export (14 KB valid PDF) ✓
- Mobile responsive layout (390px viewport verified) ✓
- Audit log recording all admin actions ✓

## 10. Deployment

**Current:** the app runs on this Skydive agent's always-on webserver (`webserver/index.ts`), persisted in the agent's git repo, with the database attached via the `DATABASE_URL` secret. Public at the URL above; it survives restarts (wake-on-traffic cold starts take a few seconds).

**Production migration path (documented for later):**
1. Move the code to a standard Next.js or Node/Express project (the lib/ modules map 1:1 to API routes).
2. Use Supabase Postgres with the same schema (it is plain PostgreSQL).
3. Add a real OpenAI API key as a server-side environment variable (same calls, your own billing).
4. Deploy on Vercel/Railway; set `DATABASE_URL` and the AI key as environment secrets.
5. Rotate/delete the demo accounts, seed real ward data for additional LGAs (schema already carries state + LGA on every ward row).

## 11. Remaining production requirements (honest list)

- **Custom domain + HTTPS certificate** for a permanent public identity.
- **SMS/WhatsApp notification service** (e.g. Termii or Africa's Talking) to notify citizens of status changes — needs an account and budget.
- **Email service** for admin notifications and password resets.
- **Real institutional onboarding:** verify the LGA departments list with Rafi LGA officials before using the assignment feature operationally.
- **Moderation policy:** a defined process for false/malicious reports and a public charter for data use.
- **Backup/restore policy** for the production database; Postgres row-level security review if multi-tenant.
- **Load testing** beyond MVP traffic; the in-process rate limiter should move to a shared store for multi-instance deploys.
- **Accessibility audit** (WCAG) and offline/low-bandwidth optimisation for rural users (currently a responsive web app; a PWA with offline draft-saving is a natural next step).
- **Data protection compliance:** formal review against the Nigeria Data Protection Act before collecting citizen contact data at scale.

## 12. Source code layout

```
webserver/
  index.ts            # HTTP server + full route table + admin APIs
  schema.sql          # PostgreSQL schema
  seed.ts             # Ward seed + demo accounts + demo reports (through live AI)
  lib/
    db.ts             # Neon serverless Postgres driver
    auth.ts           # scrypt hashing, sessions, RBAC, audit
    ai.ts             # LLM analysis, similarity, brief generation
    validate.ts       # Field validation + sanitisation
    i18n.ts           # EN/HA dictionaries
    render.ts         # Brand shell, logo, icons, badges
    pages.ts          # Public pages (home, report, track, map, about)
    adminpages.ts     # Admin shell + login
  public/
    app.css           # AFRIPULSE design system
    app.js            # Client helpers (GPS, fetch, toasts, language, nav)
```
