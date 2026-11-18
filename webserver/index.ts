import http from 'node:http';
import crypto from 'node:crypto';
import Busboy from 'busboy';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

import { ensureSchema, one, many, sql } from './lib/db.ts';
import {
  userFromRequest, userFromToken, verifyPassword, hashPassword, createSession,
  sessionCookie, clearSessionCookie, destroySession, can, audit, clientIp, STAFF_ROLES, type SessionUser, type Role,
} from './lib/auth.ts';
import { validate, ValidationError, sanitizeText, escapeHtml, CATEGORIES, STATUSES, PRIORITIES, ROLES, PUBLIC_ROLES, isValidPhone } from './lib/validate.ts';
import { analyzeReport, findSimilarReports, generateIntelligenceBrief, generateThematicBrief, rateLimited, type IntelligenceStats } from './lib/ai.ts';
import { t, tf, langFromCookie, LANGS, type Lang } from './lib/i18n.ts';
import { pageShell, statusBadge, priorityBadge } from './lib/render.ts';
import { homePage, aboutPage, reportPage, trackPage, mapPage } from './lib/pages.ts';
import { registerPage, publicLoginPage, accountPage, isStaffRole } from './lib/account.ts';
import { forgotPage, resetPage } from './lib/recovery.ts';
import { civicPage, developmentPage } from './lib/civic.ts';
import { hubPage } from './lib/hub.ts';
import { loginPage, adminHtml } from './lib/adminpages.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEBSERVER_PORT ?? 3001);

type Route = {
  method: string;
  path: string;
  prefix?: boolean;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => Promise<void> | void;
};

// ---------- helpers ----------
function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 6_000_000) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readBody(req)); } catch { return {}; }
}

function parseGps(text: string): { lat: number; lng: number } | null {
  const m = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  // Niger State bounding box sanity check
  if (lat < 3 || lat > 14 || lng < 2 || lng > 15) return null;
  return { lat, lng };
}

const CAT_LABEL: Record<string, [string, string]> = {
  infrastructure: ['Infrastructure', 'Kayan Aiki'], water_sanitation: ['Water & Sanitation', 'Ruwa da Tsafta'],
  education: ['Education', 'Ilimi'], healthcare: ['Healthcare', 'Lafiya'], agriculture: ['Agriculture', 'Noma'],
  security: ['Security', 'Tsaro'], environment: ['Environment', 'Muhalli'], unemployment: ['Unemployment', 'Rashin Aiki'],
  electricity: ['Electricity', 'Wutar Lantarki'], other: ['Other Community Problems', 'Sauran Matsaloli'],
};
const ST_LABEL: Record<string, [string, string]> = {
  submitted: ['Submitted', 'An Aika'], under_review: ['Under Review', 'Ana Duba'], verified: ['Verified', 'An Tabbatar'],
  assigned: ['Assigned', 'An Zabi Mai Alhaki'], in_progress: ['In Progress', 'Ana Aiki'],
  resolved: ['Resolved', 'An Warware'], rejected: ['Rejected', 'An Ki'],
};
const PR_LABEL: Record<string, [string, string]> = {
  critical: ['Critical', 'Na Gaggawa'], high: ['High', 'Babba'], medium: ['Medium', 'Matsakaici'], low: ['Low', 'Karami'],
};

function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse, level: 'view' | 'review' | 'administer' | 'users'): Promise<SessionUser | null> {
  return userFromRequest(req).then((user) => {
    if (!user || !can(user, level)) {
      json(res, 401, { error: 'Unauthorized' });
      return null;
    }
    return user;
  });
}

// ---------- public pages ----------
// (served below in the route table)

// ---------- Phase 3: civic engagement & community development ----------
function voterKey(req: http.IncomingMessage, user: SessionUser | null): string {
  if (user) return 'u' + user.id;
  return 'ip' + crypto.createHash('sha256').update(clientIp(req) + '|' + (req.headers['user-agent'] ?? '')).digest('hex').slice(0, 24);
}

async function civicData(req: http.IncomingMessage, user: SessionUser | null) {
  const vk = voterKey(req, user);
  const pollRows = await many<{ id: number; q_en: string; q_ha: string }>(
    'SELECT id, question_en q_en, question_ha q_ha FROM polls WHERE active = TRUE ORDER BY created_at DESC LIMIT 6'
  );
  const polls = [];
  for (const p of pollRows) {
    const opts = await many<{ id: number; l_en: string; l_ha: string; votes: number }>(
      `SELECT o.id, o.label_en l_en, o.label_ha l_ha, count(v.id)::int votes
       FROM poll_options o LEFT JOIN poll_votes v ON v.option_id = o.id
       WHERE o.poll_id = $1 GROUP BY o.id, o.label_en, o.label_ha, o.position ORDER BY o.position`,
      [p.id]
    );
    const mine = await one<{ option_id: number }>('SELECT option_id FROM poll_votes WHERE poll_id = $1 AND voter_key = $2', [p.id, vk]);
    polls.push({ id: p.id, q_en: p.q_en, q_ha: p.q_ha, options: opts, total: opts.reduce((s, o) => s + o.votes, 0), myVote: mine ? mine.option_id : null });
  }
  const petRows = await many<{ id: number; t_en: string; t_ha: string; b_en: string; b_ha: string; status: string; signature_target: number; sigs: number }>(
    `SELECT p.id, p.title_en t_en, p.title_ha t_ha, p.body_en b_en, p.body_ha b_ha, p.status, p.signature_target,
       count(s.id)::int sigs
     FROM petitions p LEFT JOIN petition_signatures s ON s.petition_id = p.id
     GROUP BY p.id ORDER BY p.created_at DESC LIMIT 6`
  );
  const signedRows = new Set(
    (await many<{ petition_id: number }>('SELECT petition_id FROM petition_signatures WHERE voter_key = $1', [vk])).map((r) => r.petition_id)
  );
  const petitions = petRows.map((p) => ({ id: p.id, t_en: p.t_en, t_ha: p.t_ha, b_en: p.b_en, b_ha: p.b_ha, status: p.status, signatures: p.sigs, target: p.signature_target, signed: signedRows.has(p.id) }));
  return { polls, petitions };
}

async function civicPageHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const user = await userFromRequest(req);
  const data = await civicData(req, user);
  civicPage(req, res, data);
}

async function developmentPageHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const rows = await many<{ id: number; name: string; description: string; ward: string | null; status: string; progress: number }>(
    'SELECT id, name, description, ward, status, progress FROM projects ORDER BY created_at DESC LIMIT 50'
  );
  const projects = [];
  for (const p of rows) {
    const updates = await many<{ note: string; created_at: string }>(
      'SELECT note, created_at FROM project_updates WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10',
      [p.id]
    );
    projects.push({ ...p, updates });
  }
  developmentPage(req, res, projects);
}

async function apiPollVote(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const pollId = Number((req.url ?? '').match(/\/api\/polls\/(\d+)\/vote/)?.[1]);
  if (!pollId) { json(res, 400, { error: 'Invalid poll' }); return; }
  const body = await readJson(req);
  const user = await userFromRequest(req);
  const poll = await one<{ id: number }>('SELECT id FROM polls WHERE id = $1 AND active = TRUE', [pollId]);
  if (!poll) { json(res, 404, { error: 'Poll not found or closed' }); return; }
  const opt = await one<{ id: number; poll_id: number }>('SELECT id, poll_id FROM poll_options WHERE id = $1', [Number(body.option_id)]);
  if (!opt || opt.poll_id !== pollId) { json(res, 400, { error: 'Invalid option' }); return; }
  const vk = voterKey(req, user);
  try {
    await sql.query('INSERT INTO poll_votes (poll_id, option_id, voter_key) VALUES ($1,$2,$3)', [pollId, opt.id, vk]);
  } catch {
    json(res, 409, { error: 'You have already voted in this poll' });
    return;
  }
  json(res, 200, { ok: true });
}

async function apiPetitionSign(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const petId = Number((req.url ?? '').match(/\/api\/petitions\/(\d+)\/sign/)?.[1]);
  if (!petId) { json(res, 400, { error: 'Invalid petition' }); return; }
  const body = await readJson(req);
  const name = sanitizeText(body.name, 80);
  if (!name || name.length < 2) { json(res, 400, { error: 'Your name is required to sign' }); return; }
  const user = await userFromRequest(req);
  const pet = await one<{ id: number; status: string }>('SELECT id, status FROM petitions WHERE id = $1', [petId]);
  if (!pet) { json(res, 404, { error: 'Petition not found' }); return; }
  if (pet.status !== 'open') { json(res, 400, { error: 'This petition is closed' }); return; }
  const vk = voterKey(req, user);
  try {
    await sql.query('INSERT INTO petition_signatures (petition_id, name, voter_key) VALUES ($1,$2,$3)', [petId, name, vk]);
  } catch {
    json(res, 409, { error: 'You have already signed this petition' });
    return;
  }
  json(res, 200, { ok: true });
}

async function apiFeedbackSubmit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const ip = clientIp(req);
  if (rateLimited('feedback:' + ip, 5, 60 * 60 * 1000)) { json(res, 429, { error: 'Too many messages. Please try again later.' }); return; }
  const body = await readJson(req);
  const name = sanitizeText(body.name, 80) || 'Anonymous';
  const message = sanitizeText(body.message, 3000);
  if (message.length < 5) { json(res, 400, { fields: { message: 'Message must be at least 5 characters' } }); return; }
  const user = await userFromRequest(req);
  await sql.query('INSERT INTO feedback (name, message, kind, user_id) VALUES ($1,$2,$3,$4)', [name, message, body.kind === 'suggestion' ? 'suggestion' : 'feedback', user ? user.id : null]);
  json(res, 201, { ok: true });
}

// ---------- Phase 3 admin APIs ----------
async function apiAdminPolls(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  await ensureSchema();
  if (req.method === 'GET') {
    const rows = await many<Record<string, unknown>>(`SELECT p.id, p.question_en, p.question_ha, p.active, p.created_at,
      (SELECT count(*) FROM poll_votes v WHERE v.poll_id = p.id)::int votes FROM polls p ORDER BY p.created_at DESC LIMIT 50`);
    json(res, 200, { polls: rows });
    return;
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const q_en = sanitizeText(body.question_en, 300);
    const q_ha = sanitizeText(body.question_ha, 300);
    const options = Array.isArray(body.options) ? body.options.slice(0, 8) : [];
    if (!q_en || !q_ha || options.length < 2) { json(res, 400, { error: 'Question (EN+HA) and at least two options are required' }); return; }
    const poll = await one<{ id: number }>('INSERT INTO polls (question_en, question_ha, created_by) VALUES ($1,$2,$3) RETURNING id', [q_en, q_ha, user.id]);
    let i = 0;
    for (const o of options) {
      await sql.query('INSERT INTO poll_options (poll_id, label_en, label_ha, position) VALUES ($1,$2,$3,$4)', [poll!.id, sanitizeText(o.label_en, 120), sanitizeText(o.label_ha ?? o.label_en, 120), i++]);
    }
    await audit(user, 'poll.create', 'poll', String(poll!.id), null, clientIp(req));
    json(res, 201, { ok: true, id: poll!.id });
    return;
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const id = Number(new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop());
    if (typeof body.active === 'boolean') {
      await sql.query('UPDATE polls SET active = $1 WHERE id = $2', [body.active, id]);
      await audit(user, body.active ? 'poll.open' : 'poll.close', 'poll', String(id), null, clientIp(req));
    }
    json(res, 200, { ok: true });
  }
}

async function apiAdminPetitions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  await ensureSchema();
  if (req.method === 'GET') {
    const rows = await many<Record<string, unknown>>(`SELECT p.id, p.title_en, p.title_ha, p.status, p.signature_target, p.created_at,
      (SELECT count(*) FROM petition_signatures s WHERE s.petition_id = p.id)::int signatures FROM petitions p ORDER BY p.created_at DESC LIMIT 50`);
    json(res, 200, { petitions: rows });
    return;
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const errors = validate(body, {
      title_en: { required: true, min: 5, max: 200, label: 'Title (English)' },
      title_ha: { required: true, min: 5, max: 200, label: 'Title (Hausa)' },
      body_en: { required: true, min: 20, max: 5000, label: 'Body (English)' },
      body_ha: { required: true, min: 20, max: 5000, label: 'Body (Hausa)' },
    });
    if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }
    const pet = await one<{ id: number }>(
      'INSERT INTO petitions (title_en, title_ha, body_en, body_ha, signature_target, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [sanitizeText(body.title_en, 200), sanitizeText(body.title_ha, 200), sanitizeText(body.body_en, 5000), sanitizeText(body.body_ha, 5000), Math.min(Math.max(Number(body.signature_target) || 100, 10), 100000), user.id]
    );
    await audit(user, 'petition.create', 'petition', String(pet!.id), null, clientIp(req));
    json(res, 201, { ok: true, id: pet!.id });
    return;
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const id = Number(new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop());
    if (body.status === 'open' || body.status === 'closed') {
      await sql.query('UPDATE petitions SET status = $1 WHERE id = $2', [body.status, id]);
      await audit(user, 'petition.status', 'petition', String(id), { status: body.status }, clientIp(req));
    }
    json(res, 200, { ok: true });
  }
}

async function apiAdminFeedback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'review');
  if (!user) return;
  await ensureSchema();
  if (req.method === 'GET') {
    const rows = await many<Record<string, unknown>>('SELECT id, name, message, kind, status, created_at FROM feedback ORDER BY created_at DESC LIMIT 200');
    json(res, 200, { feedback: rows });
    return;
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const id = Number(new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop());
    if (body.status === 'published' || body.status === 'hidden' || body.status === 'pending') {
      await sql.query('UPDATE feedback SET status = $1 WHERE id = $2', [body.status, id]);
      await audit(user, 'feedback.' + body.status, 'feedback', String(id), null, clientIp(req));
    }
    json(res, 200, { ok: true });
  }
}

