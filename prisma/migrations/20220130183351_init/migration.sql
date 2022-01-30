-- CreateTable
CREATE TABLE "app_guilds" (
    "app_id" INTEGER NOT NULL,
    "guild_id" BIGINT NOT NULL,

    CONSTRAINT "app_guilds_pkey" PRIMARY KEY ("app_id","guild_id")
);

-- CreateTable
CREATE TABLE "apps" (
    "app_id" SERIAL NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "perms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("app_id")
);

-- CreateTable
CREATE TABLE "automod_punishments" (
    "guild_id" BIGINT NOT NULL,
    "triggers" INTEGER NOT NULL,
    "action_type" INTEGER NOT NULL,
    "duration" INTEGER,

    CONSTRAINT "automod_punishments_pkey" PRIMARY KEY ("guild_id","triggers")
);

-- CreateTable
CREATE TABLE "automod_triggers" (
    "guild_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automod_triggers_pkey" PRIMARY KEY ("guild_id","user_id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "log_message_id" BIGINT,
    "case_id" INTEGER NOT NULL,
    "ref_id" INTEGER,
    "target_id" BIGINT NOT NULL,
    "target_tag" TEXT NOT NULL,
    "mod_id" BIGINT,
    "mod_tag" TEXT,
    "action_type" INTEGER NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "processed" BOOLEAN NOT NULL DEFAULT true,
    "pardoned_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_settings" (
    "guild_id" BIGINT NOT NULL,
    "mod_role" BIGINT,
    "admin_role" BIGINT,
    "mute_role" BIGINT,
    "auto_pardon_warns_after" INTEGER,
    "use_url_filters" BOOLEAN NOT NULL DEFAULT false,
    "use_global_filters" BOOLEAN NOT NULL DEFAULT false,
    "use_file_filters" BOOLEAN NOT NULL DEFAULT false,
    "use_invite_filters" BOOLEAN NOT NULL DEFAULT false,
    "mod_action_log_channel" BIGINT,
    "filter_trigger_log_channel" BIGINT,
    "user_update_log_channel" BIGINT,
    "message_update_log_channel" BIGINT,
    "min_join_age" INTEGER,
    "no_blank_avatar" BOOLEAN NOT NULL DEFAULT false,
    "reports_channel" BIGINT,
    "antispam_amount" INTEGER,
    "antispam_time" INTEGER,
    "mention_limit" INTEGER,
    "mention_amount" INTEGER,
    "mention_time" INTEGER,
    "automod_cooldown" INTEGER,
    "hentai_threshold" INTEGER,
    "porn_threshold" INTEGER,
    "sexy_threshold" INTEGER,

    CONSTRAINT "guild_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "self_assignable_roles" (
    "id" SERIAL NOT NULL,
    "role_id" BIGINT NOT NULL,
    "prompt_id" INTEGER NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "emoji_id" BIGINT,
    "emoji_name" TEXT,
    "emoji_animated" BOOLEAN,

    CONSTRAINT "self_assignable_roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "self_assignable_roles_prompts" (
    "prompt_id" SERIAL NOT NULL,
    "embed_title" TEXT NOT NULL,
    "embed_description" TEXT,
    "embed_color" INTEGER NOT NULL,
    "embed_image" TEXT,
    "guild_id" BIGINT NOT NULL,
    "channel_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,
    "use_buttons" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "self_assignable_roles_prompts_pkey" PRIMARY KEY ("prompt_id")
);

-- CreateTable
CREATE TABLE "unmute_roles" (
    "case_id" INTEGER NOT NULL,
    "role_id" BIGINT NOT NULL,

    CONSTRAINT "unmute_roles_pkey" PRIMARY KEY ("case_id","role_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" BIGINT NOT NULL,
    "perms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "warn_punishments" (
    "guild_id" BIGINT NOT NULL,
    "warns" INTEGER NOT NULL,
    "action_type" INTEGER NOT NULL,
    "duration" INTEGER,

    CONSTRAINT "warn_punishments_pkey" PRIMARY KEY ("guild_id","warns")
);

-- CreateTable
CREATE TABLE "webhook_tokens" (
    "channel_id" BIGINT NOT NULL,
    "webhook_id" BIGINT NOT NULL,
    "webhook_token" TEXT NOT NULL,

    CONSTRAINT "webhook_tokens_pkey" PRIMARY KEY ("channel_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "self_assignable_roles_id_key" ON "self_assignable_roles"("id");

-- AddForeignKey
ALTER TABLE "app_guilds" ADD CONSTRAINT "app_guilds_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("app_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "self_assignable_roles" ADD CONSTRAINT "self_assignable_roles_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "self_assignable_roles_prompts"("prompt_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unmute_roles" ADD CONSTRAINT "unmute_roles_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
