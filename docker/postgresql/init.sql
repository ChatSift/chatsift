CREATE TABLE guild_settings (
  guild_id bigint PRIMARY KEY,
  use_global_url_filters boolean NOT NULL DEFAULT false
);

CREATE TABLE users (
  user_id bigint PRIMARY KEY,
  perms bigint NOT NULL DEFAULT 0
);

CREATE TABLE apps (
  app_id serial PRIMARY KEY,
  name varchar(32) NOT NULL,
  perms bigint NOT NULL DEFAULT 0
);

CREATE TABLE sigs (
  app_id int NOT NULL REFERENCES apps ON DELETE CASCADE,
  sig text NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE malicious_files (
  file_id serial PRIMARY KEY,
  file_hash text UNIQUE NOT NULL,
  admin_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_modified_at timestamptz NOT NULL DEFAULT NOW(),
  category int NOT NULL,
);

CREATE TABLE malicious_urls (
  url_id serial PRIMARY KEY,
  url text UNIQUE NOT NULL,
  guild_id bigint,
  admin_id bigint REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_modified_at timestamptz NOT NULL DEFAULT NOW(),
  category int
);