async function apiAdminProjects(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  await ensureSchema();
  const pathId = Number((req.url ?? '').match(/\/api\/admin\/projects\/(\d+)/)?.[1]);
  const isUpdates = (req.url ?? '').includes('/updates');
  if (req.method === 'GET') {
    const rows = await many<Record<string, unknown>>(`SELECT p.id, p.name, p.description, p.ward, p.status, p.progress, p.created_at,
      (SELECT count(*) FROM project_updates u WHERE u.project_id = p.id)::int updates FROM projects p ORDER BY p.created_at DESC LIMIT 50`);
    json(res, 200, { projects: rows });
    return;
  }
  if (req.method === 'POST' && isUpdates) {
    const body = await readJson(req);
    const note = sanitizeText(body.note, 1000);
    if (note.length < 3) { json(res, 400, { error: 'Update note is required' }); return; }
    const proj = await one<{ id: number }>('SELECT id FROM projects WHERE id = $1', [pathId]);
    if (!proj) { json(res, 404, { error: 'Project not found' }); return; }
    await sql.query('INSERT INTO project_updates (project_id, note) VALUES ($1,$2)', [pathId, note]);
    await sql.query('UPDATE projects SET updated_at = now() WHERE id = $1', [pathId]);
    await audit(user, 'project.update', 'project', String(pathId), null, clientIp(req));
    json(res, 201, { ok: true });
    return;
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const errors = validate(body, {
      name: { required: true, min: 3, max: 150, label: 'Project name' },
      description: { required: true, min: 10, max: 5000, label: 'Description' },
    });
    if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }
    const status = ['planning', 'ongoing', 'completed', 'suspended'].includes(String(body.status)) ? String(body.status) : 'planning';
    const progress = Math.min(Math.max(Number(body.progress) || 0, 0), 100);
    const proj = await one<{ id: number }>(
      'INSERT INTO projects (name, description, ward, status, progress, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [sanitizeText(body.name, 150), sanitizeText(body.description, 5000), body.ward ? sanitizeText(body.ward, 60) : null, status, progress, user.id]
    );
    await audit(user, 'project.create', 'project', String(proj!.id), null, clientIp(req));
    json(res, 201, { ok: true, id: proj!.id });
    return;
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const proj = await one<{ id: number }>('SELECT id FROM projects WHERE id = $1', [pathId]);
    if (!proj) { json(res, 404, { error: 'Project not found' }); return; }
    if (['planning', 'ongoing', 'completed', 'suspended'].includes(String(body.status))) {
      await sql.query('UPDATE projects SET status = $1 WHERE id = $2', [String(body.status), pathId]);
    }
    if (body.progress !== undefined) {
      await sql.query('UPDATE projects SET progress = $1 WHERE id = $2', [Math.min(Math.max(Number(body.progress) || 0, 0), 100), pathId]);
    }
    await sql.query('UPDATE projects SET updated_at = now() WHERE id = $1', [pathId]);
    await audit(user, 'project.edit', 'project', String(pathId), null, clientIp(req));
    json(res, 200, { ok: true });
  }
}

// ---------- Phase 5: African Innovation Hub ----------
async function hubPageHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const innovations = await many<{ id: number; name: string; summary: string; category: string; founder: string | null; ward: string | null }>(
    "SELECT id, name, summary, category, founder, ward FROM innovations WHERE status = 'published' ORDER BY created_at DESC LIMIT 30"
  );
  const opportunities = await many<{ id: number; title: string; description: string; kind: string; provider: string | null; deadline: string | null; link: string | null }>(
    "SELECT id, title, description, kind, provider, deadline::text, link FROM opportunities WHERE status = 'published' ORDER BY (deadline IS NULL), deadline LIMIT 30"
  );
  hubPage(req, res, { innovations, opportunities });
}

async function apiHubSubmit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const ip = clientIp(req);
  if (rateLimited('hub:' + ip, 5, 60 * 60 * 1000)) { json(res, 429, { error: 'Too many submissions. Please try again later.' }); return; }
  const body = await readJson(req);
  const errors = validate(body, {
    name: { required: true, min: 3, max: 150, label: 'Innovation name' },
    summary: { required: true, min: 20, max: 3000, label: 'Summary' },
    category: { required: true, oneOf: ['technology', 'agriculture', 'health', 'education', 'energy', 'other'], label: 'Category' },
  });
  if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }
  const user = await userFromRequest(req);
  await sql.query(
    "INSERT INTO innovations (name, summary, category, founder, ward, submitted_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [sanitizeText(body.name, 150), sanitizeText(body.summary, 3000), String(body.category), body.founder ? sanitizeText(body.founder, 80) : null, body.ward ? sanitizeText(body.ward, 60) : null, user ? user.id : null]
  );
  json(res, 201, { ok: true });
}

async function apiAdminHub(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  await ensureSchema();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const id = Number(url.pathname.match(/\/(\d+)$/)?.[1]);
  if (req.method === 'GET') {
    const innovations = await many<Record<string, unknown>>('SELECT id, name, summary, category, founder, ward, status FROM innovations ORDER BY (status = \'pending\') DESC, created_at DESC LIMIT 100');
    const opportunities = await many<Record<string, unknown>>('SELECT id, title, description, kind, provider, deadline::text, link, status FROM opportunities ORDER BY (status = \'pending\') DESC, created_at DESC LIMIT 100');
    json(res, 200, { innovations, opportunities });
    return;
  }
  if (req.method === 'POST') {
    // admin-created opportunity (already trusted, published directly)
    const body = await readJson(req);
    const errors = validate(body, {
      title: { required: true, min: 5, max: 200, label: 'Title' },
      description: { required: true, min: 20, max: 5000, label: 'Description' },
      kind: { required: true, oneOf: ['grant', 'funding', 'training', 'competition', 'resource'], label: 'Kind' },
    });
    if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }
    const deadline = body.deadline ? String(body.deadline).slice(0, 10) : null;
    const link = body.link ? sanitizeText(body.link, 300) : null;
    if (link && !/^https?:\/\//.test(link)) { json(res, 400, { error: 'Link must start with http:// or https://' }); return; }
    const opp = await one<{ id: number }>(
      "INSERT INTO opportunities (title, description, kind, provider, deadline, link, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'published',$7) RETURNING id",
      [sanitizeText(body.title, 200), sanitizeText(body.description, 5000), String(body.kind), body.provider ? sanitizeText(body.provider, 120) : null, deadline, link, user.id]
    );
    await audit(user, 'opportunity.create', 'opportunity', String(opp!.id), null, clientIp(req));
    json(res, 201, { ok: true, id: opp!.id });
    return;
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const status = String(body.status ?? '');
    if (!['published', 'hidden', 'expired'].includes(status)) { json(res, 400, { error: 'Invalid status' }); return; }
    if (url.pathname.includes('/innovations/')) {
      await sql.query('UPDATE innovations SET status = $1 WHERE id = $2', [status, id]);
      await audit(user, 'innovation.' + status, 'innovation', String(id), null, clientIp(req));
    } else {
      await sql.query('UPDATE opportunities SET status = $1 WHERE id = $2', [status, id]);
      await audit(user, 'opportunity.' + status, 'opportunity', String(id), null, clientIp(req));
    }
    json(res, 200, { ok: true });
  }
}

// ---------- Password recovery (email link flow) ----------
async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  try {
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'authorization': 'Bearer sentinel', 'content-type': 'application/json' },
      body: JSON.stringify({
        raw: Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}`
        ).toString('base64url'),
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

const PUBLIC_BASE = 'https://blanket-at-usman-s-works-ezen0.skydive.app';

async function apiForgot(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const ip = clientIp(req);
  if (rateLimited('forgot:' + ip, 3, 60 * 60 * 1000)) { json(res, 429, { error: 'Too many attempts. Try again later.' }); return; }
  const body = await readJson(req);
  const email = sanitizeText(body.email, 120).toLowerCase();
  if (!email) { json(res, 400, { error: 'Email required' }); return; }
  const user = await one<{ id: number; name: string; email: string; active: boolean }>('SELECT id, name, email, active FROM users WHERE email = $1', [email]);
  if (user && user.active) {
    const token = crypto.randomBytes(32).toString('hex');
    await sql.query("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1,$2, now() + interval '60 minutes')", [token, user.id]);
    const lang: 'en' | 'ha' = email.includes('') ? 'en' : 'en';
    const tr = tf(lang);
    const ok = await sendMail(
      user.email,
      tr('auth.email.subject'),
      `${tr('auth.email.hello')} ${user.name},\n\n${tr('auth.email.resetbody')}\n\n${PUBLIC_BASE}/reset?token=${token}\n\n${tr('auth.email.resetfoot')}\n\n${tr('auth.email.sign')}`
    );
    if (!ok) console.error('[webserver] reset email send failed for', user.email);
    await audit({ id: user.id, name: user.name, email: user.email, role: 'citizen', lga: null }, 'user.forgot_request', 'user', String(user.id), null, ip);
  }
  // Neutral response regardless: never reveal whether the email exists
  json(res, 200, { ok: true });
}

async function apiReset(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const ip = clientIp(req);
  if (rateLimited('reset:' + ip, 5, 60 * 60 * 1000)) { json(res, 429, { error: 'Too many attempts. Try again later.' }); return; }
  const body = await readJson(req);
  const token = sanitizeText(body.token, 80);
  const password = String(body.password ?? '');
  if (password.length < 8 || password.length > 100) { json(res, 400, { error: 'Password must be 8-100 characters' }); return; }
  const row = await one<{ token: string; user_id: number }>(
    "SELECT token, user_id FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > now()", [token]
  );
  if (!row) { json(res, 400, { error: 'Invalid or expired reset link' }); return; }
  await sql.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), row.user_id]);
  await sql.query('UPDATE password_resets SET used = TRUE WHERE token = $1', [row.token]);
  // Invalidate all existing sessions for this user (standard practice after reset)
  await sql.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
  const u = await one<{ id: number; name: string; email: string; role: string }>('SELECT id, name, email, role FROM users WHERE id = $1', [row.user_id]);
  if (u) await audit({ id: u.id, name: u.name, email: u.email, role: u.role as Role, lga: null }, 'user.password_reset_self', 'user', String(u.id), null, ip);
  json(res, 200, { ok: true });
}

// ---------- APIs ----------
async function apiSubmitReport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = clientIp(req);
  const submitter = await userFromRequest(req); // optional: logged-in citizens get reports linked to their account
  if (rateLimited('submit:' + ip, 12, 60 * 60 * 1000)) {
    json(res, 429, { error: 'Too many submissions from this device. Please try again later.' });
    return;
  }
  await ensureSchema();

  const fields: Record<string, string> = {};
  let image: { filename: string; mime: string; data: Buffer } | null = null;

  await new Promise<void>((resolve, reject) => {
    let bb: Busboy.Busboy;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 30 } });
    } catch {
      reject(new Error('Expected multipart form data'));
      return;
    }
    bb.on('field', (name, val) => { fields[name] = val.slice(0, 6000); });
    // NOTE: when the ward dropdown is hidden (LGA without verified ward list), the client
    // sends ward_hidden; we merge it after parsing below.
    bb.on('file', (_name, stream, info) => {
      const mime = info.mimeType;
      if (!['image/png', 'image/jpeg'].includes(mime)) { stream.resume(); return; }
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => { /* file too large */ chunks.length = 0; });
      stream.on('end', () => {
        if (chunks.length) image = { filename: sanitizeText(info.filename, 120), mime, data: Buffer.concat(chunks) };
      });
    });
    bb.on('error', reject);
    bb.on('finish', () => resolve());
    req.pipe(bb);
  }).catch((e) => { throw e; });

  // merge free-text ward (sent as ward_hidden when the dropdown is unavailable for this LGA)
  if (!fields.ward && fields.ward_hidden) fields.ward = fields.ward_hidden;

  const errors = validate(fields, {
    title: { required: true, min: 5, max: 150, label: 'Report title' },
    description: { required: true, min: 15, max: 5000, label: 'Description' },
    category: { required: true, oneOf: [...CATEGORIES], label: 'Category' },
    state: { required: true, max: 40, label: 'State' },
    lga: { required: true, max: 60, label: 'LGA' },
    ward: { required: true, max: 60, label: 'Ward' },
    community: { required: true, max: 100, label: 'Community' },
    specific_location: { required: true, max: 200, label: 'Specific location' },
    language: { oneOf: ['en', 'ha', 'mixed'], label: 'Language' },
    contact_name: { max: 80, label: 'Contact name' },
    contact_phone: { max: 20, label: 'Contact phone' },
  });
  if (fields.contact_phone && !isValidPhone(fields.contact_phone)) errors.contact_phone = 'Contact phone is not a valid phone number';

  const gps = fields.gps_text ? parseGps(fields.gps_text) : null;
  if (fields.gps_text && !gps) errors.gps_text = 'GPS coordinates are not valid (expected: latitude, longitude)';

  // ward: must match a verified ward for the chosen state + LGA (all 774 LGAs are seeded)
  if (fields.state && fields.lga && fields.ward) {
    const wardRow = await one<{ id: number }>('SELECT id FROM wards WHERE state = $1 AND lga = $2 AND name = $3',
      [fields.state, fields.lga, fields.ward]);
    if (!wardRow) errors.ward = 'Unknown ward for this Local Government Area';
  }

  if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }

  let imageId: number | null = null;
  if (image) {
    const ins = await one<{ id: number }>(
      'INSERT INTO attachments (filename, mime, size, data) VALUES ($1,$2,$3,$4) RETURNING id',
      [image.filename, image.mime, image.data.length, image.data]
    );
    imageId = ins!.id;
  }

  const refRow = await one<{ v: string }>(`SELECT 'AFR-' || to_char(now(),'YYYY') || '-' || lpad(nextval('ref_seq')::text, 5, '0') AS v`, []);
  const refNo = refRow!.v;

  const ins = await one<{ id: number }>(
    `INSERT INTO reports (ref_no, title, description, category, state, lga, ward, community, specific_location,
       latitude, longitude, coords_source, image_id, contact_name, contact_phone, language, user_id, reporter_account)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [refNo, sanitizeText(fields.title, 150), sanitizeText(fields.description, 5000), fields.category,
     sanitizeText(fields.state, 40), sanitizeText(fields.lga, 60), sanitizeText(fields.ward, 60), sanitizeText(fields.community, 100),
     sanitizeText(fields.specific_location, 200), gps?.lat ?? null, gps?.lng ?? null, gps ? 'citizen_gps' : null,
     imageId, sanitizeText(fields.contact_name, 80) || null, sanitizeText(fields.contact_phone, 20) || null,
     fields.language === 'ha' || fields.language === 'mixed' ? fields.language : 'en',
     submitter ? submitter.id : null, submitter ? true : false]
  );
  const reportId = ins!.id;
  await sql.query('INSERT INTO status_history (report_id, new_status, note, changed_by) VALUES ($1,$2,$3,$4)',
    [reportId, 'submitted', 'Report received from citizen', 'Citizen (web)']);

  // ---- AI Intelligence Engine (real model calls) ----
  try {
    const analysis = await analyzeReport(fields.title, fields.description);
    // duplicate / similarity check against recent reports (AI comparison call)
    const recent = await many<{ ref_no: string; title: string; ai_summary: string | null }>(
      'SELECT ref_no, title, ai_summary FROM reports WHERE id <> $1 ORDER BY created_at DESC LIMIT 25',
      [reportId]
    );
    const matches = await findSimilarReports(fields.title, fields.description, recent);
    let duplicateOf: number | null = null;
    const top = matches[0];
    if (top && top.similarity >= 0.87) {
      const dup = await one<{ id: number }>('SELECT id FROM reports WHERE ref_no = $1', [top.ref_no]);
      duplicateOf = dup?.id ?? null;
    }
    await sql.query(
      `UPDATE reports SET ai_category=$1, ai_priority=$2, ai_summary=$3, ai_actions=$4, ai_language_detected=$5,
         ai_confidence=$6, ai_assessed_at=now(), ai_similar=$7,
         duplicate_of=$8, priority=CASE WHEN priority IS NULL THEN $2 ELSE priority END
       WHERE id=$9`,
      [analysis.category, analysis.priority, analysis.summary,
       JSON.stringify({ urgency_reason: analysis.urgency_reason, actions: analysis.recommended_actions }),
       analysis.language_detected, analysis.confidence,
       JSON.stringify(matches), duplicateOf, reportId]
    );
    if (duplicateOf) {
      await sql.query('INSERT INTO status_history (report_id, new_status, note, changed_by) VALUES ($1,$2,$3,$4)',
        [reportId, 'submitted', `AI similarity check: ${Math.round(top!.similarity * 100)}% similar to ${top!.ref_no} — flagged as possible duplicate for reviewer`, 'AI Engine']);
    }
  } catch (aiErr) {
    // AI is an assist, never a blocker: the report is already safely stored.
    console.error('[ai] analysis failed:', (aiErr as Error).message);
    await sql.query('INSERT INTO status_history (report_id, new_status, note, changed_by) VALUES ($1,$2,$3,$4)',
      [reportId, 'submitted', 'AI analysis unavailable — queued for manual review', 'System']);
  }

  json(res, 201, { ref_no: refNo, id: reportId });
}

