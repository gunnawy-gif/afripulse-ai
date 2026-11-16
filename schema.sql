-- AFRIPULSE AI database schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS wards (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (state, lga, name)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','lga_admin','reviewer','analyst')),
  lga TEXT,            -- scope for lga_admin
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  ref_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN
    ('infrastructure','water_sanitation','education','healthcare','agriculture','security','environment','unemployment','electricity','other')),
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  ward TEXT,
  community TEXT,
  specific_location TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  coords_source TEXT CHECK (coords_source IN ('citizen_gps','admin_verified')),
  image_id INTEGER REFERENCES attachments(id),
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN
    ('submitted','under_review','verified','assigned','in_progress','resolved','rejected')),
  priority TEXT CHECK (priority IN ('critical','high','medium','low')),
  assigned_department TEXT,
  rejection_reason TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  -- AI assessment (suggestions only, overridable by admins)
  ai_category TEXT,
  ai_priority TEXT,
  ai_summary TEXT,
  ai_actions JSONB,
  ai_language_detected TEXT,
  ai_confidence DOUBLE PRECISION,
  ai_assessed_at TIMESTAMPTZ,
  ai_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  ai_similar JSONB,
  duplicate_of INTEGER REFERENCES reports(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS status_history (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_comments (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intelligence_reports (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,             -- weekly | monthly | thematic
  theme TEXT,
  title TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  content_md TEXT NOT NULL,
  generated_by TEXT NOT NULL,     -- user name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports (category);
CREATE INDEX IF NOT EXISTS idx_reports_ward ON reports (ward);
