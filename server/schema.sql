
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  repo_id     TEXT        NOT NULL,
  file_path   TEXT        NOT NULL,
  start_line  INTEGER     NOT NULL,
  end_line    INTEGER     NOT NULL,
  content     TEXT        NOT NULL,
  embedding   vector(384) NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_repo_idx ON chunks (repo_id);
CREATE INDEX IF NOT EXISTS chunks_repo_file_idx ON chunks (repo_id, file_path);