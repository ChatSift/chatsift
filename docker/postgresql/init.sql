CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id bigint PRIMARY KEY,
  use_url_filters int NOT NULL DEFAULT 0,
  use_file_filters int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  user_id bigint PRIMARY KEY,
  perms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS apps (
  app_id serial PRIMARY KEY,
  name varchar(32) NOT NULL,
  perms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sigs (
  app_id int NOT NULL REFERENCES apps ON DELETE CASCADE,
  sig text NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS malicious_files (
  file_id serial PRIMARY KEY,
  file_hash text UNIQUE NOT NULL,
  admin_id bigint NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_modified_at timestamptz NOT NULL DEFAULT NOW(),
  category int NOT NULL
);

CREATE TABLE IF NOT EXISTS malicious_urls (
  url_id serial PRIMARY KEY,
  url text UNIQUE NOT NULL,
  guild_id bigint,
  admin_id bigint REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_modified_at timestamptz NOT NULL DEFAULT NOW(),
  category int
);
