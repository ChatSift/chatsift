CREATE FUNCTION next_case(bigint) RETURNS int
LANGUAGE plpgsql
stable
AS $$
DECLARE next_id int;
BEGIN
  SELECT max(case_id) INTO next_id FROM cases WHERE guild_id = $1;
  if next_id is null THEN return 1; end if;
  return next_id + 1;
END;
$$;

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id bigint PRIMARY KEY,
  mod_role bigint,
  mute_role bigint,
  use_url_filters int NOT NULL DEFAULT 0,
  use_file_filters int NOT NULL DEFAULT 0,
  mod_action_log_channel bigint,
  assignable_roles_prompt text
);

CREATE TABLE IF NOT EXISTS strike_punishments (
  guild_id bigint NOT NULL REFERENCES guild_settings ON DELETE CASCADE,
  strikes int NOT NULL,
  action_type int NOT NULL,
  duration int
);

CREATE TABLE IF NOT EXISTS strikes (
  guild_id bigint NOT NULL REFERENCES guild_settings ON DELETE CASCADE,
  user_id bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id serial PRIMARY KEY,
  guild_id bigint NOT NULL,
  log_message_id bigint,
  case_id int NOT NULL,
  ref_id int,
  target_id bigint NOT NULL,
  target_tag text NOT NULl,
  mod_id bigint,
  mod_tag text,
  action_type int NOT NULL,
  reason text,
  expires_at timestamptz,
  processed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unmute_roles (
  case_id int REFERENCES cases(id) ON DELETE CASCADE,
  role_id bigint NOT NULL
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

CREATE TABLE IF NOT EXISTS app_guilds (
  app_id int NOT NULL REFERENCES apps ON DELETE CASCADE,
  guild_id bigint NOT NULL
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