async function apiTrack(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  await ensureSchema();
  const ref = decodeURIComponent(params.ref ?? '').trim().toUpperCase();
  const rp = await one<Record<string, unknown>>(
    'SELECT ref_no, title, category, status, priority, ward, lga, community, specific_location, rejection_reason, created_at, is_demo FROM reports WHERE UPPER(ref_no) = $1',
    [ref]
  );
  if (!rp) { json(res, 404, { error: 'Not found' }); return; }
  const lang = langFromCookie(req.headers.cookie?.match(/afri_lang=(\w+)/)?.[1]);
  const history = await many<Record<string, unknown>>(
    'SELECT new_status, note, changed_by, created_at FROM status_history WHERE report_id = (SELECT id FROM reports WHERE ref_no = $1) ORDER BY created_at ASC', [rp.ref_no]
  );
  json(res, 200, {
    report: {
      ref_no: rp.ref_no, title: rp.title,
      // privacy: no contact fields, no description body, no GPS in public tracking
      category_label: CAT_LABEL[String(rp.category)]?.[lang === 'ha' ? 1 : 0] ?? rp.category,
      status_badge: statusBadge(String(rp.status), lang),
      priority_badge: priorityBadge(rp.priority as string | null, lang),
      location_label: [rp.specific_location, rp.community, rp.ward, rp.lga].filter(Boolean).join(', '),
      created_at: new Date(String(rp.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
      rejection_reason: rp.rejection_reason,
      is_demo: rp.is_demo,
    },
    history: history.map((h) => ({
      new_status_label: ST_LABEL[String(h.new_status)]?.[lang === 'ha' ? 1 : 0] ?? String(h.new_status),
      note: h.note, changed_by: h.changed_by,
      created_at: new Date(String(h.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
    })),
  });
}

async function apiMapReports(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const lang = langFromCookie(req.headers.cookie?.match(/afri_lang=(\w+)/)?.[1]);
  const filters: string[] = ['latitude IS NOT NULL'];
  const params: unknown[] = [];
  const cat = url.searchParams.get('category');
  const pri = url.searchParams.get('priority');
  const st = url.searchParams.get('status');
  const state = url.searchParams.get('state');
  const lga = url.searchParams.get('lga');
  if (cat && CATEGORIES.includes(cat as (typeof CATEGORIES)[number])) { params.push(cat); filters.push(`category = $${params.length}`); }
  if (pri && PRIORITIES.includes(pri as (typeof PRIORITIES)[number])) { params.push(pri); filters.push(`priority = $${params.length}`); }
  if (st && STATUSES.includes(st as (typeof STATUSES)[number])) { params.push(st); filters.push(`status = $${params.length}`); }
  if (state) { params.push(sanitizeText(state, 40)); filters.push(`state = $${params.length}`); }
  if (lga) { params.push(sanitizeText(lga, 60)); filters.push(`lga = $${params.length}`); }
  const rows = await many<Record<string, unknown>>(
    `SELECT ref_no, title, category, priority, status, ward, latitude, longitude FROM reports
     WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 500`, params
  );
  json(res, 200, {
    reports: rows.map((r) => ({
      ref_no: r.ref_no, title: r.title, lat: r.latitude, lng: r.longitude, ward: r.ward,
      category_label: CAT_LABEL[String(r.category)]?.[lang === 'ha' ? 1 : 0] ?? r.category,
      status_badge: statusBadge(String(r.status), lang),
      priority_badge: priorityBadge(r.priority as string | null, lang),
    })),
  });
}

async function serveImage(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  await ensureSchema();
  const id = Number(params.id);
  if (!Number.isInteger(id)) { res.writeHead(404); res.end(); return; }
  const att = await one<{ mime: string; data: Buffer }>('SELECT mime, data FROM attachments WHERE id = $1', [id]);
  if (!att || !['image/png', 'image/jpeg'].includes(att.mime)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': att.mime, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
  res.end(Buffer.from(att.data));
}

async function setLang(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const code = params.code === 'ha' ? 'ha' : 'en';
  const url = new URL(req.url ?? '/', 'http://localhost');
  let next = url.searchParams.get('next') ?? '/';
  if (!next.startsWith('/') || next.startsWith('//')) next = '/';
  res.writeHead(302, { location: next, 'set-cookie': `afri_lang=${code}; Path=/; Max-Age=31536000; SameSite=Lax` });
  res.end();
}

function serveAsset(res: http.ServerResponse, file: string, mime: string, cacheControl = 'no-cache'): void {
  const p = normalize(join(__dirname, 'public', file));
  if (!p.startsWith(join(__dirname, 'public')) || !existsSync(p)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': mime, 'cache-control': cacheControl });
  res.end(readFileSync(p));
}

// ---------- admin APIs ----------
async function apiRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const ip = clientIp(req);
  if (rateLimited('register:' + ip, 5, 60 * 60 * 1000)) {
    json(res, 429, { error: 'Too many registration attempts. Please try again later.' });
    return;
  }
  const body = await readJson(req);
  const errors = validate(body, {
    name: { required: true, min: 2, max: 80, label: 'Full name' },
    email: { required: true, max: 120, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, label: 'Email' },
    password: { required: true, min: 8, max: 100, label: 'Password' },
    role: { required: true, oneOf: [...PUBLIC_ROLES], label: 'Account type' },
  });
  if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }
  const email = sanitizeText(body.email, 120).toLowerCase();
  const exists = await one<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
  if (exists) { json(res, 400, { error: 'A user with that email already exists' }); return; }
  const role = String(body.role);
  const active = role === 'citizen'; // community_rep / government need admin activation
  const created = await one<{ id: number }>(
    'INSERT INTO users (name, email, password_hash, role, active) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [sanitizeText(body.name, 80), email, hashPassword(String(body.password)), role, active]
  );
  await audit({ id: created!.id, name: sanitizeText(body.name, 80), email, role, lga: null }, 'user.register', 'user', String(created!.id), { role, self_registered: true }, ip);
  json(res, 201, { ok: true, pendingApproval: !active });
}

async function apiAccountPassword(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const user = await userFromRequest(req);
  if (!user) { json(res, 401, { error: 'Sign in first' }); return; }
  if (rateLimited('pwchange:' + user.id, 5, 60 * 60 * 1000)) { json(res, 429, { error: 'Too many attempts. Wait a while.' }); return; }
  const body = await readJson(req);
  const password = String(body.password ?? '');
  const current = String(body.current ?? '');
  if (password.length < 8 || password.length > 100) { json(res, 400, { error: 'New password must be 8-100 characters' }); return; }
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!row || !verifyPassword(current, row.password_hash)) { json(res, 400, { error: 'Current password is not correct' }); return; }
  await sql.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), user.id]);
  await audit(user, 'user.password_change', 'user', String(user.id), null, clientIp(req));
  json(res, 200, { ok: true });
}

async function apiAccountReports(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const user = await userFromRequest(req);
  if (!user) { json(res, 401, { error: 'Sign in first' }); return; }
  const rows = await many<{ ref_no: string; title: string; status: string; created_at: string }>(
    'SELECT ref_no, title, status, created_at FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [user.id]
  );
  json(res, 200, {
    reports: rows.map((r) => ({ ref_no: r.ref_no, title: escapeHtml(r.title), status: r.status, date: new Date(r.created_at).toISOString().slice(0, 10) })),
  });
}

async function apiLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await ensureSchema();
  const ip = clientIp(req);
  if (rateLimited('login:' + ip, 10, 10 * 60 * 1000)) {
    json(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
    return;
  }
  const body = await readJson(req);
  const email = sanitizeText(body.email, 120).toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) { json(res, 400, { error: 'Email and password are required' }); return; }
  const user = await one<{ id: number; name: string; email: string; password_hash: string; role: Role; lga: string | null; active: boolean }>(
    'SELECT * FROM users WHERE email = $1', [email]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    json(res, 401, { error: 'Invalid email or password' });
    return;
  }
  if (!user.active) {
    json(res, 403, { error: 'This account is not activated yet. Community Representative and Government accounts are reviewed by an administrator before activation.' });
    return;
  }
  const token = await createSession(user.id);
  await audit({ id: user.id, name: user.name, email: user.email, role: user.role, lga: user.lga }, 'login', 'session', null, null, ip);
  const staff = STAFF_ROLES.includes(user.role as (typeof STAFF_ROLES)[number]);
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': sessionCookie(token) });
  res.end(JSON.stringify({ ok: true, role: user.role, redirect: staff ? '/admin' : '/account' }));
}

async function apiLogout(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (user) await audit(user, 'logout', 'session', null, null, clientIp(req));
  await destroySession(req);
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': clearSessionCookie() });
  res.end(JSON.stringify({ ok: true }));
}

async function apiStats(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const admin = await requireAdmin(req, res, 'view');
  if (!admin) return;
  const totals = await one<Record<string, string>>(
    `SELECT count(*)::text total,
       count(*) FILTER (WHERE status='submitted')::text submitted,
       count(*) FILTER (WHERE status IN ('under_review','verified'))::text review,
       count(*) FILTER (WHERE status='critical' OR priority='critical')::text critical,
       count(*) FILTER (WHERE status IN ('assigned','in_progress'))::text inprog,
       count(*) FILTER (WHERE status='resolved')::text resolved
     FROM reports`
  );
  const byCategory = await many<{ k: string; c: string }>('SELECT category k, count(*)::text c FROM reports GROUP BY category ORDER BY count(*) DESC');
  const byStatus = await many<{ k: string; c: string }>('SELECT status k, count(*)::text c FROM reports GROUP BY status');
  const byPriority = await many<{ k: string; c: string }>('SELECT priority k, count(*)::text c FROM reports WHERE priority IS NOT NULL GROUP BY priority');
  const byWard = await many<{ k: string; c: string; crit: string }>(`SELECT ward k, count(*)::text c, count(*) FILTER (WHERE priority='critical')::text crit FROM reports WHERE ward IS NOT NULL GROUP BY ward ORDER BY count(*) DESC`);
  const trend = await many<{ m: string; c: string }>(`SELECT to_char(date_trunc('month', created_at), 'Mon YYYY') m, count(*)::text c
     FROM reports WHERE created_at > now() - interval '6 months' GROUP BY date_trunc('month', created_at) ORDER BY date_trunc('month', created_at)`);
  json(res, 200, {
    totals: {
      total: Number(totals?.total ?? 0), submitted: Number(totals?.submitted ?? 0), review: Number(totals?.review ?? 0),
      critical: Number(totals?.critical ?? 0), inprog: Number(totals?.inprog ?? 0), resolved: Number(totals?.resolved ?? 0),
    },
    byCategory: byCategory.map((r) => ({ key: r.k, label: CAT_LABEL[r.k]?.[0] ?? r.k, count: Number(r.c) })),
    byStatus: byStatus.map((r) => ({ key: r.k, label: ST_LABEL[r.k]?.[0] ?? r.k, count: Number(r.c) })),
    byPriority: byPriority.map((r) => ({ key: r.k ?? 'none', label: PR_LABEL[r.k]?.[0] ?? 'Unrated', count: Number(r.c) })),
    byWard: byWard.map((r) => ({ ward: r.k, count: Number(r.c), critical: Number(r.crit) })),
    trend: trend.map((r) => ({ month: r.m, count: Number(r.c) })),
  });
}

