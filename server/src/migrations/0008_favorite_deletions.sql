-- Merge sync pushes back any favourite a client holds that the server does not, so an
-- unfave made on one device came straight back from the next device to sync. Record the
-- removals and let the newer timestamp win.
CREATE TABLE IF NOT EXISTS favorite_deletions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  deleted_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS favorite_deletions_user_time_idx ON favorite_deletions(user_id, deleted_at DESC);
