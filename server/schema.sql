-- CiteCode database schema.
-- Run once in your Postgres SQL editor (for example Neon) before starting the server.
-- Safe to run again: every statement uses IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  repo_id     TEXT        NOT NULL,   -- e.g. "gothinkster-angular-realworld-example-app"
  file_path   TEXT        NOT NULL,   -- path inside the repo
  start_line  INTEGER     NOT NULL,   -- 1-based, used for citations
  end_line    INTEGER     NOT NULL,
  content     TEXT        NOT NULL,   -- the chunk text (30-line window)
  embedding   vector(384) NOT NULL    -- all-MiniLM-L6-v2 produces 384 numbers
);

-- Every query filters by repo_id first (search, list files, read lines, delete on re-index).
CREATE INDEX IF NOT EXISTS chunks_repo_idx ON chunks (repo_id);
CREATE INDEX IF NOT EXISTS chunks_repo_file_idx ON chunks (repo_id, file_path);