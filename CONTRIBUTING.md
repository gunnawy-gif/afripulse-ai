# Contributing to AFRIPULSE AI

Thanks for your interest in improving AFRIPULSE AI!

## Ground rules

- **Never fabricate data.** Every statistic, ward name, or partnership claim
  must come from a verified source. Demo data stays clearly marked as demo.
- **AI output is a suggestion.** Any AI-generated assessment shown to users
  must be labelled as pending human review.
- **Bilingual by default.** New user-facing strings need both English and
  Hausa (see `lib/i18n.ts`).

## Getting started

```bash
git clone https://github.com/gunnawy-gif/afripulse-ai.git
cd afripulse-ai
npm install
cp .env.example .env   # fill in your DATABASE_URL
npm start
```

Node 24 or later is required.

## Submitting changes

1. Create a branch for your change.
2. Keep changes focused; one logical change per pull request.
3. Test your change locally before pushing.
4. Open a pull request with a short description of what changed and why.
