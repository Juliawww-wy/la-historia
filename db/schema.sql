-- Run once against DATABASE_URL: npx tsx db/migrate.ts

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vocab_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  part_of_speech TEXT,
  cefr_level TEXT,
  context_meaning_zh TEXT,
  context_explanation TEXT,
  general_meaning_zh TEXT,
  general_meaning_en TEXT,
  related_expressions JSONB,
  original_sentence TEXT,
  original_sentence_translation TEXT,
  times_seen INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, word)
);

-- Added after the initial table existed on some environments — safe to
-- re-run, no-ops once the columns are there.
ALTER TABLE vocab_entries ADD COLUMN IF NOT EXISTS cefr_level TEXT;
ALTER TABLE vocab_entries ADD COLUMN IF NOT EXISTS related_expressions JSONB;

CREATE INDEX IF NOT EXISTS vocab_entries_user_last_seen_idx
  ON vocab_entries (user_id, last_seen_at DESC);
