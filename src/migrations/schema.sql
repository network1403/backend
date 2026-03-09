-- ============================================================
-- QuizZer Database Schema
-- Run: psql -U postgres -d quizzer_db -f schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For full-text search

-- ─── ENUMS ──────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('user', 'creator', 'admin', 'superadmin');
CREATE TYPE question_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE difficulty_label AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE notification_type AS ENUM (
  'new_follower', 'question_answered', 'question_retweeted',
  'comment_on_question', 'comment_reply', 'question_liked', 'milestone'
);

-- ─── USERS ──────────────────────────────────────────────────
CREATE TABLE users (
  user_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username        VARCHAR(50) UNIQUE NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  bio             TEXT,
  avatar_url      VARCHAR(500),
  cover_url       VARCHAR(500),
  is_verified     BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  role            user_role DEFAULT 'user',
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  total_correct   INTEGER DEFAULT 0,
  total_answers   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ,
  CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,50}$')
);

-- ─── REFRESH TOKENS ─────────────────────────────────────────
CREATE TABLE refresh_tokens (
  token_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token       VARCHAR(500) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CATEGORIES ─────────────────────────────────────────────
CREATE TABLE categories (
  category_id    SERIAL PRIMARY KEY,
  parent_id      INTEGER REFERENCES categories(category_id),
  name_ar        VARCHAR(100) NOT NULL,
  name_en        VARCHAR(100) NOT NULL,
  icon_emoji     VARCHAR(10),
  slug           VARCHAR(100) UNIQUE NOT NULL,
  question_count INTEGER DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  display_order  SMALLINT DEFAULT 0
);

-- ─── QUESTIONS ──────────────────────────────────────────────
CREATE TABLE questions (
  question_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id       INTEGER REFERENCES categories(category_id),
  content           TEXT NOT NULL,
  difficulty        SMALLINT DEFAULT 5 CHECK (difficulty BETWEEN 1 AND 10),
  difficulty_label  difficulty_label DEFAULT 'medium',
  ai_generated      BOOLEAN DEFAULT false,
  ai_model_version  VARCHAR(20),
  status            question_status DEFAULT 'published',
  answer_count      INTEGER DEFAULT 0,
  correct_count     INTEGER DEFAULT 0,
  wrong_count       INTEGER DEFAULT 0,
  retweet_count     INTEGER DEFAULT 0,
  like_count        INTEGER DEFAULT 0,
  bookmark_count    INTEGER DEFAULT 0,
  view_count        INTEGER DEFAULT 0,
  is_pinned         BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── QUESTION OPTIONS ───────────────────────────────────────
CREATE TABLE question_options (
  option_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id     UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  option_label    CHAR(1) NOT NULL,
  option_text     TEXT NOT NULL,
  is_correct      BOOLEAN NOT NULL DEFAULT false,
  display_order   SMALLINT NOT NULL,
  selection_count INTEGER DEFAULT 0,
  CONSTRAINT valid_label CHECK (option_label IN ('أ', 'ب', 'ج', 'د'))
);

-- ─── QUESTION EXPLANATIONS ──────────────────────────────────
CREATE TABLE question_explanations (
  explanation_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id      UUID NOT NULL UNIQUE REFERENCES questions(question_id) ON DELETE CASCADE,
  correct_option_id UUID REFERENCES question_options(option_id),
  explanation_text TEXT NOT NULL CHECK (LENGTH(explanation_text) >= 20),
  explanation_source VARCHAR(500),
  media_url        VARCHAR(500),
  is_ai_generated  BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USER ANSWERS ───────────────────────────────────────────
CREATE TABLE user_answers (
  answer_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id        UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  selected_option_id UUID NOT NULL REFERENCES question_options(option_id),
  is_correct         BOOLEAN NOT NULL,
  answered_at        TIMESTAMPTZ DEFAULT NOW(),
  time_taken_ms      INTEGER,
  CONSTRAINT unique_user_answer UNIQUE (user_id, question_id)
);

-- ─── FOLLOWS ────────────────────────────────────────────────
CREATE TABLE follows (
  follow_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_follow UNIQUE (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

-- ─── RETWEETS ───────────────────────────────────────────────
CREATE TABLE retweets (
  retweet_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_retweet UNIQUE (user_id, question_id)
);

-- ─── LIKES ──────────────────────────────────────────────────
CREATE TABLE likes (
  like_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_like UNIQUE (user_id, question_id)
);

-- ─── BOOKMARKS ──────────────────────────────────────────────
CREATE TABLE bookmarks (
  bookmark_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_bookmark UNIQUE (user_id, question_id)
);

-- ─── COMMENTS ───────────────────────────────────────────────
CREATE TABLE comments (
  comment_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES comments(comment_id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (LENGTH(content) BETWEEN 1 AND 500),
  like_count  INTEGER DEFAULT 0,
  is_deleted  BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NOTIFICATIONS ──────────────────────────────────────────
CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES users(user_id) ON DELETE SET NULL,
  type            notification_type NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       UUID,
  message         TEXT NOT NULL,
  is_read         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── REPORTS ────────────────────────────────────────────────
CREATE TABLE reports (
  report_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('question', 'comment', 'user')),
  entity_id   UUID NOT NULL,
  reason      VARCHAR(100) NOT NULL,
  description TEXT,
  status      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX idx_questions_user_id       ON questions(user_id);
CREATE INDEX idx_questions_category_id   ON questions(category_id);
CREATE INDEX idx_questions_created_at    ON questions(created_at DESC);
CREATE INDEX idx_questions_status        ON questions(status);
CREATE INDEX idx_questions_trending      ON questions(answer_count DESC, created_at DESC);
CREATE INDEX idx_answers_user_id         ON user_answers(user_id);
CREATE INDEX idx_answers_question_id     ON user_answers(question_id);
CREATE INDEX idx_follows_follower        ON follows(follower_id);
CREATE INDEX idx_follows_following       ON follows(following_id);
CREATE INDEX idx_notif_recipient         ON notifications(recipient_id, created_at DESC);
CREATE INDEX idx_notif_unread            ON notifications(recipient_id, is_read) WHERE is_read = false;
CREATE INDEX idx_comments_question       ON comments(question_id, created_at);
CREATE INDEX idx_options_question        ON question_options(question_id, display_order);

-- Full-text search index
CREATE INDEX idx_questions_content_fts ON questions USING gin(to_tsvector('arabic', content));
CREATE INDEX idx_users_username_trgm   ON users USING gin(username gin_trgm_ops);

-- ─── UPDATED_AT TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_comments_updated BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── SEED CATEGORIES ────────────────────────────────────────
INSERT INTO categories (name_ar, name_en, icon_emoji, slug, display_order) VALUES
  ('علم الفلك', 'Astronomy', '🔭', 'astronomy', 1),
  ('العلوم', 'Science', '🔬', 'science', 2),
  ('التاريخ', 'History', '📜', 'history', 3),
  ('الجغرافيا', 'Geography', '🌍', 'geography', 4),
  ('الرياضيات', 'Mathematics', '📐', 'mathematics', 5),
  ('اللغة العربية', 'Arabic Language', '📖', 'arabic', 6),
  ('اللغة الإنجليزية', 'English', '🗣️', 'english', 7),
  ('الدين الإسلامي', 'Islamic Studies', '☪️', 'islamic-studies', 8),
  ('التقنية والبرمجة', 'Technology', '💻', 'technology', 9),
  ('الثقافة العامة', 'General Knowledge', '🧠', 'general', 10),
  ('الرياضة', 'Sports', '⚽', 'sports', 11),
  ('الفنون', 'Arts', '🎨', 'arts', 12);