async function apiAdminReports(req: http.IncomingMessage, res: http.ServerResponse, _p: Record<string, string>): Promise<void> {
  const user = await requireAdmin(req, res, 'view');
  if (!user) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const where: string[] = [];
  const params: unknown[] = [];
  const eq = (field: string, col: string, allowed?: readonly string[]) => {
    const v = url.searchParams.get(field);
    if (v && (!allowed || allowed.includes(v))) { params.push(v); where.push(`${col} = $${params.length}`); }
  };
  eq('status', 'status', STATUSES);
  eq('category', 'category', CATEGORIES);
  eq('priority', 'priority', PRIORITIES);
  eq('state', 'state');
  eq('lga', 'lga');
  const q = url.searchParams.get('q');
  if (q) {
    params.push(`%${sanitizeText(q, 80)}%`);
    where.push(`(title ILIKE $${params.length} OR ref_no ILIKE $${params.length} OR community ILIKE $${params.length})`);
  }
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const pageSize = 20;
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await one<{ c: string }>(`SELECT count(*)::text c FROM reports ${whereSql}`, params);
  const rows = await many<Record<string, unknown>>(
    `SELECT id, ref_no, title, category, status, priority, ward, community, is_demo, ai_overridden, duplicate_of, created_at
     FROM reports ${whereSql} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params
  );
  json(res, 200, {
    total: Number(countRow?.c ?? 0), page, pageSize,
    reports: rows.map((r) => ({
      ...r,
      category_label: CAT_LABEL[String(r.category)]?.[0] ?? r.category,
      status_badge: statusBadge(String(r.status), 'en'),
      priority_badge: priorityBadge(r.priority as string | null, 'en'),
      created_at: new Date(String(r.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
    })),
  });
}

async function apiAdminReportDetail(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const user = await requireAdmin(req, res, 'view');
  if (!user) return;
  const id = Number(params.id);
  const rp = await one<Record<string, unknown>>('SELECT * FROM reports WHERE id = $1', [id]);
  if (!rp) { json(res, 404, { error: 'Not found' }); return; }
  const history = await many<Record<string, unknown>>(
    'SELECT old_status, new_status, note, changed_by, created_at FROM status_history WHERE report_id = $1 ORDER BY created_at ASC', [id]
  );
  const comments = await many<Record<string, unknown>>(
    'SELECT author_name, comment, created_at FROM admin_comments WHERE report_id = $1 ORDER BY created_at ASC', [id]
  );
  const similarRows = (rp.ai_similar as { ref_no: string; similarity: number }[] | null) ?? [];
  const similar = similarRows.length
    ? (await many<{ ref_no: string; title: string }>(
        `SELECT ref_no, title FROM reports WHERE ref_no = ANY($1)`, [similarRows.map((m) => m.ref_no)]
      )).map((row) => {
        const match = similarRows.find((m) => m.ref_no === row.ref_no);
        return { ref_no: row.ref_no, title: row.title, sim: match?.similarity ?? 0 };
      })
    : [];
  json(res, 200, {
    report: {
      ...rp,
      created_at: new Date(String(rp.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
      // badges prebuilt for the admin detail view
      status_badge_html: statusBadge(String(rp.status), 'en'),
      priority_badge_html: priorityBadge(rp.priority as string | null, 'en'),
      // AI actions stored as { urgency_reason, actions: [] }
      ai_detail: rp.ai_actions ?? null,
    },
    history: history.map((h) => ({ ...h, created_at: new Date(String(h.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) })),
    comments: comments.map((c) => ({ ...c, created_at: new Date(String(c.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) })),
    similar,
  });
}

async function apiAdminUpdateReport(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const user = await requireAdmin(req, res, 'review');
  if (!user) return;
  const id = Number(params.id);
  const body = await readJson(req);
  const action = String(body.action ?? '');
  const rp = await one<{ id: number; status: string; priority: string | null }>('SELECT id, status, priority FROM reports WHERE id = $1', [id]);
  if (!rp) { json(res, 404, { error: 'Not found' }); return; }

  let auditDetails: unknown = null;

  if (action === 'status') {
    const next = String(body.status ?? '');
    const note = sanitizeText(body.note, 500) || null;
    if (!STATUSES.includes(next as (typeof STATUSES)[number])) { json(res, 400, { error: 'Invalid status' }); return; }
    if (next === 'rejected' && !note) { json(res, 400, { error: 'A rejection requires an explanation in the note field' }); return; }
    if (!can(user, 'review')) { json(res, 401, { error: 'Insufficient role' }); return; }
    await sql.query(
      `UPDATE reports SET status=$1, updated_at=now(), resolved_at=CASE WHEN $1='resolved' THEN now() ELSE resolved_at END,
         rejection_reason=CASE WHEN $1='rejected' THEN $2 ELSE rejection_reason END WHERE id=$3`,
      [next, note, id]
    );
    await sql.query('INSERT INTO status_history (report_id, old_status, new_status, note, changed_by) VALUES ($1,$2,$3,$4,$5)',
      [id, rp.status, next, note, user.name]);
    auditDetails = { status: next, note };
  } else if (action === 'priority') {
    if (!can(user, 'administer')) { json(res, 401, { error: 'Insufficient role: LGA Admin or above can change priority' }); return; }
    const pri = String(body.priority ?? '');
    if (!PRIORITIES.includes(pri as (typeof PRIORITIES)[number])) { json(res, 400, { error: 'Invalid priority' }); return; }
    await sql.query('UPDATE reports SET priority=$1, ai_overridden=TRUE, updated_at=now() WHERE id=$2', [pri, id]);
    await sql.query('INSERT INTO status_history (report_id, new_status, note, changed_by) VALUES ($1,$2,$3,$4)',
      [id, rp.status, `Priority changed to ${pri} by ${user.name}`, user.name]);
    auditDetails = { priority: pri };
  } else if (action === 'category') {
    if (!can(user, 'administer')) { json(res, 401, { error: 'Insufficient role' }); return; }
    const cat = String(body.category ?? '');
    if (!CATEGORIES.includes(cat as (typeof CATEGORIES)[number])) { json(res, 400, { error: 'Invalid category' }); return; }
    await sql.query('UPDATE reports SET category=$1, ai_overridden=TRUE, updated_at=now() WHERE id=$2', [cat, id]);
    auditDetails = { category: cat };
  } else if (action === 'assign') {
    if (!can(user, 'administer')) { json(res, 401, { error: 'Insufficient role' }); return; }
    const dept = sanitizeText(body.department, 100);
    if (!dept) { json(res, 400, { error: 'Department is required' }); return; }
    await sql.query(
      `UPDATE reports SET assigned_department=$1, status=CASE WHEN status IN ('submitted','under_review','verified') THEN 'assigned' ELSE status END,
         updated_at=now() WHERE id=$2`, [dept, id]
    );
    await sql.query('INSERT INTO status_history (report_id, new_status, note, changed_by) VALUES ($1,$2,$3,$4)',
      [id, rp.status, `Assigned to ${dept}`, user.name]);
    auditDetails = { department: dept };
  } else if (action === 'coords') {
    // admin verifies/adjusts coordinates
    if (!can(user, 'review')) { json(res, 401, { error: 'Insufficient role' }); return; }
    const g = parseGps(`${body.lat ?? ''}, ${body.lng ?? ''}`);
    if (!g) { json(res, 400, { error: 'Coordinates not valid' }); return; }
    await sql.query(`UPDATE reports SET latitude=$1, longitude=$2, coords_source='admin_verified', updated_at=now() WHERE id=$3`, [g.lat, g.lng, id]);
    auditDetails = { lat: g.lat, lng: g.lng, source: 'admin_verified' };
  } else {
    json(res, 400, { error: 'Unknown action' });
    return;
  }

  await audit(user, `report.${action}`, 'report', String(id), auditDetails, clientIp(req));
  json(res, 200, { ok: true });
}

async function apiAdminComment(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const user = await requireAdmin(req, res, 'review');
  if (!user) return;
  const id = Number(params.id);
  const body = await readJson(req);
  const comment = sanitizeText(body.comment, 2000);
  if (!comment) { json(res, 400, { error: 'Comment is empty' }); return; }
  await sql.query('INSERT INTO admin_comments (report_id, user_id, author_name, comment) VALUES ($1,$2,$3,$4)', [id, user.id, user.name, comment]);
  await audit(user, 'report.comment', 'report', String(id), { length: comment.length }, clientIp(req));
  json(res, 200, { ok: true });
}

async function apiAdminReanalyze(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  const id = Number(params.id);
  const rp = await one<{ title: string; description: string }>('SELECT title, description FROM reports WHERE id = $1', [id]);
  if (!rp) { json(res, 404, { error: 'Not found' }); return; }
  try {
    const analysis = await analyzeReport(rp.title, rp.description);
    const recent = await many<{ ref_no: string; title: string; ai_summary: string | null }>(
      'SELECT ref_no, title, ai_summary FROM reports WHERE id <> $1 ORDER BY created_at DESC LIMIT 25', [id]
    );
    const matches = await findSimilarReports(rp.title, rp.description, recent);
    await sql.query(
      `UPDATE reports SET ai_category=$1, ai_priority=$2, ai_summary=$3, ai_actions=$4, ai_language_detected=$5,
         ai_confidence=$6, ai_assessed_at=now(), ai_similar=$7 WHERE id=$8`,
      [analysis.category, analysis.priority, analysis.summary,
       JSON.stringify({ urgency_reason: analysis.urgency_reason, actions: analysis.recommended_actions }),
       analysis.language_detected, analysis.confidence, JSON.stringify(matches), id]
    );
    await audit(user, 'report.reanalyze', 'report', String(id), null, clientIp(req));
    json(res, 200, { ok: true, analysis });
  } catch (e) {
    json(res, 502, { error: `AI engine unavailable: ${(e as Error).message.slice(0, 120)}` });
  }
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function apiExportCsv(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'view');
  if (!user) return;
  const rows = await many<Record<string, unknown>>(
    `SELECT ref_no, created_at, title, category, status, priority, state, lga, ward, community, specific_location,
            latitude, longitude, assigned_department, ai_category, ai_priority, is_demo
     FROM reports ORDER BY created_at DESC`
  );
  const headers = ['ref_no', 'created_at', 'title', 'category', 'status', 'priority', 'state', 'lga', 'ward',
    'community', 'specific_location', 'latitude', 'longitude', 'assigned_department', 'ai_category', 'ai_priority', 'is_demo'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(h === 'created_at' ? new Date(String(r[h])).toISOString() : r[h])).join(','));
  }
  await audit(user, 'export.csv', 'reports', null, { rows: rows.length }, clientIp(req));
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="afripulse-reports-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.end(lines.join('\n'));
}

// markdown -> minimal html for PDF rendering
function mdToHtml(md: string): string {
  const esc = (s: string) => escapeHtml(s);
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^##\s+/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h2>${esc(line.replace(/^##\s+/, ''))}</h2>`); }
    else if (/^#\s+/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h1>${esc(line.replace(/^#\s+/, ''))}</h1>`); }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${esc(line.replace(/^[-*]\s+/, ''))}</li>`); }
    else if (line.trim() === '') { if (inList) { out.push('</ul>'); inList = false; } }
    else { if (inList) { out.push('</ul>'); inList = false; } out.push(`<p>${esc(line)}</p>`); }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

async function apiExportPdf(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'view');
  if (!user) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const irId = Number(url.searchParams.get('id'));
  const ir = await one<{ title: string; content_md: string; period_start: string; period_end: string; generated_by: string }>(
    'SELECT title, content_md, period_start::text, period_end::text, generated_by FROM intelligence_reports WHERE id = $1', [irId]
  );
  if (!ir) { json(res, 404, { error: 'Intelligence report not found' }); return; }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; color: #17201b; font-size: 11pt; }
    h1 { color: #0b3d2e; font-size: 17pt; border-bottom: 2px solid #c9a227; padding-bottom: 6px; }
    h2 { color: #146b3a; font-size: 13pt; margin-top: 18px; }
    .meta { color: #5b6b62; font-size: 9pt; margin-bottom: 18px; }
    .brand { font-weight: bold; color: #0b3d2e; }
    footer { margin-top: 30px; border-top: 1px solid #dfe8e2; padding-top: 8px; color: #5b6b62; font-size: 8pt; }
  </style></head><body>
  <div class="brand">AFRIPULSE AI</div>
  <h1>${escapeHtml(ir.title)}</h1>
  <div class="meta">Period: ${escapeHtml(ir.period_start)} to ${escapeHtml(ir.period_end)} \u00b7 Generated by ${escapeHtml(ir.generated_by)} \u00b7 ${new Date().toISOString().slice(0, 10)}</div>
  ${mdToHtml(ir.content_md)}
  <footer>AFRIPULSE AI \u2014 Turning Africa\u2019s Community Challenges into Intelligent Solutions. AI-assisted analysis, human-verified data.</footer>
  </body></html>`;
  const tmp = join(tmpdir(), `afripulse-${Date.now()}.html`);
  const pdfPath = tmp.replace('.html', '.pdf');
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(tmp, html, 'utf8');
    await promisify(execFile)('weasyprint', [tmp, pdfPath], { timeout: 60_000 });
    const pdf = readFileSync(pdfPath);
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="afripulse-report-${irId}.pdf"` });
    res.end(pdf);
    await audit(user, 'export.pdf', 'intelligence_report', String(irId), null, clientIp(req));
  } catch (e) {
    json(res, 500, { error: `PDF generation failed: ${(e as Error).message.slice(0, 120)}` });
  }
}

async function apiGenerateIntelligence(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  const body = await readJson(req);
  const kind = body.kind === 'monthly' ? 'monthly' : body.kind === 'thematic' ? 'thematic' : 'weekly';
  const days = kind === 'monthly' ? 30 : 7;
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const statsRow = await one<Record<string, string>>(`SELECT count(*)::text total,
      count(*) FILTER (WHERE status='resolved')::text resolved FROM reports WHERE created_at >= $1`, [since]);
  const byStatus = await many<{ k: string; c: string }>(`SELECT status k, count(*)::text c FROM reports WHERE created_at >= $1 GROUP BY status`, [since]);
  const byPriority = await many<{ k: string; c: string }>(`SELECT priority k, count(*)::text c FROM reports WHERE created_at >= $1 AND priority IS NOT NULL GROUP BY priority`, [since]);
  const byCategory = await many<{ k: string; c: string }>(`SELECT category k, count(*)::text c FROM reports WHERE created_at >= $1 GROUP BY category ORDER BY count(*) DESC`, [since]);
  const byWard = await many<{ k: string; c: string; crit: string }>(`SELECT ward k, count(*)::text c, count(*) FILTER (WHERE priority='critical')::text crit FROM reports WHERE created_at >= $1 AND ward IS NOT NULL GROUP BY ward ORDER BY count(*) DESC`, [since]);
  const top = await many<Record<string, unknown>>(`SELECT ref_no, title, ward, category, priority FROM reports WHERE created_at >= $1
     AND priority IN ('critical','high') ORDER BY CASE priority WHEN 'critical' THEN 0 ELSE 1 END, created_at DESC LIMIT 8`, [since]);

  const stats: IntelligenceStats = {
    period: `${since} to ${new Date().toISOString().slice(0, 10)}`,
    totalReports: Number(statsRow?.total ?? 0),
    resolvedThisPeriod: Number(statsRow?.resolved ?? 0),
    byStatus: Object.fromEntries(byStatus.map((r) => [ST_LABEL[r.k]?.[0] ?? r.k, Number(r.c)])),
    byPriority: Object.fromEntries(byPriority.map((r) => [PR_LABEL[r.k]?.[0] ?? r.k, Number(r.c)])),
    byCategory: Object.fromEntries(byCategory.map((r) => [CAT_LABEL[r.k]?.[0] ?? r.k, Number(r.c)])),
    byWard: byWard.map((r) => ({ ward: r.k, count: Number(r.c), critical: Number(r.crit) })),
    topIssues: top.map((r) => ({ refNo: String(r.ref_no), title: String(r.title), ward: (r.ward as string) ?? null, category: CAT_LABEL[String(r.category)]?.[0] ?? String(r.category), priority: PR_LABEL[String(r.priority)]?.[0] ?? String(r.priority) })),
  };

  // Civic engagement signals (Phase 4): combine community voice with report data
  const civicPolls = await one<{ active: string; votes: string }>(
    `SELECT count(*) FILTER (WHERE active)::text active, (SELECT count(*) FROM poll_votes)::text votes FROM polls`
  );
  const civicPets = await many<{ t_en: string; sigs: number; target: number }>(
    `SELECT p.title_en t_en, count(s.id)::int sigs, p.signature_target target FROM petitions p
     LEFT JOIN petition_signatures s ON s.petition_id = p.id WHERE p.status = 'open'
     GROUP BY p.id ORDER BY p.created_at DESC LIMIT 5`
  );
  const civicFb = await one<{ pending: string }>("SELECT count(*)::text pending FROM feedback WHERE status = 'pending'");
  const topPoll = await one<{ q: string; v: string }>(
    `SELECT p.question_en q, (SELECT count(*) FROM poll_votes v WHERE v.poll_id = p.id)::text v
     FROM polls p WHERE p.active = TRUE ORDER BY p.created_at DESC LIMIT 1`
  );
  if (civicPolls || civicPets.length || civicFb) {
    stats.civic = {
      activePolls: Number(civicPolls?.active ?? 0),
      totalVotes: Number(civicPolls?.votes ?? 0),
      openPetitions: civicPets.map((p) => ({ title: p.t_en, signatures: p.sigs, target: p.target })),
      feedbackPending: Number(civicFb?.pending ?? 0),
      topPollQuestion: topPoll && Number(topPoll.v) > 0 ? topPoll.q : null,
    };
  }

  try {
    let contentMd: string; let title: string; let theme: string | null = null;
    if (kind === 'thematic') {
      theme = sanitizeText(body.theme, 80);
      if (!theme) { json(res, 400, { error: 'Theme is required for thematic briefs' }); return; }
      const extracts = await many<{ t: string; s: string | null; w: string | null }>(
        `SELECT title t, ai_summary s, ward w FROM reports WHERE created_at >= $1 AND (title ILIKE $2 OR ai_summary ILIKE $2 OR category ILIKE $2) ORDER BY created_at DESC LIMIT 12`,
        [since, `%${theme}%`]
      );
      if (!extracts.length) { json(res, 400, { error: 'No reports matched that theme in the selected period' }); return; }
      const result = await generateThematicBrief(theme, extracts.map((e) => `${e.t} (${e.w ?? 'ward n/a'}): ${e.s ?? 'no AI summary'}`), stats.period);
      contentMd = result.brief; title = result.title;
    } else {
      contentMd = await generateIntelligenceBrief(stats);
      title = `${kind === 'monthly' ? 'Monthly' : 'Weekly'} Governance Intelligence \u2014 ${new Date().toISOString().slice(0, 10)}`;
    }
    const saved = await one<{ id: number }>(
      'INSERT INTO intelligence_reports (kind, theme, title, period_start, period_end, content_md, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [kind, theme, title, since, new Date().toISOString().slice(0, 10), contentMd, user.name]
    );
    await audit(user, 'generate.intelligence', 'intelligence_report', String(saved!.id), { kind }, clientIp(req));
    json(res, 200, { ok: true, id: saved!.id, title, content: contentMd });
  } catch (e) {
    json(res, 502, { error: `AI engine unavailable: ${(e as Error).message.slice(0, 140)}` });
  }
}

async function apiAdminUsers(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'users');
  if (!user) return;
  if (req.method === 'GET') {
    const rows = await many<Record<string, unknown>>('SELECT id, name, email, role, lga, active, created_at FROM users ORDER BY id');
    json(res, 200, { users: rows });
    return;
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const errors = validate(body, {
      name: { required: true, max: 80, label: 'Name' },
      email: { required: true, max: 120, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, label: 'Email' },
      password: { required: true, min: 8, max: 100, label: 'Password' },
      role: { required: true, oneOf: [...ROLES], label: 'Role' },
    });
    if (Object.keys(errors).length) { json(res, 400, { fields: errors }); return; }
    const exists = await one<{ id: number }>('SELECT id FROM users WHERE email = $1', [sanitizeText(body.email, 120).toLowerCase()]);
    if (exists) { json(res, 400, { error: 'A user with that email already exists' }); return; }
    const created = await one<{ id: number }>(
      'INSERT INTO users (name, email, password_hash, role, lga) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [sanitizeText(body.name, 80), sanitizeText(body.email, 120).toLowerCase(), hashPassword(String(body.password)), String(body.role), body.lga ? sanitizeText(body.lga, 60) : null]
    );
    await audit(user, 'user.create', 'user', String(created!.id), { role: body.role }, clientIp(req));
    json(res, 201, { ok: true, id: created!.id });
    return;
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const targetId = Number(new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop());
    const target = await one<{ id: number; role: Role; active: boolean }>('SELECT id, role, active FROM users WHERE id = $1', [targetId]);
    if (!target) { json(res, 404, { error: 'User not found' }); return; }
    if (target.id === user.id) { json(res, 400, { error: 'You cannot modify your own account here' }); return; }
    if (typeof body.active === 'boolean') {
      await sql.query('UPDATE users SET active = $1 WHERE id = $2', [body.active, targetId]);
      await audit(user, body.active ? 'user.activate' : 'user.deactivate', 'user', String(targetId), null, clientIp(req));
    }
    if (body.role && ROLES.includes(String(body.role) as (typeof ROLES)[number])) {
      await sql.query('UPDATE users SET role = $1 WHERE id = $2', [String(body.role), targetId]);
      await audit(user, 'user.role_change', 'user', String(targetId), { role: body.role }, clientIp(req));
    }
    if (body.reset_password === true) {
      // Admin-generated temporary password, shown once, never stored in plain text.
      const temp = 'AFR-' + crypto.randomBytes(6).toString('base64url');
      await sql.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(temp), targetId]);
      await audit(user, 'user.password_reset', 'user', String(targetId), null, clientIp(req));
      json(res, 200, { ok: true, temporary_password: temp });
      return;
    }
    json(res, 200, { ok: true });
  }
}

