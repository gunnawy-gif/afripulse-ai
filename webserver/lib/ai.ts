// AFRIPULSE AI Intelligence Engine.
// Real AI integration: OpenAI chat models (classification/summarisation) and
// text embeddings (duplicate detection, recurring-theme analysis) through the
// platform egress gateway. Every output produced here is clearly labelled an
// AI SUGGESTION in the UI and can be overridden by human administrators.

import { CATEGORIES } from './validate.ts';

const CHAT_MODEL = 'gpt-4o-mini';
const EMBED_MODEL = 'text-embedding-3-small';

type ChatMessage = { role: 'system' | 'user'; content: string };

async function chat(messages: ChatMessage[], maxTokens = 800, jsonMode = false): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sentinel' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '';
}

export async function embedUnavailableNote(): Promise<void> { /* embeddings endpoint is not authorized on the gateway */ }

export type CandidateReport = { ref_no: string; title: string; summary: string | null };

export type SimilarMatch = { ref_no: string; title: string; similarity: number; reason: string };

/** Duplicate/similarity detection done with a real AI comparison call
 *  (the gateway does not authorize the embeddings endpoint). */
export async function findSimilarReports(title: string, description: string, candidates: CandidateReport[]): Promise<SimilarMatch[]> {
  if (!candidates.length) return [];
  const list = candidates.map((c) => `- ${c.ref_no}: ${c.title}${c.summary ? ` | summary: ${c.summary.slice(0, 200)}` : ''}`).join('\n');
  const raw = await chat(
    [
      { role: 'system', content: 'You compare a NEW citizen report against EXISTING reports and flag possible duplicates or near-duplicates of the same underlying problem. Two reports are a match only if they plausibly describe the SAME problem or the same facility/location issue, not merely the same category. Respond ONLY with JSON: {"matches":[{"ref_no":"...","similarity":0.0-1.0,"reason":"one sentence"}]}. Return an empty matches array if nothing is meaningfully similar. Maximum 3 matches.' },
      { role: 'user', content: `NEW REPORT:\nTITLE: ${title}\nBODY: ${description.slice(0, 1500)}\n\nEXISTING REPORTS:\n${list}` },
    ],
    400,
    true
  );
  const parsed = JSON.parse(raw) as { matches: SimilarMatch[] };
  const known = new Set(candidates.map((c) => c.ref_no));
  return (parsed.matches ?? [])
    .filter((m) => known.has(m.ref_no) && m.similarity >= 0.7)
    .slice(0, 3);
}

export type ReportAnalysis = {
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  urgency_reason: string;
  summary: string;
  recommended_actions: string[];
  language_detected: 'en' | 'ha' | 'mixed';
  confidence: number;
};

const ANALYSIS_SYSTEM = `You are the analysis engine of AFRIPULSE AI, a civic-intelligence platform piloted in Rafi Local Government Area, Niger State, Nigeria.
You analyse citizen reports about community problems. Reports may be written in English, Hausa, or a mix of both (code-switching is common in Niger State).
Classify each report into exactly ONE of these categories: ${CATEGORIES.join(', ')}.
Rate urgency (priority) considering risk to life, number of people affected, and how essential the service is:
- critical: immediate danger to life, disease outbreak, violent security incident, collapsed structure
- high: essential services broken (no water source, clinic nonfunctional, school closed), affecting many people
- medium: significant inconvenience or economic harm, deteriorating infrastructure
- low: minor issues, cosmetic damage, single-household inconvenience
Respond ONLY with JSON of shape:
{"category": one of the list, "priority": "critical"|"high"|"medium"|"low", "urgency_reason": "one sentence in English explaining the rating", "summary": "2-3 sentence neutral summary of the report in English", "recommended_actions": ["2-4 short actionable steps for local authorities"], "language_detected": "en"|"ha"|"mixed", "confidence": number 0-1}`;

export async function analyzeReport(title: string, description: string): Promise<ReportAnalysis> {
  const raw = await chat(
    [
      { role: 'system', content: ANALYSIS_SYSTEM },
      { role: 'user', content: `REPORT TITLE: ${title}\n\nREPORT BODY:\n${description}` },
    ],
    700,
    true
  );
  const parsed = JSON.parse(raw) as ReportAnalysis;
  if (!CATEGORIES.includes(parsed.category as (typeof CATEGORIES)[number])) parsed.category = 'other';
  if (!['critical', 'high', 'medium', 'low'].includes(parsed.priority)) parsed.priority = 'medium';
  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
  return parsed;
}

export type IntelligenceStats = {
  period: string;
  totalReports: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  byWard: { ward: string; count: number; critical: number }[];
  topIssues: { title: string; ward: string | null; category: string; priority: string; refNo: string }[];
  resolvedThisPeriod: number;
  civic?: {
    activePolls: number;
    totalVotes: number;
    openPetitions: { title: string; signatures: number; target: number }[];
    feedbackPending: number;
    topPollQuestion: string | null;
  };
};

const INTELLIGENCE_SYSTEM = `You are the intelligence analyst for AFRIPULSE AI, a community reporting platform piloted in Rafi LGA, Niger State, Nigeria.
Given aggregate statistics about citizen reports for a period, write a professional governance briefing in Markdown.
Rules:
- Base every statement strictly on the numbers provided; never invent facts, figures, or places.
- Use the ward and category names exactly as given.
- Structure: "## Situation Overview", "## Priority Concerns", "## Progress & Resolutions", "## Recommended Focus Areas".
- Keep it under 450 words. Neutral, factual tone suitable for local government officials.
- Note where data is too thin to draw conclusions rather than speculating.`;

export async function generateIntelligenceBrief(stats: IntelligenceStats): Promise<string> {
  return chat(
    [
      { role: 'system', content: INTELLIGENCE_SYSTEM },
      { role: 'user', content: JSON.stringify(stats, null, 2) },
    ],
    1200,
    false
  );
}

export type ThematicResult = { title: string; brief: string };

export async function generateThematicBrief(theme: string, reportExtracts: string[], period: string): Promise<ThematicResult> {
  return chat(
    [
      { role: 'system', content: INTELLIGENCE_SYSTEM },
      {
        role: 'user',
        content: `Theme: ${theme}\nPeriod: ${period}\nRelevant report extracts (titles and AI summaries):\n${reportExtracts.join('\n---\n')}\n\nWrite a Markdown briefing (max 350 words) with sections "## Situation Overview" and "## Recommendations". Use only the extracts given.`,
      },
    ],
    900,
    false
  ).then((text) => ({ title: `${theme} — ${period}`, brief: text }));
}

// Simple in-process rate limiter for AI-heavy endpoints (per IP).
const rateBuckets = new Map<string, { count: number; reset: number }>();
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset < now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}