async function apiAudit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await requireAdmin(req, res, 'administer');
  if (!user) return;
  const rows = await many<Record<string, unknown>>(
    `SELECT a.actor_name, a.action, a.entity, a.entity_id, a.details, a.ip, a.created_at, u.role
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 200`
  );
  json(res, 200, {
    logs: rows.map((r) => ({
      ...r,
      details: r.details ? (() => { try { return JSON.parse(String(r.details)); } catch { return String(r.details); } })() : null,
      created_at: new Date(String(r.created_at)).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
    })),
  });
}

// ---------- admin pages ----------
async function adminLoginPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (user) { res.writeHead(302, { location: '/admin' }); res.end(); return; }
  loginPage(res);
}

async function adminDashboardPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const scripts = `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"><\/script>
  <script>
  (function(){
    getJson('/api/admin/stats').then(function(r){
      var s = r.data;
      var el = function(id){ return document.getElementById(id); };
      el('kpi-total').textContent = s.totals.total;
      el('kpi-review').textContent = s.totals.review;
      el('kpi-critical').textContent = s.totals.critical;
      el('kpi-resolved').textContent = s.totals.resolved;
      el('kpi-inprog').textContent = s.totals.inprog;
      el('kpi-submitted').textContent = s.totals.submitted;
      new Chart(el('ch-category'), { type: 'doughnut', data: {
        labels: s.byCategory.map(function(x){ return x.label; }),
        datasets: [{ data: s.byCategory.map(function(x){ return x.count; }),
          backgroundColor: ['#146b3a','#1a7f46','#3e9b5f','#6db384','#9ec9aa','#c9a227','#e9b949','#b54708','#b42318','#64748b'] }]},
        options: { plugins: { legend: { position: 'right' } }, maintainAspectRatio: false } });
      new Chart(el('ch-priority'), { type: 'bar', data: {
        labels: s.byPriority.map(function(x){ return x.label; }),
        datasets: [{ label: 'Reports', data: s.byPriority.map(function(x){ return x.count; }),
          backgroundColor: ['#b42318','#fda29b','#fdba8c','#146b3a'] }]},
        options: { plugins: { legend: { display: false } }, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
      new Chart(el('ch-trend'), { type: 'line', data: {
        labels: s.trend.map(function(x){ return x.month; }),
        datasets: [{ label: 'New reports', data: s.trend.map(function(x){ return x.count; }),
          borderColor: '#146b3a', backgroundColor: 'rgba(20,107,58,.12)', fill: true, tension: .35 }]},
        options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
      new Chart(el('ch-ward'), { type: 'bar', data: {
        labels: s.byWard.slice(0, 8).map(function(x){ return x.ward; }),
        datasets: [
          { label: 'All reports', data: s.byWard.slice(0, 8).map(function(x){ return x.count; }), backgroundColor: '#146b3a' },
          { label: 'Critical', data: s.byWard.slice(0, 8).map(function(x){ return x.critical; }), backgroundColor: '#b42318' }
        ]},
        options: { maintainAspectRatio: false, scales: { x: { stacked: false }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    });
  })();
  <\/script>`;
  const content = `
  <div class="kpi-grid">
    <div class="kpi"><b id="kpi-total">–</b><span>Total community reports</span></div>
    <div class="kpi"><b id="kpi-review">–</b><span>Pending / under review</span></div>
    <div class="kpi k-critical"><b id="kpi-critical">–</b><span>Critical priority</span></div>
    <div class="kpi"><b id="kpi-resolved">–</b><span>Resolved</span></div>
    <div class="kpi"><b id="kpi-inprog">–</b><span>In progress</span></div>
    <div class="kpi"><b id="kpi-submitted">–</b><span>Awaiting first review</span></div>
  </div>
  <div class="dash-grid">
    <div class="chart-card"><h3>Reports by category</h3><div class="chart-box"><canvas id="ch-category"></canvas></div></div>
    <div class="chart-card"><h3>By priority</h3><div class="chart-box"><canvas id="ch-priority"></canvas></div></div>
    <div class="chart-card"><h3>Monthly reporting trend (6 months)</h3><div class="chart-box"><canvas id="ch-trend"></canvas></div></div>
    <div class="chart-card"><h3>Top wards</h3><div class="chart-box"><canvas id="ch-ward"></canvas></div></div>
  </div>
  <div style="margin-top:22px;display:flex;gap:12px;flex-wrap:wrap">
    <a class="btn btn-ghost btn-sm" href="/admin/reports">Open reports queue</a>
    <a class="btn btn-ghost btn-sm" href="/admin/intelligence">Generate intelligence report</a>
    <a class="btn btn-ghost btn-sm" href="/api/admin/export.csv">\u2b07 Download CSV</a>
  </div>`;
  const html = adminHtml(user, 'dashboard', 'Governance Dashboard', content, scripts);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function adminReportsPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const content = `
  <div class="filterbar">
    <div><label>Search</label><input id="f-q" placeholder="Title, ref no, community"/></div>
    <div><label>Status</label><select id="f-status"><option value="">All</option>${STATUSES.map((s) => `<option value="${s}">${ST_LABEL[s][0]}</option>`).join('')}</select></div>
    <div><label>Category</label><select id="f-cat"><option value="">All</option>${CATEGORIES.map((c) => `<option value="${c}">${CAT_LABEL[c][0]}</option>`).join('')}</select></div>
    <div><label>Priority</label><select id="f-pri"><option value="">All</option>${PRIORITIES.map((p) => `<option value="${p}">${PR_LABEL[p][0]}</option>`).join('')}</select></div>
    <div><label>State</label><select id="f-state"><option value="">All</option></select></div>
    <div><label>LGA</label><select id="f-lga"><option value="">All</option></select></div>
    <div><button class="btn btn-primary btn-sm" id="f-apply">Apply</button></div>
  </div>
  <div class="tablewrap"><table class="tbl"><thead><tr>
    <th>Ref</th><th>Title</th><th>Category</th><th>Ward</th><th>Status</th><th>Priority</th><th>Received</th><th></th>
  </tr></thead><tbody id="rows"></tbody></table></div>
  <div style="display:flex;gap:10px;align-items:center;margin-top:16px" id="pager"></div>
  <script>
  (function(){
    var page = 1;
    function load() {
      var p = new URLSearchParams({
        q: document.getElementById('f-q').value, status: document.getElementById('f-status').value,
        category: document.getElementById('f-cat').value, priority: document.getElementById('f-pri').value,
        state: document.getElementById('f-state').value, lga: document.getElementById('f-lga').value, page: page
      });
      getJson('/api/admin/reports?' + p.toString()).then(function(r){
        var rows = document.getElementById('rows');
        rows.innerHTML = (r.data.reports || []).map(function(rp){
          return '<tr class="rowlink" data-id="' + rp.id + '"><td><b>' + rp.ref_no + '</b>' + (rp.is_demo ? ' <span class="badge pr-low" title="Demonstration data">DEMO</span>' : '') + '</td>' +
            '<td>' + rp.title + '</td><td>' + rp.category_label + '</td><td>' + (rp.ward || '—') + '</td>' +
            '<td>' + rp.status_badge + '</td><td>' + rp.priority_badge + '</td><td class="muted small">' + rp.created_at + '</td>' +
            '<td><a href="/admin/reports/' + rp.id + '">Open</a></td></tr>';
        }).join('');
        var total = r.data.total, ps = r.data.pageSize;
        var pages = Math.max(1, Math.ceil(total / ps));
        document.getElementById('pager').innerHTML =
          '<button class="btn btn-ghost btn-sm" id="prev" ' + (page <= 1 ? 'disabled' : '') + '>\u2190 Prev</button>' +
          '<span class="muted small">Page ' + page + ' of ' + pages + ' \u00b7 ' + total + ' reports</span>' +
          '<button class="btn btn-ghost btn-sm" id="next" ' + (page >= pages ? 'disabled' : '') + '>Next \u2192</button>';
        document.getElementById('prev').onclick = function(){ page--; load(); };
        document.getElementById('next').onclick = function(){ page++; load(); };
        Array.prototype.forEach.call(rows.children, function(tr){
          tr.onclick = function(ev){ if (ev.target.tagName !== 'A') location.href = '/admin/reports/' + tr.dataset.id; };
        });
      });
    }
    // National filters: states + state-dependent LGAs
    getJson('/api/geo/states').then(function(r){
      var sel = document.getElementById('f-state');
      (r.data.states || []).forEach(function(s){ var o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
    });
    document.getElementById('f-state').addEventListener('change', function(){
      var sel = document.getElementById('f-lga');
      sel.innerHTML = '<option value="">All</option>';
      var state = document.getElementById('f-state').value;
      if (!state) return;
      getJson('/api/geo/lgas?state=' + encodeURIComponent(state)).then(function(r){
        (r.data.lgas || []).forEach(function(l){ var o = document.createElement('option'); o.value = l; o.textContent = l; sel.appendChild(o); });
      });
    });
    document.getElementById('f-apply').onclick = function(){ page = 1; load(); };
    load();
  })();
  <\/script>`;
  const html = adminHtml(user, 'reports', 'Reports Queue', content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function adminReportDetailPage(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const user = await userFromRequest(req);
  if (!user) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const id = Number(params.id);
  const rp = await one<{ ref_no: string; title: string }>('SELECT ref_no, title FROM reports WHERE id = $1', [id]);
  if (!rp) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Report not found'); return; }
  const isAdmin = can(user, 'administer');
  const content = `
  <a href="/admin/reports" class="muted small">\u2190 Back to queue</a>
  <div id="detail"><p class="muted">Loading\u2026</p></div>
  <script>
  (function(){
    var canAdminister = ${isAdmin ? 'true' : 'false'};
    var ST = ${JSON.stringify(Object.fromEntries(STATUSES.map((s) => [s, ST_LABEL[s][0]])))};
    var PRI = ${JSON.stringify(Object.fromEntries(PRIORITIES.map((p) => [p, PR_LABEL[p][0]])))};
    var CAT = ${JSON.stringify(Object.fromEntries(CATEGORIES.map((c) => [c, CAT_LABEL[c][0]])))};
    var box = document.getElementById('detail');

    getJson('/api/admin/reports/${id}').then(function(r){
      if (!r.ok) { box.innerHTML = '<div class="notice notice-err">Failed to load report</div>'; return; }
      var rp = r.data.report;
      var ai = rp.ai_detail || {};
      var aiActions = ai.actions || [];

      var html = '<div class="detail-grid"><div>';
      html += '<div class="card">';
      html += '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">';
      html += '<div><h3 style="margin:0">' + esc(rp.title) + '</h3><span class="muted small">' + rp.ref_no + ' \\u00b7 ' + rp.created_at + (rp.is_demo ? ' \\u00b7 <b>DEMONSTRATION DATA</b>' : '') + '</span></div>';
      html += '<div style="display:flex;gap:6px">' + rp.priority_badge_html + rp.status_badge_html + '</div></div>';
      html += '<dl class="kv">' +
        '<dt>Category</dt><dd>' + (CAT[rp.category] || rp.category) + '</dd>' +
        '<dt>Location</dt><dd>' + [rp.specific_location, rp.community, rp.ward, rp.lga, rp.state].filter(Boolean).join(', ') + '</dd>' +
        '<dt>GPS</dt><dd>' + (rp.latitude != null ? rp.latitude + ', ' + rp.longitude + ' (' + (rp.coords_source === 'admin_verified' ? 'admin verified' : 'citizen GPS') + ')' : 'not provided') + '</dd>' +
        '<dt>Contact</dt><dd>' + (rp.contact_name || 'anonymous') + (rp.contact_phone ? ' \\u00b7 ' + rp.contact_phone : '') + '</dd>' +
        '<dt>Language</dt><dd>' + (rp.language || 'en') + (rp.ai_language_detected ? ' (AI detected: ' + rp.ai_language_detected + ')' : '') + '</dd>' +
        '<dt>Department</dt><dd>' + (rp.assigned_department || 'not assigned') + '</dd>' +
        '</dl>';
      if (rp.image_id) html += '<img src="/api/image/' + rp.image_id + '" alt="Report photo" style="max-width:100%;border-radius:10px;margin-top:12px;max-height:320px"/>';
      html += '<h4 style="margin-top:18px">Citizen description</h4><p style="white-space:pre-wrap">' + esc(rp.description) + '</p></div>';

      // AI assessment box
      html += '<div class="ai-box" style="margin-top:20px"><h4>\\u2726 AI Assessment \\u2014 suggestion only, not a verified fact</h4>' +
        '<dl class="kv" style="grid-template-columns:120px 1fr">' +
        '<dt>AI category</dt><dd>' + (CAT[rp.ai_category] || rp.ai_category || '—') + '</dd>' +
        '<dt>AI priority</dt><dd>' + (PRI[rp.ai_priority] || rp.ai_priority || '—') + (rp.ai_confidence != null ? ' (confidence ' + Math.round(rp.ai_confidence * 100) + '%)' : '') + '</dd>' +
        '<dt>Urgency reason</dt><dd>' + esc(ai.urgency_reason || '—') + '</dd>' +
        '<dt>AI summary</dt><dd>' + esc(rp.ai_summary || '—') + '</dd>' +
        '</dl>';
      if (aiActions.length) html += '<h4 style="margin-top:10px">Recommended actions</h4><ul style="margin:6px 0 0;padding-left:20px">' + aiActions.map(function(a){ return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>';
      html += '</div>';

      // similar reports
      if ((r.data.similar || []).length) {
        html += '<div class="card" style="margin-top:20px"><h4>Possible similar reports (AI similarity)</h4><ul style="margin:8px 0 0;padding-left:20px">' +
          r.data.similar.map(function(s){ return '<li><a href="/admin/reports-by-ref/' + encodeURIComponent(s.ref_no) + '">' + s.ref_no + '</a> \\u00b7 ' + Math.round(s.sim * 100) + '% \\u00b7 ' + esc(s.title) + '</li>'; }).join('') + '</ul></div>';
      }

      // status history + comments
      html += '<div class="card" style="margin-top:20px"><h3>Status history</h3><ul class="timeline">' +
        r.data.history.map(function(h){
          return '<li><div class="tl-when">' + h.created_at + ' \\u00b7 ' + esc(h.changed_by) + '</div><div><b>' + (ST[h.new_status] || h.new_status) + '</b>' + (h.note ? '<div class="muted small">' + esc(h.note) + '</div>' : '') + '</div></li>';
        }).join('') + '</ul></div>';

      html += '<div class="card" style="margin-top:20px"><h3>Admin comments</h3><div id="comments">' +
        (r.data.comments.length ? r.data.comments.map(function(c){
          return '<div style="border-top:1px solid var(--line);padding:10px 0"><b>' + esc(c.author_name) + '</b> <span class="muted small">' + c.created_at + '</span><p style="margin:4px 0 0">' + esc(c.comment) + '</p></div>';
        }).join('') : '<p class="muted small">No comments yet.</p>') + '</div>' +
        '<textarea id="newComment" placeholder="Add an internal comment\\u2026" style="width:100%;min-height:70px;margin-top:10px;padding:10px;border:1.5px solid var(--line);border-radius:10px;font:inherit"></textarea>' +
        '<button class="btn btn-ghost btn-sm" style="margin-top:8px" id="addComment">Add comment</button></div>';

      html += '</div><div>';

      // actions sidebar
      html += '<div class="card"><h3>Actions</h3>';
      html += '<div class="field"><label>Update status</label><select id="a-status">' +
        Object.keys(ST).map(function(k){ return '<option value="' + k + '"' + (rp.status === k ? ' selected' : '') + '>' + ST[k] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field" style="margin-top:10px"><label>Note (required for rejection)</label><input type="text" id="a-note"/></div>' +
        '<button class="btn btn-primary btn-sm" style="margin-top:10px" id="doStatus">Update status</button>';
      if (canAdminister) {
        html += '<hr style="border:none;border-top:1px solid var(--line);margin:18px 0"/>' +
          '<div class="field"><label>Set priority (overrides AI)</label><select id="a-priority">' +
          Object.keys(PRI).map(function(k){ return '<option value="' + k + '"' + (rp.priority === k ? ' selected' : '') + '>' + PRI[k] + '</option>'; }).join('') + '</select></div>' +
          '<button class="btn btn-ghost btn-sm" style="margin-top:8px" id="doPriority">Save priority</button>' +
          '<div class="field" style="margin-top:14px"><label>Assign department</label><input type="text" id="a-dept" value="' + esc(rp.assigned_department || '') + '" placeholder="e.g. Water Resources, PHC, Works"/></div>' +
          '<button class="btn btn-ghost btn-sm" style="margin-top:8px" id="doAssign">Assign</button>' +
          '<div class="field" style="margin-top:14px"><label>Correct category</label><select id="a-cat">' +
          Object.keys(CAT).map(function(k){ return '<option value="' + k + '"' + (rp.category === k ? ' selected' : '') + '>' + CAT[k] + '</option>'; }).join('') + '</select></div>' +
          '<button class="btn btn-ghost btn-sm" style="margin-top:8px" id="doCategory">Save category</button>' +
          '<hr style="border:none;border-top:1px solid var(--line);margin:18px 0"/>' +
          '<button class="btn btn-ghost btn-sm" id="doReanalyze">\\u21bb Re-run AI analysis</button>';
      }
      html += '</div><div id="actionMsg"></div></div></div>';

      box.innerHTML = html;
      wire();
    });

    function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function msg(ok, text){ document.getElementById('actionMsg').innerHTML = '<div class="notice ' + (ok ? 'notice-ok">\\u2713 ' : 'notice-err">') + text + '</div>'; }
    function wire(){
      document.getElementById('doStatus').onclick = function(){
        patchJson('/api/admin/reports/${id}', { action: 'status', status: document.getElementById('a-status').value, note: document.getElementById('a-note').value })
          .then(function(r){ if (r.ok) location.reload(); else msg(false, r.data.error || 'Failed'); });
      };
      var dp = document.getElementById('doPriority');
      if (dp) dp.onclick = function(){
        patchJson('/api/admin/reports/${id}', { action: 'priority', priority: document.getElementById('a-priority').value })
          .then(function(r){ if (r.ok) location.reload(); else msg(false, r.data.error || 'Failed'); });
      };
      var da = document.getElementById('doAssign');
      if (da) da.onclick = function(){
        patchJson('/api/admin/reports/${id}', { action: 'assign', department: document.getElementById('a-dept').value })
          .then(function(r){ if (r.ok) location.reload(); else msg(false, r.data.error || 'Failed'); });
      };
      var dc = document.getElementById('doCategory');
      if (dc) dc.onclick = function(){
        patchJson('/api/admin/reports/${id}', { action: 'category', category: document.getElementById('a-cat').value })
          .then(function(r){ if (r.ok) location.reload(); else msg(false, r.data.error || 'Failed'); });
      };
      var dr = document.getElementById('doReanalyze');
      if (dr) dr.onclick = function(){
        dr.disabled = true; dr.textContent = 'Running AI analysis\\u2026';
        postJson('/api/admin/reports/${id}/reanalyze', {}).then(function(r){
          if (r.ok) location.reload(); else { dr.disabled = false; msg(false, r.data.error || 'Failed'); dr.textContent = '\\u21bb Re-run AI analysis'; }
        });
      };
      document.getElementById('addComment').onclick = function(){
        postJson('/api/admin/reports/${id}/comment', { comment: document.getElementById('newComment').value })
          .then(function(r){ if (r.ok) location.reload(); else msg(false, r.data.error || 'Failed'); });
      };
    }
  })();
  </script>`;
  const html = adminHtml(user, 'reports', 'Report ' + rp.ref_no, content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

// resolve a ref to its id and redirect to the detail page
async function adminReportByRef(_req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const rp = await one<{ id: number }>('SELECT id FROM reports WHERE ref_no = $1', [decodeURIComponent(params.ref)]);
  if (!rp) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Report not found'); return; }
  res.writeHead(302, { location: `/admin/reports/${rp.id}` });
  res.end();
}

async function adminIntelligencePage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const saved = await many<Record<string, unknown>>('SELECT id, kind, title, period_start::text, period_end::text, created_at FROM intelligence_reports ORDER BY created_at DESC LIMIT 30');
  const content = `
  <div class="dash-grid" style="grid-template-columns: 1fr 1.4fr">
    <div class="card">
      <h3>Generate a new report</h3>
      <p class="muted small">The AI engine writes the narrative strictly from platform data for the selected period. Every output is a draft for administrative review.</p>
      <div class="field" style="margin-top:14px"><label>Report type</label>
        <select id="gen-kind">
          <option value="weekly">Weekly community situation report (last 7 days)</option>
          <option value="monthly">Monthly governance intelligence report (last 30 days)</option>
          <option value="thematic">Thematic summary (needs assessment)</option>
        </select>
      </div>
      <div class="field" style="margin-top:12px" id="theme-wrap"><label>Theme (for thematic summaries)</label>
        <input type="text" id="gen-theme" placeholder="e.g. Water, Education, Security, Agriculture"/>
      </div>
      <button class="btn btn-primary" style="margin-top:16px" id="gen-btn">Generate with AI</button>
      <div id="gen-msg"></div>
    </div>
    <div class="card">
      <h3>Saved intelligence reports</h3>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Title</th><th>Type</th><th>Period</th><th>By</th><th></th></tr></thead>
      <tbody>${saved.map((s) => `<tr><td><a href="#" data-id="${s.id}" class="view-ir">${escapeHtml(String(s.title))}</a></td><td>${escapeHtml(String(s.kind))}</td><td class="muted small">${escapeHtml(String(s.period_start))} \u2192 ${escapeHtml(String(s.period_end))}</td><td class="muted small">${escapeHtml(String(s.generated_by ?? ''))}</td>
      <td><a href="/api/admin/export/pdf?id=${s.id}">PDF</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None saved yet.</td></tr>'}</tbody></table></div>
    </div>
  </div>
  <div id="preview" style="margin-top:22px"></div>
  <script>
  (function(){
    var themeWrap = document.getElementById('theme-wrap');
    function syncTheme(){ themeWrap.style.display = document.getElementById('gen-kind').value === 'thematic' ? '' : 'none'; }
    document.getElementById('gen-kind').addEventListener('change', syncTheme); syncTheme();
    document.getElementById('gen-btn').onclick = function(){
      var btn = this; btn.disabled = true; btn.textContent = 'AI is writing\\u2026 (this can take ~20 seconds)';
      document.getElementById('gen-msg').innerHTML = '';
      postJson('/api/admin/intelligence/generate', {
        kind: document.getElementById('gen-kind').value,
        theme: document.getElementById('gen-theme').value
      }).then(function(r){
        btn.disabled = false; btn.textContent = 'Generate with AI';
        if (r.ok) {
          document.getElementById('gen-msg').innerHTML = '<div class="notice notice-ok">\\u2713 Generated and saved.</div>';
          document.getElementById('preview').innerHTML = '<div class="card"><h3>' + r.data.title + '</h3><div style="white-space:pre-wrap;font-size:.92rem">' + r.data.content.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div></div>';
        } else {
          document.getElementById('gen-msg').innerHTML = '<div class="notice notice-err">' + (r.data.error || 'Generation failed') + '</div>';
        }
      });
    };
    Array.prototype.forEach.call(document.querySelectorAll('.view-ir'), function(a){
      a.onclick = function(ev){
        ev.preventDefault();
        getJson('/api/admin/intelligence/' + a.dataset.id).then(function(r){
          if (r.ok) document.getElementById('preview').innerHTML = '<div class="card"><h3>' + r.data.title + '</h3><div style="white-space:pre-wrap;font-size:.92rem">' + r.data.content_md.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div></div>';
        });
      };
    });
  })();
  <\/script>`;
  const html = adminHtml(user, 'intelligence', 'AI Report Generator', content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function adminAuditPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user || !can(user, 'administer')) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const content = `
  <div class="tablewrap"><table class="tbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody id="rows"></tbody></table></div>
  <script>
  getJson('/api/admin/audit').then(function(r){
    document.getElementById('rows').innerHTML = (r.data.logs || []).map(function(l){
      return '<tr><td class="muted small" style="white-space:nowrap">' + l.created_at + '</td><td><b>' + l.actor_name + '</b>' + (l.role ? ' <span class="muted small">(' + l.role + ')</span>' : '') + '</td>' +
        '<td><code>' + l.action + '</code></td><td>' + l.entity + (l.entity_id ? ' #' + l.entity_id : '') + '</td>' +
        '<td class="muted small">' + (l.details ? JSON.stringify(l.details) : '—') + '</td><td class="muted small">' + (l.ip || '') + '</td></tr>';
    }).join('');
  });
  </script>`;
  const html = adminHtml(user, 'audit', 'Audit Log', content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function adminHubPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user || !(user.role === 'super_admin' || user.role === 'lga_admin')) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const content = `
  <div class="dash-grid" style="grid-template-columns: 1fr 1fr">
    <div class="card">
      <h3>Innovation submissions (review queue)</h3>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Name</th><th>Category</th><th>Status</th><th></th></tr></thead><tbody id="i-rows"></tbody></table></div>
    </div>
    <div class="card">
      <h3>Add an opportunity</h3>
      <div class="stack" style="max-width:none">
        <input id="o-title" type="text" placeholder="Title"/>
        <textarea id="o-desc" rows="2" placeholder="Description (who it is for, what it offers)"></textarea>
        <div style="display:flex;gap:10px">
          <select id="o-kind" style="flex:1"><option value="grant">Grant</option><option value="funding">Funding</option><option value="training">Training</option><option value="competition">Competition</option><option value="resource">Resource</option></select>
          <input id="o-deadline" type="date" style="width:160px"/>
        </div>
        <input id="o-provider" type="text" placeholder="Provider (optional)"/>
        <input id="o-link" type="url" placeholder="Link (optional, https://...)"/>
        <button class="btn btn-primary btn-sm" id="o-add">Publish opportunity</button>
        <div id="o-msg"></div>
      </div>
      <div class="tablewrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>Title</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody id="op-rows"></tbody></table></div>
    </div>
  </div>
  <script>
  (function(){
    var E = function(id){ return document.getElementById(id); };
    function load(){
      getJson('/api/admin/hub').then(function(r){
        E('i-rows').innerHTML = (r.data.innovations||[]).map(function(i){
          return '<tr><td><b>' + i.name + '</b><br><span class="muted small">' + (i.summary||'').slice(0,70) + '</span></td><td>' + i.category + '</td><td>' + i.status + '</td>' +
            '<td>' + (i.status !== 'published' ? '<button class="btn btn-ghost btn-sm i-set" data-id="' + i.id + '" data-status="published">Publish</button> ' : '') +
            (i.status !== 'hidden' ? '<button class="btn btn-ghost btn-sm i-set" data-id="' + i.id + '" data-status="hidden">Hide</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan=4 class="muted">No submissions yet.</td></tr>';
        Array.prototype.forEach.call(document.querySelectorAll('.i-set'), function(b){
          b.onclick = function(){ patchJson('/api/admin/hub/innovations/' + b.dataset.id, { status: b.dataset.status }).then(load); };
        });
        E('op-rows').innerHTML = (r.data.opportunities||[]).map(function(o){
          return '<tr><td>' + o.title + '</td><td>' + o.kind + '</td><td>' + o.status + '</td>' +
            '<td>' + (o.status === 'published' ? '<button class="btn btn-ghost btn-sm o-set" data-id="' + o.id + '" data-status="expired">Mark expired</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan=4 class="muted">None yet.</td></tr>';
        Array.prototype.forEach.call(document.querySelectorAll('.o-set'), function(b){
          b.onclick = function(){ patchJson('/api/admin/hub/opportunities/' + b.dataset.id, { status: b.dataset.status }).then(load); };
        });
      });
    }
    E('o-add').onclick = function(){
      postJson('/api/admin/hub', { title: E('o-title').value, description: E('o-desc').value, kind: E('o-kind').value, deadline: E('o-deadline').value || null, provider: E('o-provider').value || null, link: E('o-link').value || null }).then(function(r){
        if (r.ok) { E('o-title').value = E('o-desc').value = E('o-provider').value = E('o-link').value = ''; E('o-msg').innerHTML = '<div class="notice notice-ok">Published.</div>'; }
        else E('o-msg').innerHTML = '<div class="notice notice-err">' + ((r.data && (r.data.error || JSON.stringify(r.data.fields))) || 'Failed') + '</div>';
        load();
      });
    };
    load();
  })();
  <\/script>`;
  const html = adminHtml(user, 'hub', 'Innovation Hub', content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function adminCivicPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user || !(user.role === 'super_admin' || user.role === 'lga_admin')) { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const content = `
  <div class="dash-grid" style="grid-template-columns: 1fr 1fr">
    <div class="card">
      <h3>Polls</h3>
      <div class="stack" style="max-width:none">
        <input id="p-qen" type="text" placeholder="Question (English)"/>
        <input id="p-qha" type="text" placeholder="Question (Hausa)"/>
        <input id="p-o1en" type="text" placeholder="Option 1 (English)"/>
        <input id="p-o1ha" type="text" placeholder="Option 1 (Hausa)"/>
        <input id="p-o2en" type="text" placeholder="Option 2 (English)"/>
        <input id="p-o2ha" type="text" placeholder="Option 2 (Hausa)"/>
        <input id="p-o3en" type="text" placeholder="Option 3 (English, optional)"/>
        <input id="p-o3ha" type="text" placeholder="Option 3 (Hausa, optional)"/>
        <button class="btn btn-primary btn-sm" id="p-add">Create poll</button>
      </div>
      <div class="tablewrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>Question</th><th>Votes</th><th></th></tr></thead><tbody id="p-rows"></tbody></table></div>
    </div>
    <div class="card">
      <h3>Petitions</h3>
      <div class="stack" style="max-width:none">
        <input id="t-ten" type="text" placeholder="Title (English)"/>
        <input id="t-tha" type="text" placeholder="Title (Hausa)"/>
        <textarea id="t-ben" rows="2" placeholder="Body (English)"></textarea>
        <textarea id="t-bha" rows="2" placeholder="Body (Hausa)"></textarea>
        <input id="t-target" type="number" min="10" value="100" placeholder="Signature target"/>
        <button class="btn btn-primary btn-sm" id="t-add">Create petition</button>
      </div>
      <div class="tablewrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>Title</th><th>Sigs</th><th></th></tr></thead><tbody id="t-rows"></tbody></table></div>
    </div>
  </div>
  <div class="dash-grid" style="grid-template-columns: 1fr 1fr; margin-top:20px">
    <div class="card">
      <h3>Community projects</h3>
      <div class="stack" style="max-width:none">
        <input id="j-name" type="text" placeholder="Project name"/>
        <input id="j-ward" type="text" placeholder="Ward (optional)"/>
        <textarea id="j-desc" rows="2" placeholder="Description"></textarea>
        <div style="display:flex;gap:10px">
          <select id="j-status" style="flex:1"><option value="planning">Planning</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="suspended">Suspended</option></select>
          <input id="j-progress" type="number" min="0" max="100" value="0" style="width:110px" placeholder="Progress %"/>
        </div>
        <button class="btn btn-primary btn-sm" id="j-add">Create project</button>
      </div>
      <div class="tablewrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>Project</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody id="j-rows"></tbody></table></div>
    </div>
    <div class="card">
      <h3>Feedback moderation</h3>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>From</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody id="f-rows"></tbody></table></div>
    </div>
  </div>
  <div class="card" style="margin-top:20px" id="proj-update-box" style="display:none">
    <h3>Add progress update</h3>
    <div class="stack" style="max-width:none">
      <input type="hidden" id="pu-id"/>
      <span class="muted small" id="pu-name"></span>
      <textarea id="pu-note" rows="2" placeholder="Update note (what changed on this project)"></textarea>
      <button class="btn btn-primary btn-sm" id="pu-add">Add update</button>
      <button class="btn btn-ghost btn-sm" id="pu-cancel">Cancel</button>
    </div>
  </div>
  <script>
  (function(){
    var E = function(id){ return document.getElementById(id); };
    function loadPolls(){
      getJson('/api/admin/polls').then(function(r){
        E('p-rows').innerHTML = (r.data.polls||[]).map(function(p){
          return '<tr><td>' + p.question_en + '</td><td>' + p.votes + '</td><td><button class="btn btn-ghost btn-sm p-toggle" data-id="' + p.id + '" data-active="' + p.active + '">' + (p.active ? 'Close' : 'Reopen') + '</button></td></tr>';
        }).join('');
        Array.prototype.forEach.call(document.querySelectorAll('.p-toggle'), function(b){
          b.onclick = function(){ patchJson('/api/admin/polls/' + b.dataset.id, { active: b.dataset.active !== 'true' }).then(loadPolls); };
        });
      });
    }
    E('p-add').onclick = function(){
      var options = [];
      [[E('p-o1en'),E('p-o1ha')],[E('p-o2en'),E('p-o2ha')],[E('p-o3en'),E('p-o3ha')]].forEach(function(pair){
        if (pair[0].value.trim()) options.push({ label_en: pair[0].value.trim(), label_ha: pair[1].value.trim() || pair[0].value.trim() });
      });
      postJson('/api/admin/polls', { question_en: E('p-qen').value, question_ha: E('p-qha').value, options: options }).then(function(r){
        E('p-qen').value = E('p-qha').value = E('p-o1en').value = E('p-o1ha').value = E('p-o2en').value = E('p-o2ha').value = E('p-o3en').value = E('p-o3ha').value = '';
        if (!r.ok) alert((r.data && r.data.error) || 'Failed'); loadPolls();
      });
    };
    function loadPetitions(){
      getJson('/api/admin/petitions').then(function(r){
        E('t-rows').innerHTML = (r.data.petitions||[]).map(function(p){
          return '<tr><td>' + p.title_en + '</td><td>' + p.signatures + '/' + p.signature_target + '</td><td><button class="btn btn-ghost btn-sm t-toggle" data-id="' + p.id + '" data-status="' + p.status + '">' + (p.status === 'open' ? 'Close' : 'Reopen') + '</button></td></tr>';
        }).join('');
        Array.prototype.forEach.call(document.querySelectorAll('.t-toggle'), function(b){
          b.onclick = function(){ patchJson('/api/admin/petitions/' + b.dataset.id, { status: b.dataset.status === 'open' ? 'closed' : 'open' }).then(loadPetitions); };
        });
      });
    }
    E('t-add').onclick = function(){
      postJson('/api/admin/petitions', { title_en: E('t-ten').value, title_ha: E('t-tha').value, body_en: E('t-ben').value, body_ha: E('t-bha').value, signature_target: Number(E('t-target').value) }).then(function(r){
        if (!r.ok) alert((r.data && (r.data.error || JSON.stringify(r.data.fields))) || 'Failed'); else { E('t-ten').value = E('t-tha').value = E('t-ben').value = E('t-bha').value = ''; }
        loadPetitions();
      });
    };
    function loadProjects(){
      getJson('/api/admin/projects').then(function(r){
        E('j-rows').innerHTML = (r.data.projects||[]).map(function(p){
          return '<tr><td>' + p.name + '</td><td>' + p.status + '</td><td>' + p.progress + '%</td>' +
            '<td><button class="btn btn-ghost btn-sm j-upd" data-id="' + p.id + '" data-name="' + p.name.replace(/"/g,'') + '">Update</button> ' +
            '<button class="btn btn-ghost btn-sm j-done" data-id="' + p.id + '">Complete</button></td></tr>';
        }).join('');
        Array.prototype.forEach.call(document.querySelectorAll('.j-upd'), function(b){
          b.onclick = function(){ E('proj-update-box').style.display = 'block'; E('pu-id').value = b.dataset.id; E('pu-name').textContent = b.dataset.name; E('pu-note').value=''; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); };
        });
        Array.prototype.forEach.call(document.querySelectorAll('.j-done'), function(b){
          b.onclick = function(){ patchJson('/api/admin/projects/' + b.dataset.id, { status: 'completed', progress: 100 }).then(loadProjects); };
        });
      });
    }
    E('j-add').onclick = function(){
      postJson('/api/admin/projects', { name: E('j-name').value, description: E('j-desc').value, ward: E('j-ward').value, status: E('j-status').value, progress: Number(E('j-progress').value) }).then(function(r){
        if (!r.ok) alert((r.data && (r.data.error || JSON.stringify(r.data.fields))) || 'Failed'); else { E('j-name').value = E('j-desc').value = E('j-ward').value = ''; }
        loadProjects();
      });
    };
    E('pu-add').onclick = function(){
      postJson('/api/admin/projects/' + E('pu-id').value + '/updates', { note: E('pu-note').value }).then(function(r){
        if (!r.ok) alert((r.data && r.data.error) || 'Failed');
        E('proj-update-box').style.display = 'none'; loadProjects();
      });
    };
    E('pu-cancel').onclick = function(){ E('proj-update-box').style.display = 'none'; };
    function loadFeedback(){
      getJson('/api/admin/feedback').then(function(r){
        E('f-rows').innerHTML = (r.data.feedback||[]).map(function(f){
          return '<tr><td>' + f.name + '</td><td>' + f.message.slice(0,80) + '</td><td>' + f.status + '</td>' +
            '<td>' + (f.status !== 'published' ? '<button class="btn btn-ghost btn-sm f-set" data-id="' + f.id + '" data-status="published">Publish</button> ' : '') +
            (f.status !== 'hidden' ? '<button class="btn btn-ghost btn-sm f-set" data-id="' + f.id + '" data-status="hidden">Hide</button>' : '') + '</td></tr>';
        }).join('');
        Array.prototype.forEach.call(document.querySelectorAll('.f-set'), function(b){
          b.onclick = function(){ patchJson('/api/admin/feedback/' + b.dataset.id, { status: b.dataset.status }).then(loadFeedback); };
        });
      });
    }
    loadPolls(); loadPetitions(); loadProjects(); loadFeedback();
  })();
  <\/script>`;
  const html = adminHtml(user, 'civic', 'Civic & Development', content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function adminUsersPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const user = await userFromRequest(req);
  if (!user || user.role !== 'super_admin') { res.writeHead(302, { location: '/admin/login' }); res.end(); return; }
  const content = `
  <div class="dash-grid" style="grid-template-columns: 1.4fr 1fr">
    <div class="card">
      <h3>Users</h3>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Scope</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
    </div>
    <div class="card">
      <h3>Add a user</h3>
      <div class="stack" style="max-width:none">
        <div class="field"><label>Name</label><input id="u-name" type="text"/></div>
        <div class="field"><label>Email</label><input id="u-email" type="email"/></div>
        <div class="field"><label>Password (min 8 chars)</label><input id="u-pass" type="text"/></div>
        <div class="field"><label>Role</label><select id="u-role">
          <option value="reviewer">Community Reviewer</option>
          <option value="analyst">Data Analyst</option>
          <option value="lga_admin">Local Government Administrator</option>
          <option value="super_admin">Super Administrator</option>
          <option value="citizen">Citizen</option>
          <option value="community_rep">Community Representative</option>
          <option value="government">Government / Institution</option>
        </select></div>
        <button class="btn btn-primary btn-sm" id="u-add">Create user</button>
        <div id="u-msg"></div>
      </div>
    </div>
  </div>
  <script>
  (function(){
    function load(){
      getJson('/api/admin/users').then(function(r){
        document.getElementById('rows').innerHTML = (r.data.users || []).map(function(u){
          return '<tr><td><b>' + u.name + '</b></td><td>' + u.email + '</td><td>' + u.role + '</td><td>' + (u.lga || '—') + '</td>' +
            '<td>' + (u.active ? '<span class="badge st-resolved">active</span>' : '<span class="badge st-rejected">pending/disabled</span>') + '</td>' +
            '<td>' + (u.id !== ${user.id} ? '<button data-id="' + u.id + '" data-active="' + u.active + '" class="btn btn-ghost btn-sm u-toggle">' + (u.active ? 'Disable' : 'Activate') + '</button> ' +
              '<button data-id="' + u.id + '" class="btn btn-ghost btn-sm u-reset">Reset password</button>' : '<span class="muted small">you</span>') + '</td></tr>';
        }).join('');
        Array.prototype.forEach.call(document.querySelectorAll('.u-toggle'), function(b){
          b.onclick = function(){
            patchJson('/api/admin/users/' + b.dataset.id, { active: b.dataset.active !== 'true' }).then(load);
          };
        });
        Array.prototype.forEach.call(document.querySelectorAll('.u-reset'), function(b){
          b.onclick = function(){
            if (!confirm('Generate a new temporary password for this user?')) return;
            patchJson('/api/admin/users/' + b.dataset.id, { reset_password: true }).then(function(r){
              if (r.ok && r.data.temporary_password) {
                document.getElementById('u-msg').innerHTML = '<div class="notice notice-warn"><b>Temporary password (shown once):</b> <code>' + r.data.temporary_password + '</code><br>Give it to the user; they change it after signing in.</div>';
              } else {
                document.getElementById('u-msg').innerHTML = '<div class="notice notice-err">Reset failed.</div>';
              }
            });
          };
        });
      });
    }
    document.getElementById('u-add').onclick = function(){
      postJson('/api/admin/users', {
        name: document.getElementById('u-name').value, email: document.getElementById('u-email').value,
        password: document.getElementById('u-pass').value, role: document.getElementById('u-role').value
      }).then(function(r){
        document.getElementById('u-msg').innerHTML = r.ok ? '<div class="notice notice-ok">\\u2713 User created.</div>' : '<div class="notice notice-err">' + (r.data.error || JSON.stringify(r.data.fields)) + '</div>';
        if (r.ok) load();
      });
    };
    load();
  })();
  <\/script>`;
  const html = adminHtml(user, 'users', 'User Management', content);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function apiGetIntelligence(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const user = await requireAdmin(req, res, 'view');
  if (!user) return;
  const ir = await one<Record<string, unknown>>('SELECT * FROM intelligence_reports WHERE id = $1', [Number(params.id)]);
  if (!ir) { json(res, 404, { error: 'Not found' }); return; }
  json(res, 200, ir);
}

async function apiGeoStates(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const states = await many<{ state: string }>('SELECT DISTINCT state FROM lgas ORDER BY state', []);
  json(res, 200, { states: states.map((r) => r.state) });
}

async function apiGeoLgas(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const state = sanitizeText(url.searchParams.get('state') ?? '', 40);
  if (!state) { json(res, 200, { lgas: [] }); return; }
  const rows = await many<{ name: string }>('SELECT name FROM lgas WHERE state = $1 ORDER BY name', [state]);
  json(res, 200, { lgas: rows.map((r) => r.name) });
}

async function apiGeoWards(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const state = sanitizeText(url.searchParams.get('state') ?? '', 40);
  const lga = sanitizeText(url.searchParams.get('lga') ?? '', 60);
  if (!state || !lga) { json(res, 200, { wards: [] }); return; }
  const rows = await many<{ name: string }>('SELECT name FROM wards WHERE state = $1 AND lga = $2 ORDER BY name', [state, lga]);
  json(res, 200, { wards: rows.map((r) => r.name) });
}

// ---------- route table ----------
const routes: Route[] = [
  { method: 'GET', path: '/health', handler: (_q, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); } },
  { method: 'GET', path: '/', handler: homePage },
  { method: 'GET', path: '/about', handler: aboutPage },
  { method: 'GET', path: '/register', handler: registerPage },
  { method: 'GET', path: '/login', handler: publicLoginPage },
  { method: 'GET', path: '/account', handler: (q, res) => {
      userFromRequest(q).then((u) => {
        if (!u) { res.writeHead(302, { location: '/login' }); res.end(); return; }
        accountPage(q, res, u);
      });
    } },
  { method: 'POST', path: '/api/register', handler: apiRegister },
  { method: 'POST', path: '/api/account/password', handler: apiAccountPassword },
  { method: 'GET', path: '/api/account/reports', handler: apiAccountReports },
  { method: 'GET', path: '/civic', handler: civicPageHandler },
  { method: 'GET', path: '/development', handler: developmentPageHandler },
  { method: 'POST', path: '/api/polls/:id/vote', handler: apiPollVote },
  { method: 'POST', path: '/api/petitions/:id/sign', handler: apiPetitionSign },
  { method: 'POST', path: '/api/feedback', handler: apiFeedbackSubmit },
  { method: 'GET', path: '/api/admin/polls', handler: apiAdminPolls },
  { method: 'POST', path: '/api/admin/polls', handler: apiAdminPolls },
  { method: 'PATCH', path: '/api/admin/polls/:id', handler: apiAdminPolls },
  { method: 'GET', path: '/api/admin/petitions', handler: apiAdminPetitions },
  { method: 'POST', path: '/api/admin/petitions', handler: apiAdminPetitions },
  { method: 'PATCH', path: '/api/admin/petitions/:id', handler: apiAdminPetitions },
  { method: 'GET', path: '/api/admin/feedback', handler: apiAdminFeedback },
  { method: 'PATCH', path: '/api/admin/feedback/:id', handler: apiAdminFeedback },
  { method: 'GET', path: '/api/admin/projects', handler: apiAdminProjects },
  { method: 'POST', path: '/api/admin/projects', handler: apiAdminProjects },
  { method: 'PATCH', path: '/api/admin/projects/:id', handler: apiAdminProjects },
  { method: 'POST', path: '/api/admin/projects/:id/updates', handler: apiAdminProjects },
  { method: 'GET', path: '/admin/civic', handler: adminCivicPage },
  { method: 'GET', path: '/hub', handler: hubPageHandler },
  { method: 'POST', path: '/api/hub/submit', handler: apiHubSubmit },
  { method: 'GET', path: '/api/admin/hub', handler: apiAdminHub },
  { method: 'POST', path: '/api/admin/hub', handler: apiAdminHub },
  { method: 'PATCH', path: '/api/admin/hub/innovations/:id', handler: apiAdminHub },
  { method: 'PATCH', path: '/api/admin/hub/opportunities/:id', handler: apiAdminHub },
  { method: 'GET', path: '/admin/hub', handler: adminHubPage },
  { method: 'GET', path: '/report', handler: reportPage },
  { method: 'GET', path: '/track', handler: trackPage },
  { method: 'GET', path: '/map', handler: mapPage },
  { method: 'GET', path: '/lang/:code', handler: setLang },
  { method: 'GET', path: '/forgot', handler: forgotPage },
  { method: 'GET', path: '/reset', handler: (q, r) => {
      const token = new URL(q.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
      resetPage(q, r, token, token ? 'form' : 'invalid');
    } },
  { method: 'POST', path: '/api/forgot', handler: apiForgot },
  { method: 'POST', path: '/api/reset', handler: apiReset },
  { method: 'POST', path: '/api/reports', handler: apiSubmitReport },
  { method: 'GET', path: '/api/track/:ref', handler: apiTrack },
  { method: 'GET', path: '/api/map/reports', handler: apiMapReports },
  { method: 'GET', path: '/api/geo/states', handler: apiGeoStates },
  { method: 'GET', path: '/api/geo/lgas', handler: apiGeoLgas },
  { method: 'GET', path: '/api/geo/wards', handler: apiGeoWards },
  { method: 'GET', path: '/api/image/:id', handler: serveImage },
  { method: 'GET', path: '/assets/:file', handler: (_q, res, p) => {
      const f = p.file;
      if (f === 'app.css') serveAsset(res, 'app.css', 'text/css; charset=utf-8');
      else if (f === 'app.js') serveAsset(res, 'app.js', 'text/javascript; charset=utf-8');
      else if (f === 'icon.svg') serveAsset(res, 'icon.svg', 'image/svg+xml');
      else if (f === 'icon-192.png') serveAsset(res, 'icon-192.png', 'image/png');
      else if (f === 'icon-512.png') serveAsset(res, 'icon-512.png', 'image/png');
      else { res.writeHead(404); res.end('Not found'); }
    } },
  { method: 'GET', path: '/robots.txt', handler: (_q, res) => {
      serveAsset(res, 'robots.txt', 'text/plain; charset=utf-8');
    } },
  { method: 'GET', path: '/sitemap.xml', handler: (_q, res) => {
      serveAsset(res, 'sitemap.xml', 'application/xml; charset=utf-8');
    } },
  { method: 'GET', path: '/sw.js', handler: (_q, res) => {
      serveAsset(res, 'sw.js', 'text/javascript; charset=utf-8', 'no-store');
    } },
  { method: 'GET', path: '/manifest.json', handler: (_q, res) => {
      serveAsset(res, 'manifest.json', 'application/manifest+json');
    } },

  { method: 'GET', path: '/admin/login', handler: adminLoginPage },
  { method: 'POST', path: '/api/admin/login', handler: apiLogin },
  { method: 'POST', path: '/api/admin/logout', handler: apiLogout },
  { method: 'GET', path: '/admin', handler: adminDashboardPage },
  { method: 'GET', path: '/admin/reports', handler: adminReportsPage },
  { method: 'GET', path: '/admin/reports/:id', handler: adminReportDetailPage },
  { method: 'GET', path: '/admin/reports-by-ref/:ref', handler: adminReportByRef },
  { method: 'GET', path: '/admin/intelligence', handler: adminIntelligencePage },
  { method: 'GET', path: '/admin/audit', handler: adminAuditPage },
  { method: 'GET', path: '/admin/users', handler: adminUsersPage },

  { method: 'GET', path: '/api/admin/stats', handler: apiStats },
  { method: 'GET', path: '/api/admin/reports', handler: apiAdminReports },
  { method: 'GET', path: '/api/admin/reports/:id', handler: apiAdminReportDetail },
  { method: 'PATCH', path: '/api/admin/reports/:id', handler: apiAdminUpdateReport },
  { method: 'POST', path: '/api/admin/reports/:id/comment', handler: apiAdminComment },
  { method: 'POST', path: '/api/admin/reports/:id/reanalyze', handler: apiAdminReanalyze },
  { method: 'POST', path: '/api/admin/intelligence/generate', handler: apiGenerateIntelligence },
  { method: 'GET', path: '/api/admin/intelligence/:id', handler: apiGetIntelligence },
  { method: 'GET', path: '/api/admin/export.csv', handler: apiExportCsv },
  { method: 'GET', path: '/api/admin/export/pdf', handler: apiExportPdf },
  { method: 'GET', path: '/api/admin/users', handler: apiAdminUsers },
  { method: 'POST', path: '/api/admin/users', handler: apiAdminUsers },
  { method: 'PATCH', path: '/api/admin/users/:id', handler: apiAdminUsers },
  { method: 'GET', path: '/api/admin/audit', handler: apiAudit },
];

const server = http.createServer(async (req, res) => {
  try {
    // Security headers on every response (set before any route writes head)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://unpkg.com",
      "connect-src 'self' https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathName = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : req.method ?? 'GET';

    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.path.includes(':')) {
        const segs = route.path.split('/');
        const parts = pathName.split('/');
        if (segs.length !== parts.length) continue;
        const params: Record<string, string> = {};
        let match = true;
        for (let i = 0; i < segs.length; i++) {
          if (segs[i].startsWith(':')) params[segs[i].slice(1)] = decodeURIComponent(parts[i]);
          else if (segs[i] !== parts[i]) { match = false; break; }
        }
        if (match) { await route.handler(req, res, params); return; }
      } else if (route.path === pathName) {
        await route.handler(req, res, {});
        return;
      }
    }

    if (method === 'GET' && !pathName.startsWith('/api/') && !pathName.startsWith('/assets/') && !pathName.startsWith('/admin')) {
      const lang = langFromCookie(req);
      const tr = tf(lang);
      const notFound = pageShell({ lang, title: '404 — AFRIPULSE AI', active: '', content: `
        <section class="band"><div class="wrap" style="text-align:center;max-width:560px">
          <div style="font-size:64px">&#127760;</div>
          <h1>404</h1>
          <p class="muted">${escapeHtml(tr('err.404'))}</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
            <a class="btn btn-primary" href="/">${escapeHtml(t(lang, 'nav.home'))}</a>
            <a class="btn btn-ghost" href="/report">${escapeHtml(t(lang, 'form.submit'))}</a>
          </div>
        </div></section>` });
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(notFound);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (error) {
    console.error('[webserver] request failed:', error);
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal error' });
    } else {
      try { res.end(); } catch { /* already closed */ }
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[webserver] AFRIPULSE AI listening on :${PORT}`);
});
